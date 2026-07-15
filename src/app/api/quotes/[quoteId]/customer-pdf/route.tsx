// Slice 11 Step 6.3 — preview API route (renderToStream).
//
// Serves the customer-facing PDF for a quote as an application/pdf
// stream. Consumed by the QuoteHost preview iframe (Step 6.4) —
// PMs see the ACTUAL react-pdf output they're about to send, not
// a DOM approximation. This closes #79 (the QuoteHost preview
// architectural gap): the legacy DOM tree is retired; the iframe
// pointed at this route becomes the preview surface.
//
// Draft-vs-sent parity: same route, same factory
// (`buildQuoteDocument`), same resolver (`resolveCustomerView`).
// The isSent branch inside the resolver decides whether reads
// come from live firm defaults or the frozen snapshot columns.
//
// Search-param overrides (layout / detail / addendum) are honored
// for draft previews only — sent+ reads ignore them (immutable
// snapshot per Step 4.4). Toolbar controls (Step 6.4) update the
// iframe src on change.
//
// Cache-Control: no-store — every render is live against current
// state (draft) or the snapshot (sent). Vercel edge cache MUST
// NOT cache; a PM toggling a snapshot at admin/firm-settings + a
// draft preview must reflect immediately.
//
// Function runtime: node (not edge) — react-pdf uses fontkit,
// which needs Node's Buffer / fs primitives. Vercel serverless
// node runtime is the target; matches the Step 2 spike posture.

import { renderToStream } from "@react-pdf/renderer";
import { Readable } from "node:stream";

import { ensureUser } from "@/lib/auth/ensure-user";
import { buildQuoteDocument } from "@/lib/quote-pdf-document";
import { resolveCustomerView } from "@/lib/customer-view-resolver";

export const runtime = "nodejs";
// Slice 11 Step 6.5 constraint bank — render+upload can exceed the
// default 10s Hobby limit for many-assembly quotes. Pro plan
// default is 300s; set explicitly so a future plan downgrade
// surfaces the constraint at deploy time rather than at first
// long-render.
export const maxDuration = 60;

export async function GET(
  req: Request,
  context: { params: Promise<{ quoteId: string }> },
) {
  await ensureUser();

  const { quoteId } = await context.params;
  const url = new URL(req.url);
  const layout = url.searchParams.get("layout") ?? undefined;
  const detail = url.searchParams.get("detail") ?? undefined;
  const addendum = url.searchParams.get("addendum") ?? undefined;

  const result = await resolveCustomerView({
    quoteId,
    searchParams: { layout, detail, addendum },
  });

  if (!result.ok) {
    if (result.kind === "not_found") {
      return new Response("Quote not found", { status: 404 });
    }
    return new Response(`Costing bundle error: ${result.message}`, {
      status: 500,
    });
  }

  // Stamp `issued_date` fallback consistently — same value used at
  // preview AND (later) at persist for the same send. Deterministic
  // per-request; matches Pattern 45 discipline (Slice 11 doesn't
  // use `new Date()` inside the render hot path — argument-injected
  // per Pattern 30 spike constraint).
  const todayIso = new Date().toISOString().slice(0, 10);

  const doc = buildQuoteDocument({
    view: result.view,
    addendumData: result.addendumData,
    todayIso,
  });

  const nodeStream = await renderToStream(doc);
  // Node Readable → Web ReadableStream (Node 17+ built-in).
  const webStream = Readable.toWeb(
    nodeStream as unknown as Readable,
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="quote-${quoteId.slice(0, 8)}.pdf"`,
      "Cache-Control": "no-store, max-age=0",
      // Explicit no-cache header for CDN + browser layer.
      "CDN-Cache-Control": "no-store",
    },
  });
}
