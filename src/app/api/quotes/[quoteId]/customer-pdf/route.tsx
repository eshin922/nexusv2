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
import { buildQuoteDocument, renderRepresentation } from "@/lib/quote-pdf-document";
import {
  quoteIsDraft,
  readQuoteVersion,
  type QuoteVersionAddress,
} from "@/lib/quote-version-reader";
import { resolveCustomerView } from "@/lib/customer-view-resolver";
import { toLocalIsoDate } from "@/lib/local-date";

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
  // Slice 11 Step 6 FU — ?download=1 flips Content-Disposition from
  // `inline` (iframe embed) to `attachment` (browser save-as).
  // Same render path; browser decides based on the header.
  const download = url.searchParams.get("download") === "1";
  // OD-023 · explicit version addressing. Absent, a sent quote renders its
  // CURRENT version — which is what every caller wants and what the old
  // `superseded_at IS NULL` did implicitly. Present, it names one, and a
  // superseded version is as readable as the live one.
  const versionParam = url.searchParams.get("version");
  const snapshotParam = url.searchParams.get("snapshot");

  // ── Draft renders live; sent renders what was sent ──────────────────────
  //
  // The rule the whole slice turns on. A draft is a working copy and its
  // preview should follow the operator's edits. Anything sent has a frozen
  // representation, and recomputing it from today's costing, pricing, Library
  // and firm settings would show the operator something the customer never
  // received — most convincingly on the oldest quotes, whose live rows have
  // drifted furthest.
  const isDraft = await quoteIsDraft(quoteId);
  if (isDraft === null) return new Response("Quote not found", { status: 404 });

  if (!isDraft || versionParam !== null || snapshotParam !== null) {
    const address: QuoteVersionAddress = snapshotParam
      ? { kind: "snapshotId", snapshotId: snapshotParam }
      : versionParam
        ? { kind: "versionNumber", versionNumber: Number(versionParam) }
        : { kind: "current" };
    if (address.kind === "versionNumber" && !Number.isInteger(address.versionNumber)) {
      return new Response("Invalid version", { status: 400 });
    }
    const version = await readQuoteVersion(quoteId, address);
    switch (version.kind) {
      case "no_such_version":
        return new Response("No such quote version", { status: 404 });
      case "legacy":
        // 409, not 500 and not a live re-render. Nothing is broken and nothing
        // can be substituted: this version predates content capture, and the
        // PDF it points at remains the record of what was actually sent.
        return new Response(
          `${version.reason}${version.summary.pdfUrl ? "" : " No stored PDF is available for it either."}`,
          { status: 409 },
        );
      case "unsupported":
        return new Response(
          `This version was written by a newer release (payload version ${version.schemaVersion}) than this one can read.`,
          { status: 409 },
        );
      case "sent": {
        const stream = await renderToStream(
          renderRepresentation(version.representation),
        );
        const web = Readable.toWeb(
          stream as unknown as Readable,
        ) as unknown as ReadableStream<Uint8Array>;
        const slug =
          version.summary.quoteNumber ?? `v${version.summary.versionNumber}`;
        return new Response(web, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${slug}.pdf"`,
            // A sent version is immutable, so it is safe to cache hard. A draft
            // below is not, and deliberately is not cached.
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }
  }

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

  // Stamp `issued_date` fallback in Nexus operational timezone
  // (America/Los_Angeles), not UTC. `new Date().toISOString()`
  // returned UTC date; late-evening PDT preview rendered the next
  // day's Issued.
  const todayIso = toLocalIsoDate(new Date());

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

  // Filename: prefer quote_number (customer-facing id, e.g. DPS-2418);
  // fall back to id slug for drafts (no quote_number yet).
  const filenameSlug = result.view.quote.quoteNumber ?? `draft-${quoteId.slice(0, 8)}`;
  const disposition = download ? "attachment" : "inline";

  return new Response(webStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="quote-${filenameSlug}.pdf"`,
      "Cache-Control": "no-store, max-age=0",
      // Explicit no-cache header for CDN + browser layer.
      "CDN-Cache-Control": "no-store",
    },
  });
}
