// Slice 11 Gate 0 — react-pdf smoke trigger (THROWAWAY).
//
// Per cc-customer-pdf-library-spike-slice11.md §8 + Slice 11 brief §1.
// This page is gated by Clerk auth + middleware allowlist per
// production (no public access); the smoke walks it from a signed-in
// PM session in dev + on a Vercel preview deployment.
//
// Route: /spike
// Trigger: form submits to spikeRenderPdf() server action;
//          result rendered inline.
//
// **Folder MUST NOT start with `_`** — Next.js App Router treats
// underscored folders as private and excludes them from routing
// (next.js.org/docs/app/getting-started/project-structure#private-folders).
// Initial scaffold used `_spike` and 404'd accordingly; renamed to
// `spike` for the smoke walk.

import { spikeRenderPdf } from "@/app/actions/spike-pdf";

export default async function SpikePage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const params = await searchParams;
  const result = params.run === "1" ? await spikeRenderPdf() : null;

  return (
    <main
      style={{
        padding: 40,
        fontFamily: "system-ui, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>
        Slice 11 · react-pdf Gate 0 smoke
      </h1>
      <p style={{ color: "#555", marginBottom: 24, lineHeight: 1.5 }}>
        Renders a 1-page LETTER PDF with Newsreader + JetBrains Mono +
        tabular-nums via <code>renderToBuffer</code> in a server action.
        Confirms react-pdf 4.5.x works on Next.js 15 App Router. Branch:{" "}
        <code>spike/slice-11-react-pdf-smoke</code> (delete after pass).
      </p>

      <form action="/spike" method="GET">
        <input type="hidden" name="run" value="1" />
        <button
          type="submit"
          style={{
            background: "#111",
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Render PDF
        </button>
      </form>

      {result && (
        <section
          style={{
            marginTop: 32,
            padding: 20,
            borderRadius: 8,
            background: result.ok ? "#f0f9f0" : "#fff5f5",
            border: `1px solid ${result.ok ? "#4caf50" : "#e53935"}`,
            fontFamily: "ui-monospace, monospace",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <div>
            <strong>ok:</strong> {String(result.ok)}
          </div>
          {result.ok && (
            <>
              <div>
                <strong>buffer size:</strong> {result.size} bytes
              </div>
              <div>
                <strong>magic bytes (hex):</strong> {result.preview}
              </div>
              <div style={{ marginTop: 8, color: "#2e7d32" }}>
                {result.preview?.startsWith("25504446")
                  ? "✓ %PDF magic bytes present — valid PDF buffer"
                  : "⚠ magic bytes missing — buffer may not be a PDF"}
              </div>
            </>
          )}
          {!result.ok && (
            <div style={{ marginTop: 8, color: "#c62828", whiteSpace: "pre-wrap" }}>
              <strong>error:</strong>
              {"\n"}
              {result.error}
            </div>
          )}
        </section>
      )}

      <p style={{ marginTop: 32, color: "#888", fontSize: 12 }}>
        Pass criteria: <code>ok: true</code>, <code>size &gt; 1000</code>,
        magic bytes <code>25504446</code> (% P D F). Then open the
        rendered PDF separately (route below) and confirm Newsreader +
        JetBrains Mono render and the money string uses tabular figures.
      </p>
    </main>
  );
}
