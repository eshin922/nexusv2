"use client";

import { useState } from "react";
import { costCategoryLabel, EdField, Tag, fmtUsd4, tierHead, toolingLabel } from "./shared";
import { ChargeStateTag } from "./spreadsheet-view";
import {
  focusableOwners,
  type CostsOverview,
  type OverviewOwner,
} from "@/lib/costs/costs-overview-model";
import {
  packagingReadKey,
  type PackagingLineTierRead,
} from "@/lib/costs/packaging-line-graph-read";
import { fmtPct1 } from "@/lib/money-display";
import { M3Editor } from "./m3-editor-boundary";
import { firstAnsweredRead } from "./spreadsheet-view";
import { OrderQuantity } from "./order-quantity";

/**
 * BY PRODUCT — prototype `editor()` / `edSection()` / `edCard()` / `edField()`.
 *
 * A picker, then one CARD PER COST ROW: a titled white card whose fields sit in
 * the design's four-column auto-fit grid (pricing vendor, markup category, unit
 * cost at the focused tier, quantity per sellable unit), with the override and
 * notes behind a disclosure, and one card per one-time charge.
 *
 * The first cut was a flat label/value list. Read-only is a behaviour limit, not
 * a licence to drop the composition: `edReadOnly()` exists in the prototype
 * precisely so a field can keep its footprint without being editable.
 *
 * THE FOCUSED TIER IS THE QUOTE'S ACTIVE TIER. It is named on the surface, and
 * it comes from the same store the Cost Stack reads, so opening this view does
 * not silently reset the operator to tier 1 or disagree with the stack above it.
 * Choosing one here makes the SAME navigation gesture the stack makes — store
 * plus `?tier=` — and writes nothing to the quote. The stack keeps its
 * whole-quote, all-SKU scope either way; the tier decides which column is
 * highlighted, never which records exist.
 */
export function ByProductView({
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
  const owners = focusableOwners(overview.owners);
  const [selectedKey, setSelectedKey] = useState<string | null>(owners[0]?.key ?? null);
  const owner = owners.find((o) => o.key === selectedKey) ?? owners[0] ?? null;
  // The store's tier, falling back to the first only when the store has none to
  // give — before hydration, or on a tier this quote does not carry.
  const tier =
    overview.tiers.find((t) => t.id === activeTierId) ?? overview.tiers[0] ?? null;

  if (!owner || !tier) {
    return (
      <div className="cm2-empty-card">
        This quote has no lines with economics of their own to focus.
      </div>
    );
  }

  const unresolved = (o: OverviewOwner) =>
    o.charges.filter((c) => c.state !== "complete").length;

  return (
    <div className="cm2-split">
      <div className="cm2-picker">
        <div className="cm2-picker-head">quote lines</div>
        {owners.map((o) => {
          const miss = unresolved(o);
          return (
            <button
              key={o.key}
              type="button"
              className="cm2-pick"
              aria-pressed={o.key === owner.key}
              onClick={() => setSelectedKey(o.key)}
            >
              <span style={{ minWidth: 0 }}>
                <span className="cm2-pick-name">{o.name}</span>
                <span className={`cm2-pick-meta${miss ? " cm2-amberink" : ""}`}>
                  {o.sku || "SKU unresolved"}
                  {miss ? ` · ${miss} to resolve` : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="cm2-product-panel">
        <div className="cm2-product-head">
          <span className="cm2-product-title">{owner.name}</span>
          <OrderQuantity owner={owner} tierId={tier.id}/>
          <span className="cm2-flags">
            {owner.sku ? <Tag>{owner.sku}</Tag> : <Tag tone="amber">SKU unresolved</Tag>}
            {owner.productType && <Tag>type · {owner.productType}</Tag>}
          </span>
          {/* The scope, NAMED, as pressed buttons rather than a dropdown: this
              preview holds no form controls, and a select on a surface where
              everything else is inert reads as an editor. */}
          <span
            className="cm2-flags"
            role="group"
            aria-label="Focused tier"
            data-testid="cm2-tier-scope"
            style={{ marginLeft: "auto" }}
          >
            <span className="cm2-eyebrow">showing</span>
            {overview.tiers.map((t) => (
              <button
                key={t.id}
                type="button"
                className="cm2-ctl"
                aria-pressed={t.id === tier.id}
                onClick={() => onSelectTier(t.id)}
              >
                {t.label}
                {tierHead(t).qty === null ? "" : ` · ${tierHead(t).qty}`}
              </button>
            ))}
          </span>
        </div>

        <section className="cm2-section">
          <div className="cm2-section-head">
            <span className="cm2-section-title">Recurring costs</span>
            <span className="cm2-section-note">
              {owner.recurringLines.length} row
              {owner.recurringLines.length === 1 ? "" : "s"} · shown at {tier.label}
            </span>
          </div>
          {owner.recurringLines.length === 0 && owner.productionLines.length === 0 && (
            <div className="cm2-empty-card">No recurring rows on this line.</div>
          )}

          {owner.recurringLines.map((line) => {
            const read = reads.get(packagingReadKey(line.lineGroupId, tier.id));
            const many = owner.recurringLines.length > 1;
            const qualifier = many ? line.vendor ?? costCategoryLabel(line.category) : null;
            return (
              <article className="cm2-edcard" key={line.lineGroupId}>
                <div className="cm2-edtitle">
                  <span className="cm2-edtitle-text">
                    Product cost · {owner.name}
                    {qualifier ? ` · ${qualifier}` : ""}
                  </span>
                  {line.category === null && <Tag>inherits category default</Tag>}
                  {line.conflictingFields.length > 0 && (
                    <Tag
                      tone="amber"
                      title={`Tier rows disagree on: ${line.conflictingFields.join(", ")}`}
                    >
                      tier rows disagree
                    </Tag>
                  )}
                  {/* The prototype's figure slot carries an extended total. No
                      governed node publishes one, so the slot names the governed
                      per-unit value it CAN read instead of inventing a total. */}
                  <span className={`cm2-edfig${read?.value == null ? " cm2-amberink" : ""}`}>
                    {read && read.value !== null
                      ? `landed ${fmtUsd4(read.value)} / unit`
                      : "unpriced"}
                  </span>
                </div>

                <div className="cm2-edgrid">
                  <EdField
                    label="Pricing vendor"
                    value={line.vendor ?? "none selected"}
                    hint="source of pricing · not the awarded supplier"
                  />
                  <EdField
                    label="Markup category"
                    value={costCategoryLabel(line.category)}
                    hint={
                      read && read.markup !== null
                        ? `resolved ${fmtPct1(read.markup)}${read.markupSource ? ` · ${read.markupSource}` : ""}`
                        : "no resolved rate on this line"
                    }
                  />
                  {editMode && read ? (
                    <div className="cm2-edfield">
                      <span className="cm2-edlabel">{`Unit cost · ${tier.label}`}</span>
                      <M3Editor kind="recurring" line={line} tier={tier} read={read} disabled={false} />
                    </div>
                  ) : (
                    <EdField
                      label={`Unit cost · ${tier.label}`}
                      value={line.cells.get(tier.id)?.unitCost ?? null}
                      hint="per sellable unit"
                      mono
                    />
                  )}
                  <EdField
                    label="Quantity per sellable unit"
                    value={line.qtyPerSellableUnit ?? "1"}
                    hint="multiplies the unit cost"
                    mono
                  />
                </div>

                <details className="cm2-disclosure">
                  <summary>Pricing override and notes</summary>
                  <div className="cm2-disclosure-body">
                    {editMode ? (
                      <div className="cm2-edfield">
                        <span className="cm2-edlabel">Markup override</span>
                        <M3Editor kind="markup" line={line} resolved={firstAnsweredRead(reads, line, overview.tiers)} disabled={false} />
                      </div>
                    ) : (
                      <EdField
                        label="Markup override"
                        value={
                          line.storedMarkupPct === null || line.markupPctSource === "category_default"
                            ? "inherit"
                            : fmtPct1(Number(line.storedMarkupPct))
                        }
                        hint={
                          line.markupPctSource === "manual_override"
                            ? "set on this line"
                            : "inherited · no override recorded"
                        }
                        mono
                      />
                    )}
                    <EdField
                      label="Financial note"
                      value={line.notes ?? ""}
                      hint="existing note field"
                      span
                    />
                  </div>
                </details>
              </article>
            );
          })}

          {owner.productionLines.map((line) => (
            <article className="cm2-edcard" key={line.field}>
              <div className="cm2-edtitle">
                <span className="cm2-edtitle-text">{line.label}</span>
                <Tag>tier total</Tag>
              </div>
              <div className="cm2-edgrid">
                {overview.tiers.map((t) => (
                  <EdField
                    key={t.id}
                    label={`Tier total · ${t.label}`}
                    value={line.amounts.get(t.id) ?? null}
                    hint={
                      t.qty === null
                        ? "never multiplied by unit quantity"
                        : `${t.qty.toLocaleString("en-US")} unit alternative`
                    }
                    mono
                  />
                ))}
                <EdField
                  label="Entered in"
                  value={
                    owner.kind === "direct_service"
                      ? "this service's own Production input"
                      : "the group's Production module"
                  }
                  hint="a total for the tier"
                  span
                />
              </div>
            </article>
          ))}
        </section>

        <section className="cm2-section">
          <div className="cm2-section-head">
            <span className="cm2-section-title">One-time charges</span>
            <span className="cm2-section-note">
              defined in Setup · cost entered here
            </span>
          </div>
          {owner.charges.length === 0 && (
            <div className="cm2-empty-card">
              No one-time charges on this product. They are added in Setup.
            </div>
          )}
          {owner.charges.map((charge) => (
            <article className="cm2-edcard" key={charge.chargeInstanceId}>
              <div className="cm2-edtitle">
                <span className="cm2-edtitle-text">
                  {charge.typeLabel}
                  {charge.ownLabel ? ` · ${charge.ownLabel}` : ""}
                </span>
                <Tag tone="accent">One-time cost</Tag>
                <ChargeStateTag charge={charge} />
              </div>
              <div className="cm2-edgrid cm2-charge-grid" style={{ ["--cm2-charge-tiers" as string]: String(overview.tiers.length) }}>
                {/*
                  EVERY TIER, even in the per-tier view. The prototype offers an
                  "Applies to: Same across tiers / Different by tier" control
                  over a stored shared-mode intent. No such intent exists to
                  read — the writer accepts one charge, one tier, one cost — so
                  this shows what is recorded per alternative rather than
                  inferring a mode from amounts that happen to match.
                */}
                {overview.tiers.map((t) => editMode ? (
                  <div className="cm2-edfield" key={t.id}>
                    <span className="cm2-edlabel">{`One-time amount · ${t.label}`}</span>
                    <M3Editor kind="charge" quoteId={quoteId} charge={charge} tier={t} disabled={false} />
                  </div>
                ) : (
                  <EdField
                    key={t.id}
                    label={`One-time amount · ${t.label}`}
                    value={charge.amounts.get(t.id)?.cost ?? null}
                    mono
                  />
                ))}
                {charge.chargeKey === "tooling" && (
                  <EdField
                    label="Tooling classification"
                    value={toolingLabel(charge.toolingClassification) ?? "not classified"}
                    hintTone={charge.toolingClassification === null ? "amber" : undefined}
                    span
                  />
                )}
              </div>
            </article>
          ))}
        </section>

        {owner.members.length > 0 && (
          <section className="cm2-section">
            <div className="cm2-section-head">
              <span className="cm2-section-title">Members</span>
              <span className="cm2-section-note">
                quantity per parent · costed on their own lines
              </span>
            </div>
            {owner.members.map((m) => (
              <article className="cm2-edcard" key={m.key}>
                <div className="cm2-edtitle">
                  <span className="cm2-edtitle-text">{m.name}</span>
                  {m.sku ? <Tag>{m.sku}</Tag> : <Tag tone="amber">SKU unresolved</Tag>}
                </div>
                <div className="cm2-edgrid">
                  <EdField
                    label="Quantity per parent"
                    value={m.quantity ?? "1"}
                    hint="structural · separate from the row multiplier"
                    mono
                  />
                  <EdField
                    label="Group Production fields"
                    value="in the group's Production module"
                    hint="existing group fields · opened from the group"
                  />
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
