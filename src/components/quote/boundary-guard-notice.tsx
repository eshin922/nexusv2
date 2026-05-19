// PM-internal callout — customer-invisible signal lives in the
// `--internal` (purple) register, not the R3 yellow designer-note
// register. The copy is verbatim from R3 source. The visual choice
// is semantically correct: --internal IS the customer-invisible
// signal across the app (cost-build internal-only badges, etc.).
//
// impl-6 patch round (Bug #O) — replaced specific column names
// ("version_number, scenario_label") with abstract category
// description ("internal versioning") so the PM-internal notice
// doesn't leak schema column tokens into the rendered surface
// (PMs share preview screenshots with clients; raw column names
// look unprofessional and read as accidental leak).

export function BoundaryGuardNotice() {
  return (
    <div
      className="boundary-guard-notice"
      style={{ maxWidth: 880, margin: "0 auto 18px" }}
    >
      <div className="eyebrow">Boundary guard · customer view</div>
      <strong>Nothing below this line is in the customer&rsquo;s tree.</strong>{" "}
      Margin, markup, cost stack, supplier names, duty %, tariff %, CBM,
      internal versioning — all forbidden. The component tree for{" "}
      <code>&lt;PdfPage&gt;</code> imports zero costing primitives.
    </div>
  );
}
