// §6.b path-B Costs migration commit 2/5 — canonical .r6-context
// structure per r6_page.jsx lines 101-114 + 6styles.css .r6-context
// rules. Drops Tailwind utility chrome; uses canonical .anchor-pill /
// .ctx-name / .ctx-meta / .ctx-spacer / .ctx-action class names.
//
// Canonical R6 has two static .ctx-action buttons ("↗ Other SKUs"
// + "⌥ Switch scenario"). Nexus version preserved:
//   - Other SKUs: <details> popover (nexus enhancement; canonical
//     shows count only without dropdown — keep the dropdown since
//     it's a working affordance)
//   - Switch scenario: <Link> to project page (canonical's behavior
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
  otherSkus,
  tierCount,
  unitsTotal,
}: {
  projectId: string;
  scenarioLabel: string;
  scenarioVersion: number;
  anchorSku: ContextSku | null;
  otherSkus: ContextSku[];
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

      {otherSkus.length > 0 && (
        <details className="relative">
          <summary
            className="ctx-action"
            style={{ cursor: "pointer", listStyle: "none" }}
          >
            ↗ Other SKUs in this scenario ({otherSkus.length})
          </summary>
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "100%",
              zIndex: 10,
              marginTop: 4,
              minWidth: 260,
              padding: 8,
              background: "var(--paper)",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              boxShadow:
                "0 4px 12px oklch(from var(--ink) l c h / 0.12)",
            }}
          >
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              {otherSkus.map((s) => (
                <li
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    padding: "2px 6px",
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      color: "var(--ink-2)",
                    }}
                  >
                    {s.skuLabel}
                  </span>
                  <span
                    style={{
                      color: "var(--ink-3)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.productName}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

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
