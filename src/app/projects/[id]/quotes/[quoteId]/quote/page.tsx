import { notFound } from "next/navigation";
import { QuoteHost } from "@/components/quote/quote-host";
import { SurfaceChrome } from "@/components/nav/surface-chrome";
import { recordSurfaceVisit } from "@/app/actions/surface-visits";
import { ensureUser } from "@/lib/auth/ensure-user";
import { resolveCustomerView } from "@/lib/customer-view-resolver";

// Slice RI.6 — Quote page (visual shell + boundary-guard
// build invariant per brief §3.7).
// Slice RI.7 — wires real firm_settings live reads + per-quote
// snapshots into the data shape.
// Slice 11 Step 6.2 — CustomerView resolution extracted to
// src/lib/customer-view-resolver.ts so this page + the new
// /api/quotes/[quoteId]/customer-pdf route (Step 6.3) build the
// view from the SAME code path — no divergence between the
// preview iframe and the persisted PDF.

export default async function CustomerViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quoteId: string }>;
  searchParams: Promise<{
    dev?: string;
    /**
     * Slice 11 Step 4 preview overrides. Draft-mode only —
     * sent quotes always read from the immutable snapshot column.
     * Priority order (per brief §4):
     *   isSent ? quote.{col} : (searchParams.{param} ?? quote.{col} ?? default)
     */
    layout?: string;
    detail?: string;
    addendum?: string;
  }>;
}) {
  // 2026-06-17 prod-hang Vercel-side instrumentation (see
  // costs/page.tsx for full rationale). Quote umbrella runs the
  // resolver's costing bundle + addendum loader + preparedBy chain
  // (heavy on memory if a quote has many SKUs).
  const t0 = Date.now();
  const heapMb = () =>
    Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
  const elapsed = () => `${Date.now() - t0}ms`;
  const { id: projectId, quoteId } = await params;
  const { dev, layout, detail, addendum } = await searchParams;
  const tag = quoteId.slice(0, 8);
  console.log(`[quote:${tag}] start memory=${heapMb()}MB`);

  try {
    // Slice RI.9 §6 step 9 — record surface visit for Home Resume card.
    await recordSurfaceVisit({
      projectId,
      quoteId,
      surfaceKey: "customer_view",
    });
    console.log(`[quote:${tag}] post-auth ${elapsed()} memory=${heapMb()}MB`);

    const result = await resolveCustomerView({
      quoteId,
      searchParams: { layout, detail, addendum },
    });
    console.log(
      `[quote:${tag}] post-resolve ${elapsed()} memory=${heapMb()}MB`,
    );

    if (!result.ok) {
      if (result.kind === "not_found") notFound();
      // bundle_error — render inline error UI (no throw; keep the
      // surface chrome so PMs know where they are).
      return (
        <main
          style={{ padding: "32px 24px", maxWidth: 880, margin: "0 auto" }}
        >
          <div style={{ marginBottom: 16 }}>
            <SurfaceChrome
              surfaceKey="customer_view"
              segments={[]}
              breadcrumbTarget="customer_view"
              projectId={projectId}
              quoteId={quoteId}
            />
          </div>
          <h1>Quote unavailable</h1>
          <p style={{ color: "var(--bad)" }}>{result.message}</p>
        </main>
      );
    }

    const { view, addendumData, project, quote } = result;
    if (project.id !== projectId) notFound();

    const showStateSwitcher =
      dev === "1" || process.env.NODE_ENV !== "production";

    // Slice RI.7 — dev send stub gate. Two checks for safety:
    //   1. NODE_ENV !== 'production' — won't render in prod builds at all
    //   2. Admin role — even in dev, only admins see the affordance
    // Slice 11 replaces the entire stub with real PDF + email flow on
    // the existing Download buttons.
    const me = await ensureUser();
    const devSendEnabled =
      process.env.NODE_ENV !== "production" && me.role === "admin";

    console.log(
      `[quote:${tag}] pre-render ${elapsed()} memory=${heapMb()}MB`,
    );
    return (
      <>
        <div style={{ padding: "16px 24px 0" }}>
          <SurfaceChrome
            surfaceKey="customer_view"
            segments={[]}
            breadcrumbTarget="customer_view"
            projectId={project.id}
            quoteId={quote.id}
          />
        </div>
        <QuoteHost
          view={view}
          quoteId={quote.id}
          quoteStatus={quote.status}
          showStateSwitcher={showStateSwitcher}
          devSendEnabled={devSendEnabled}
          internalNotes={quote.internalNotes}
          addendumData={addendumData}
        />
      </>
    );
  } catch (e) {
    console.error(`[quote:${tag}] FAIL ${elapsed()} memory=${heapMb()}MB`, e);
    throw e;
  }
}
