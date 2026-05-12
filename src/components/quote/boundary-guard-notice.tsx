// PM-internal callout — customer-invisible signal lives in the
// `--internal` (purple) register, not the R3 yellow designer-note
// register. The copy is verbatim from R3 source. The visual choice
// is semantically correct: --internal IS the customer-invisible
// signal across the app (cost-build internal-only badges, etc.).

export function BoundaryGuardNotice() {
  return (
    <div
      className="boundary-guard-notice"
      style={{ maxWidth: 880, margin: "0 auto 18px" }}
    >
      <div className="eyebrow">Boundary guard · customer view</div>
      <strong>Nothing below this line is in the customer&rsquo;s tree.</strong>{" "}
      Margin, markup, cost stack, supplier names, duty %, tariff %, CBM,
      version_number, scenario_label — all forbidden. The component tree for{" "}
      <code>&lt;PdfPage&gt;</code> imports zero costing primitives.
    </div>
  );
}
