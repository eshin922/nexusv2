// Slice 11 Step 3 — TEMPORARY verification trigger page.
//
// Surfaces two preview PDFs for the first-render walk:
//
//   - Swatches PDF — renders the 11 canonical PP_* tokens as labeled
//     swatches + font-weight ladder. Confirms OKLCH → sRGB precompute
//     matches CD's DOM preview (Edward visual diff).
//
//   - Sample PDF — renders StatePure tier_table itemized with CD's
//     fixture data, end-to-end. Confirms the component tree compiles +
//     renders as expected.
//
// **REMOVE in pre-v1 cleanup PR** — these routes exist only for the
// Step-3 walk; they are auth-gated by default Clerk middleware (not a
// security risk in dev), but they're not part of the customer flow.
//
// Path discipline: `customer-pdf-verify` (no underscore prefix) per
// Gate-0 lesson learned — underscored routes get tree-shaken on
// production builds.

export const dynamic = "force-dynamic";

export default function CustomerPdfVerifyPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "48px auto",
        padding: "24px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        lineHeight: 1.55,
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>
        Customer-PDF Step 3 verification
      </h1>
      <p style={{ color: "#444", marginBottom: 24 }}>
        Two PDFs for Edward + CA to walk during Step-3 first-render
        review. <strong>Temporary surface — removed in pre-v1 cleanup.</strong>
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
          1 · Palette + font-weight verify PDF
        </h2>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
          11 canonical <code>PP_*</code> sRGB tokens as labeled swatches +
          Newsreader (400/500/600/italic) + JetBrains Mono (400/500/600)
          ladder. Visual diff against CD&apos;s DOM preview confirms the
          OKLCH precompute holds.
        </p>
        <a
          href="/api/customer-pdf-verify/swatches"
          style={{
            display: "inline-block",
            padding: "8px 16px",
            background: "#131921",
            color: "#fefdfc",
            borderRadius: 4,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Render verify PDF
        </a>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
          2 · Sample customer PDF
        </h2>
        <p style={{ fontSize: 14, color: "#555", marginBottom: 12 }}>
          Full StatePure (tier_table · itemized) render against CD&apos;s
          fixture data. Confirms the component tree compiles end-to-end.
          Includes one spec-addendum page (Step 3b verbatim port)
          exercising all three leaf-block variants (typed-with-fields,
          placeholder, untyped).
        </p>
        <a
          href="/api/customer-pdf-verify/sample"
          style={{
            display: "inline-block",
            padding: "8px 16px",
            background: "#4d5969",
            color: "#fefdfc",
            borderRadius: 4,
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          Render sample quote PDF
        </a>
      </section>
    </main>
  );
}
