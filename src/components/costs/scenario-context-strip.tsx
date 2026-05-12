// Slice RI.4 — Scenario context strip per R6 actual source
// (`docs/design-prototypes/dist/source/round-6/index.html` lines
// 2367-2400 + cost-build-page.jsx lines 100-114).
//
// Card chrome: paper bg + 1px rule border + 10px radius + 12×16
// padding. Layout: anchor pill (★ + SKU code + "— anchor SKU"
// trailing tag) + italic display 17px SKU name + mono 11px ink-3
// meta + spacer + ctx-action buttons (Other SKUs / Switch scenario).

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
    <section
      className="r6-context mb-[18px] flex items-center gap-3.5 rounded-[10px] border border-rule bg-paper px-4 py-3"
      style={{ minHeight: 0 }}
    >
      {/* Anchor pill — ★ + SKU code + "— anchor SKU" tag.
          Em-dash separator per R6 source (index.html line 2387,
          cost-build-page.jsx line 105). */}
      <span
        className="inline-flex items-center gap-[7px] rounded-md bg-paper-3 font-mono text-[11px] tracking-[0.02em] text-ink"
        style={{ padding: "5px 10px" }}
      >
        <span
          aria-hidden
          className="font-display italic text-[13px] text-accent-ink"
        >
          ★
        </span>
        <span>{anchorSku.skuLabel}</span>
        <span className="text-ink-3">{"—"} anchor SKU</span>
      </span>

      {/* Italic display SKU name (R6 17px ink) */}
      <span className="font-display italic text-[17px] font-medium leading-tight tracking-[-0.005em] text-ink">
        {anchorSku.productName}
      </span>

      {/* Mono meta caption */}
      <span className="font-mono text-[11px] tracking-[0.04em] text-ink-3">
        {tierCount} tier{tierCount === 1 ? "" : "s"} · {unitsTotal.toLocaleString()} units total committed
      </span>

      {/* Spacer + right-cluster actions */}
      <span className="flex-1" />

      {otherSkus.length > 0 && (
        <details className="relative">
          <summary className="cursor-pointer list-none px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] text-ink-3 hover:text-ink">
            ↗ Other SKUs in this scenario ({otherSkus.length})
          </summary>
          <div className="absolute right-0 top-full z-10 mt-1 min-w-[260px] rounded border border-rule bg-paper p-2 shadow-md">
            <ul className="flex flex-col gap-1">
              {otherSkus.map((s) => (
                <li
                  key={s.id}
                  className="flex items-baseline gap-2 px-1.5 py-0.5 text-[11px]"
                >
                  <span className="font-mono text-ink-2">{s.skuLabel}</span>
                  <span className="truncate text-ink-3">{s.productName}</span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <Link
        href={`/projects/${projectId}`}
        className="px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] text-ink-3 hover:text-ink"
        title={`Scenario: ${scenarioLabel} v${scenarioVersion} — switch on project page`}
      >
        ⌥ Switch scenario
      </Link>
    </section>
  );
}
