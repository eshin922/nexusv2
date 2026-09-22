"use client";

import { BlankCell, costCategoryLabel, Tag, TextCell, TierHeadCell, ValueCell, toolingLabel } from "./shared";
import {
  flattenOwners,
  type CostsOverview,
  type OverviewCharge,
  type OverviewOwner,
  type OverviewProductionLine,
  type OverviewRecurringLine,
  type OverviewTierFact,
} from "@/lib/costs/costs-overview-model";
import {
  packagingReadKey,
  type PackagingLineTierRead,
} from "@/lib/costs/packaging-line-graph-read";
import { fmtPct1 } from "@/lib/money-display";
import { M3Editor } from "./m3-editor-boundary";

/**
 * SPREADSHEET — prototype `sheetBlock()`.
 *
 * One card, every owner, every row, every tier side by side, plus the MARKUP %
 * track. Tiers are ALTERNATIVE quantities for the whole quote, so none is
 * hidden and there is no tier selector here.
 *
 * NO QUOTE TOTAL ROW, AND NO EMPTY ONE EITHER. The prototype's foot reads
 * `this.stack(tid).total` — prototype arithmetic the brief says to discard — and
 * the engine publishes no node for this population. A row of dashes under
 * "Quote total per tier" is not neutral: it reads as a total that failed to
 * compute. The governed whole-quote figures are in the Cost Stack above, and
 * saying so once in the card foot is the honest form.
 */
export function SpreadsheetView({
  overview,
  reads,
  activeTierId,
  onSelectTier,
  quoteId,
  editMode,
}: {
  overview: CostsOverview;
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  activeTierId: string | null;
  onSelectTier: (tierId: string) => void;
  quoteId: string;
  editMode: boolean;
}) {
  const tiers = overview.tiers;
  const rows = flattenOwners(overview.owners);
  // Tier tracks + the MARKUP % track — prototype `NC = TIERS.length + 1`.
  const cols = tiers.length + 1;

  return (
    <div className="cm2-group" style={{ ["--cm2-cols" as string]: String(cols) }}>
      <div className="cm2-group-head">
        <span className="cm2-group-title">Every cost line on the quote</span>
        <Tag>
          {tiers.length} tier{tiers.length === 1 ? "" : "s"} side by side
        </Tag>
      </div>

      <div className="cm2-grid cm2-fieldhead cm2-onsunk">
        <div className="cm2-ident cm2-eyebrow">owner · line</div>
        {tiers.map((t) => (
          <button
            key={t.id}
            type="button"
            className="cm2-tierpick"
            aria-pressed={t.id === activeTierId}
            onClick={() => onSelectTier(t.id)}
          >
            <TierHeadCell tier={t} active={t.id === activeTierId} />
          </button>
        ))}
        <div className="cm2-tierhead">MARKUP %</div>
        <div className="cm2-tail cm2-eyebrow">markup category · item</div>
      </div>

      {rows.map(({ owner, depth }) => (
        <OwnerRows
          key={owner.key}
          owner={owner}
          depth={depth}
          tiers={tiers}
          reads={reads}
          activeTierId={activeTierId}
          quoteId={quoteId}
          editMode={editMode}
        />
      ))}

      {overview.unplacedCharges.length > 0 && (
        <>
          <div className="cm2-row cm2-parent">
            <div className="cm2-ident">
              <div className="cm2-label cm2-strong">
                Charges with no owner in this quote
              </div>
              <div className="cm2-meta">shown, not dropped</div>
            </div>
            {tiers.map((t) => (
              <BlankCell key={t.id} />
            ))}
            <BlankCell />
            <div className="cm2-tail" />
          </div>
          {overview.unplacedCharges.map((c) => (
            <ChargeRow
              key={c.chargeInstanceId}
              charge={c}
              indent={1}
              tiers={tiers}
              activeTierId={activeTierId}
              quoteId={quoteId}
              editMode={false}
            />
          ))}
        </>
      )}

      {/* No totals row. A dash under "Quote total per tier" reads as a total
          that failed, which is worse than not offering one. */}
      <div className="cm2-group-foot">
        {tiers.length > 1
          ? "Tiers are alternatives · never added together."
          : "One quantity on this quote."}{" "}
        Quote totals are governed in the Cost Stack above.
      </div>
    </div>
  );
}

function OwnerRows({
  owner,
  depth,
  tiers,
  reads,
  activeTierId,
  quoteId,
  editMode,
}: {
  owner: OverviewOwner;
  depth: number;
  tiers: readonly OverviewTierFact[];
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  activeTierId: string | null;
  quoteId: string;
  editMode: boolean;
}) {
  // Prototype: a row's label gains ` · <supplier || category>` only when the
  // owner carries MORE THAN ONE, which is what distinguishes them. One row needs
  // no qualifier, and adding one everywhere is the clutter the review named.
  const many = owner.recurringLines.length > 1;
  return (
    <>
      <div className="cm2-row cm2-parent">
        <div className="cm2-ident" data-indent={depth || undefined}>
          <div className="cm2-label cm2-strong">{owner.name}</div>
          <div className="cm2-meta">{ownerMeta(owner)}</div>
        </div>
        {tiers.map((t) => (
          <BlankCell key={t.id} />
        ))}
        <BlankCell />
        <div className="cm2-tail">
          <span className="cm2-flags" style={{ justifyContent: "flex-end" }}>
            <OwnerKindTag owner={owner} />
          </span>
          {ownerTail(owner)}
        </div>
      </div>

      {owner.recurringLines.map((line) => (
        <RecurringRow
          key={line.lineGroupId}
          line={line}
          owner={owner}
          many={many}
          indent={depth + 1}
          tiers={tiers}
          reads={reads}
          activeTierId={activeTierId}
          quoteId={quoteId}
          editMode={editMode}
        />
      ))}
      {owner.productionLines.map((line) => (
        <ProductionRow
          key={line.field}
          line={line}
          indent={depth + 1}
          tiers={tiers}
          activeTierId={activeTierId}
        />
      ))}
      {owner.charges.map((charge) => (
        <ChargeRow
          key={charge.chargeInstanceId}
          charge={charge}
          indent={depth + 1}
          tiers={tiers}
          activeTierId={activeTierId}
          quoteId={quoteId}
          editMode={editMode}
        />
      ))}
    </>
  );
}

function OwnerKindTag({ owner }: { owner: OverviewOwner }) {
  if (owner.kind === "item_group") return <Tag tone="accent">item group</Tag>;
  if (owner.kind === "direct_service") return <Tag tone="purple">service</Tag>;
  return <Tag tone="plain">product</Tag>;
}

/** Prototype `parentFld().meta` — the SKU, or what stands in for it. */
function ownerMeta(owner: OverviewOwner): string {
  if (owner.kind === "direct_service") return "direct service";
  if (owner.kind === "item_group") return owner.sku ? `SKU ${owner.sku}` : "item group";
  return owner.sku ? `SKU ${owner.sku}` : "SKU unresolved";
}

/** Prototype `parentFld().tail`. */
function ownerTail(owner: OverviewOwner): string {
  const recurring = owner.recurringLines.length + owner.productionLines.length;
  return `${recurring} recurring · ${owner.charges.length} one-time`;
}

function RecurringRow({
  line,
  owner,
  many,
  indent,
  tiers,
  reads,
  activeTierId,
  quoteId,
  editMode,
}: {
  line: OverviewRecurringLine;
  owner: OverviewOwner;
  many: boolean;
  indent: number;
  tiers: readonly OverviewTierFact[];
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  activeTierId: string | null;
  quoteId: string;
  editMode: boolean;
}) {
  // Markup has no tier-specific scope, so any tier's read carries the line's
  // answer. An em dash when none resolved — never one tier elected to speak for
  // the rest.
  const resolved = firstAnsweredRead(reads, line, tiers);
  const qualifier = many ? line.vendor ?? costCategoryLabel(line.category) : null;
  return (
    <div className="cm2-row">
      <div className="cm2-ident" data-indent={indent}>
        {/* "Product cost", the prototype's name for a recurring row. Never the
            raw category key — `primary_packaging` is a classification, not an
            identity, and using it as one invents a component that is not there. */}
        <div className="cm2-label">
          Product cost{qualifier ? ` · ${qualifier}` : ""}
        </div>
        <div className="cm2-flags">
          <Tag tone="plain">recurring · per unit</Tag>
          {line.conflictingFields.length > 0 && (
            <Tag
              tone="amber"
              title={`Tier rows of this line disagree on: ${line.conflictingFields.join(", ")}. The first row supplies the value shown.`}
            >
              tier rows disagree
            </Tag>
          )}
        </div>
      </div>
      {tiers.map((t) => {
        const read = reads.get(packagingReadKey(line.lineGroupId, t.id));
        return editMode && read ? (
          <M3Editor key={t.id} kind="recurring" line={line} tier={t} read={read} disabled={false} />
        ) : (
          <ValueCell
            key={t.id}
            stored={line.cells.get(t.id)?.unitCost ?? null}
            tierLabel={`${t.label} · unit cost as recorded`}
            highlighted={t.id === activeTierId}
          />
        );
      })}
      {editMode ? (
        <M3Editor kind="markup" line={line} resolved={resolved} disabled={false} />
      ) : (
        <span className="cm2-cell">
          <span className="cm2-figure" aria-readonly="true">
            {resolved && resolved.markup !== null ? fmtPct1(resolved.markup) : "—"}
          </span>
        </span>
      )}
      <div className="cm2-tailfield">
        {/* The markup category, in the prototype's trailing control slot. Read
            only, so the resolved rung is named rather than offered as a choice. */}
        <span>{costCategoryLabel(line.category)}</span>
      </div>
    </div>
  );
}

export function firstAnsweredRead(
  reads: ReadonlyMap<string, PackagingLineTierRead>,
  line: OverviewRecurringLine,
  tiers: readonly OverviewTierFact[],
): PackagingLineTierRead | null {
  for (const t of tiers) {
    const r = reads.get(packagingReadKey(line.lineGroupId, t.id));
    if (r && r.markup !== null) return r;
  }
  return null;
}

function ProductionRow({
  line,
  indent,
  tiers,
  activeTierId,
}: {
  line: OverviewProductionLine;
  indent: number;
  tiers: readonly OverviewTierFact[];
  activeTierId: string | null;
}) {
  return (
    <div className="cm2-row">
      <div className="cm2-ident" data-indent={indent}>
        {/* NOT a one-time charge: filling / blending, CM assembly and bulk raw
            are tier totals owned by their module. */}
        <div className="cm2-label cm2-muted">{line.label}</div>
      </div>
      {tiers.map((t) => (
        <ValueCell
          key={t.id}
          stored={line.amounts.get(t.id) ?? null}
          tierLabel={`${t.label} · tier total as recorded`}
          highlighted={t.id === activeTierId}
        />
      ))}
      <TextCell text="—" />
      <div className="cm2-tail">in module</div>
    </div>
  );
}

function ChargeRow({
  charge,
  indent,
  tiers,
  activeTierId,
  quoteId,
  editMode,
}: {
  charge: OverviewCharge;
  indent: number;
  tiers: readonly OverviewTierFact[];
  activeTierId: string | null;
  quoteId: string;
  editMode: boolean;
}) {
  return (
    <div className="cm2-row">
      <div className="cm2-ident" data-indent={indent}>
        <div className="cm2-label">
          {charge.typeLabel}
          {charge.ownLabel ? ` · ${charge.ownLabel}` : ""}
        </div>
        <div className="cm2-flags">
          <Tag tone="accent">One-time cost</Tag>
          <ChargeStateTag charge={charge} />
        </div>
      </div>
      {tiers.map((t) => editMode ? (
        <M3Editor key={t.id} kind="charge" quoteId={quoteId} charge={charge} tier={t} disabled={false} />
      ) : (
        <ValueCell
          key={t.id}
          // No tier row means no cost stated. A charge tier row exists if and
          // only if an operator stated a positive cost, so absence is
          // unambiguous and shows as unpriced, never as zero.
          stored={charge.amounts.get(t.id)?.cost ?? null}
          tierLabel={`${t.label} · cost as recorded`}
          highlighted={t.id === activeTierId}
        />
      ))}
      {/* Charge-level governed markup is not exposed to this surface, and none
          was invented. The prototype reads an em dash here too. */}
      <TextCell text="—" />
      <div className="cm2-tail">
        {toolingLabel(charge.toolingClassification) ?? " "}
      </div>
    </div>
  );
}

export function ChargeStateTag({ charge }: { charge: OverviewCharge }) {
  return <>
    {charge.toolingClassification === null && charge.chargeKey === "tooling" && (
      <Tag tone="amber">needs classification</Tag>
    )}
    <ChargePricingStateTag charge={charge} />
  </>;
}

function ChargePricingStateTag({ charge }: { charge: OverviewCharge }) {
  if (charge.state === "complete") return <Tag tone="green">priced</Tag>;
  if (charge.state === "partial")
    return (
      <Tag tone="amber" title={`No cost at ${charge.missingTierLabels.join(", ")}`}>
        partly priced
      </Tag>
    );
  if (charge.state === "none") return <Tag tone="amber">unpriced</Tag>;
  return <Tag tone="amber">state unknown</Tag>;
}
