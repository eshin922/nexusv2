// §6.b path-B Costs migration commit 2/5 — canonical .r6-context
// structure per r6_page.jsx lines 101-114 + 6styles.css .r6-context
// rules. Drops Tailwind utility chrome; uses canonical .anchor-pill /
// .ctx-name / .ctx-meta / .ctx-spacer / .ctx-action class names.
//
// The redundant Other SKUs control is intentionally absent because the
// unified Costs page already renders every SKU. Switch scenario remains
// a <Link> to the project page (canonical's behavior
//     unclear from prototype; project page is the only existing
//     scenario-switcher today)

import Link from "next/link";

export type ContextSku = {
  id: string;
  skuLabel: string;
  productName: string;
  skuRole: "leaf" | "assembly";
};

export function ScenarioContextStrip({
  projectId,
  scenarioLabel,
  scenarioVersion,
  anchorSku,
  tierCount,
  unitsTotal,
}: {
  projectId: string;
  scenarioLabel: string;
  scenarioVersion: number;
  anchorSku: ContextSku | null;
  tierCount: number;
  unitsTotal: number;
}) {
  if (!anchorSku) return null;

  return (
    <section className="r6-context" aria-label="SKU + scenario context">
      <span className="anchor-pill">
        <span className="star" aria-hidden>
          ★
        </span>
        <span>{anchorSku.skuLabel}</span>
        <span className="code">— anchor SKU</span>
      </span>

      <span className="ctx-name">{anchorSku.productName}</span>

      <span className="ctx-meta">
        {tierCount} tier{tierCount === 1 ? "" : "s"} ·{" "}
        {unitsTotal.toLocaleString()} units total committed
      </span>

      <span className="ctx-spacer" />

      <Link
        href={`/projects/${projectId}`}
        className="ctx-action"
        title={`Scenario: ${scenarioLabel} v${scenarioVersion} — switch on project page`}
      >
        ⌥ Switch scenario
      </Link>
    </section>
  );
}
