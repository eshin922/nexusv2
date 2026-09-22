"use client";

import { useState } from "react";
import Link from "next/link";
import { BlankCell, costCategoryLabel, Tag, TextCell, TierHeadCell, ValueCell, toolingLabel } from "./shared";
import { ChargeStateTag, firstAnsweredRead } from "./spreadsheet-view";
import { packagingReadKey, type PackagingLineTierRead } from "@/lib/costs/packaging-line-graph-read";
import { fmtPct1 } from "@/lib/money-display";
import { M3Editor } from "./m3-editor-boundary";
import {
  flattenOwners,
  type CostsOverview,
  type OverviewOwner,
  type OverviewTierFact,
} from "@/lib/costs/costs-overview-model";

/**
 * BY MODULE — prototype `ownerBlock()`.
 *
 * ONE ACCORDION CARD PER PRODUCT, not one card per platform module. The first
 * cut of this view reconstructed four broad Packaging / Production / Freight /
 * One-time sections; canonical screenshot 10 shows product cards, each holding
 * its own recurring and one-time sections with the tier grid aligned inside, and
 * the other products collapsed. That is a structural difference, not a read-only
 * limitation, so the organisation follows the design.
 *
 * MODULE INTERIORS ARE STILL POINTED AT. Freight's interior and the Item Group
 * Production module are existing screens with their own editing, completion,
 * permissions and recovery; the fidelity checklist lists both under "Not
 * designed — do not fabricate". Their rows read "in module" and carry an entry
 * point, exactly as the prototype does — and the link LEAVES the preview,
 * because that is where the capability lives.
 */
export function ByModuleView({
  overview,
  reads,
  costsPathname,
  baseParams,
  activeTierId,
  onSelectTier,
  quoteId,
  editMode,
}: {
  overview: CostsOverview;
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  costsPathname: string;
  baseParams: string;
  activeTierId: string | null;
  onSelectTier: (tierId: string) => void;
  quoteId: string;
  editMode: boolean;
}) {
  // EVERY owner gets a card, members included. The group's "Members" section
  // says they are "costed on their own lines"; that line is this card. Rendering
  // only top-level owners would leave a member's costs reachable from no view,
  // which is the omission a parity preview exists to make impossible.
  const owners = flattenOwners(overview.owners).map((e) => e.owner);
  const [openKey, setOpenKey] = useState<string | null>(owners[0]?.key ?? null);

  const moduleHref = (section: string) => {
    const params = new URLSearchParams(baseParams);
    params.set("section", section);
    return `${costsPathname}?${params.toString()}`;
  };

  if (owners.length === 0) {
    return (
      <div className="cm2-empty-card">
        Setup has defined no products, services or item groups on this quote.
      </div>
    );
  }

  return (
    <div>
      {owners.map((owner) => (
        <OwnerAccordion
          key={owner.key}
          owner={owner}
          reads={reads}
          tiers={overview.tiers}
          open={openKey === owner.key}
          onToggle={() => setOpenKey(openKey === owner.key ? null : owner.key)}
          moduleHref={moduleHref}
          activeTierId={activeTierId}
          onSelectTier={onSelectTier}
          quoteId={quoteId}
          editMode={editMode}
        />
      ))}
    </div>
  );
}

function OwnerAccordion({
  owner,
  reads,
  tiers,
  open,
  onToggle,
  moduleHref,
  activeTierId,
  onSelectTier,
  quoteId,
  editMode,
}: {
  owner: OverviewOwner;
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  tiers: readonly OverviewTierFact[];
  open: boolean;
  onToggle: () => void;
  moduleHref: (section: string) => string;
  activeTierId: string | null;
  onSelectTier: (tierId: string) => void;
  quoteId: string;
  editMode: boolean;
}) {
  const cols = tiers.length + 1;
  const unresolved = owner.charges.filter((c) => c.state !== "complete").length;
  // One object rather than two props through five components: the tier context
  // is read together everywhere it is read at all.
  const tierCtx: TierContext = { activeTierId, onSelectTier };
  return (
    <section
      className={`cm2-owner${open ? " cm2-open" : ""}`}
      style={{ ["--cm2-cols" as string]: String(cols) }}
    >
      <button
        type="button"
        className="cm2-owner-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="cm2-caret">{open ? "▾" : "▸"}</span>
        <span style={{ minWidth: 0 }}>
          <span className="cm2-owner-title">{owner.name}</span>
          <span className="cm2-flags">
            {owner.kind === "item_group" && <Tag tone="accent">item group</Tag>}
            {owner.kind === "direct_service" && <Tag tone="purple">direct service</Tag>}
            {owner.kind === "group_member" && <Tag tone="plain">product</Tag>}
            {owner.kind === "direct_product" && <Tag tone="plain">product</Tag>}
            {owner.sku ? (
              <Tag>{owner.sku}</Tag>
            ) : owner.kind === "direct_service" ? null : (
              <Tag tone="amber">SKU unresolved</Tag>
            )}
            {owner.productType && <Tag>type · {owner.productType}</Tag>}
            {unresolved > 0 && <Tag tone="amber">{unresolved} to resolve</Tag>}
          </span>
          <span className="cm2-owner-sub">
            {owner.kind === "direct_service"
              ? "a service on its own quote line"
              : `all ${tiers.length} tier${tiers.length === 1 ? "" : "s"} shown below`}
          </span>
        </span>
        {/* The prototype shows recurring / charges / line totals here. Those are
            computed figures with no governed node for this population, so the
            slot states what the card holds rather than a number nobody owns. */}
        <span className="cm2-owner-figs">
          <span className="cm2-fig">
            <span className="cm2-eyebrow">recurring</span>
            <span className="cm2-fig-val">
              {owner.recurringLines.length + owner.productionLines.length}
            </span>
          </span>
          <span className="cm2-fig">
            <span className="cm2-eyebrow">one-time</span>
            <span className="cm2-fig-val">{owner.charges.length}</span>
          </span>
        </span>
      </button>

      {open && (
        <div className="cm2-owner-body">
          {owner.kind === "direct_service" ? (
            <ServiceGroup owner={owner} tiers={tiers} tier={tierCtx} />
          ) : (
            <>
              <RecurringGroup owner={owner} reads={reads} tiers={tiers} tier={tierCtx} quoteId={quoteId} editMode={editMode} />
              <ChargesGroup owner={owner} tiers={tiers} tier={tierCtx} quoteId={quoteId} editMode={editMode} />
            </>
          )}
          {owner.kind === "item_group" && (
            <ProductionGroup
              owner={owner}
              tiers={tiers}
              tier={tierCtx}
              href={moduleHref("production")}
            />
          )}
          {owner.members.length > 0 && <MembersGroup owner={owner} />}
        </div>
      )}
    </section>
  );
}

/** The active tier, and the gesture that moves it. Navigation only. */
type TierContext = {
  activeTierId: string | null;
  onSelectTier: (tierId: string) => void;
};

/** Prototype `group()` head + field head. */
function GroupHead({
  title,
  chip,
  sub,
  itemLabel,
  tailLabel,
  tiers,
  tier,
}: {
  title: string;
  chip: string;
  sub: string;
  itemLabel: string;
  tailLabel: string;
  tiers: readonly OverviewTierFact[];
  tier: TierContext;
}) {
  return (
    <>
      <div className="cm2-group-head">
        <span className="cm2-group-title">{title}</span>
        <Tag>{chip}</Tag>
        <span className="cm2-group-sub">{sub}</span>
      </div>
      <div className="cm2-grid cm2-fieldhead">
        <div className="cm2-ident cm2-eyebrow">{itemLabel}</div>
        {tiers.map((t) => (
          <button
            key={t.id}
            type="button"
            className="cm2-tierpick"
            aria-pressed={t.id === tier.activeTierId}
            onClick={() => tier.onSelectTier(t.id)}
          >
            <TierHeadCell tier={t} active={t.id === tier.activeTierId} />
          </button>
        ))}
        <div className="cm2-tierhead">MARKUP %</div>
        <div className="cm2-tail cm2-eyebrow">{tailLabel}</div>
      </div>
    </>
  );
}

function RecurringGroup({
  owner,
  reads,
  tiers,
  tier,
  quoteId,
  editMode,
}: {
  owner: OverviewOwner;
  reads: ReadonlyMap<string, PackagingLineTierRead>;
  tiers: readonly OverviewTierFact[];
  tier: TierContext;
  quoteId: string;
  editMode: boolean;
}) {
  const many = owner.recurringLines.length > 1;
  return (
    <div className="cm2-group">
      <GroupHead
        title="Recurring costs"
        chip={`${owner.recurringLines.length} row${owner.recurringLines.length === 1 ? "" : "s"}`}
        sub="unit cost per sellable unit · entered per tier · markup is quote-wide"
        itemLabel="row"
        tailLabel="details"
        tiers={tiers}
        tier={tier}
      />
      {owner.recurringLines.length === 0 && (
        <div className="cm2-note">
          No recurring costs on this product.
        </div>
      )}
      {owner.recurringLines.map((line) => {
        const resolved = firstAnsweredRead(reads, line, tiers);
        return (
        <div className="cm2-row" key={line.lineGroupId}>
          <div className="cm2-ident">
            <div className="cm2-label">
              Product cost
              {many && (line.vendor ?? line.category)
                ? ` · ${line.vendor ?? costCategoryLabel(line.category)}`
                : ""}
            </div>
            <div className="cm2-flags">
              <Tag tone="plain">recurring · per unit</Tag>
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
                highlighted={t.id === tier.activeTierId}
              />
            );
          })}
          {editMode ? (
            <M3Editor kind="markup" line={line} resolved={resolved ?? null} disabled={false} />
          ) : (
            <span className="cm2-cell">
              <span className="cm2-figure" aria-readonly="true">
                {resolved?.markup != null ? fmtPct1(resolved.markup) : "—"}
              </span>
            </span>
          )}
          <div className="cm2-tail">
            {costCategoryLabel(line.category)}
            {line.qtyPerSellableUnit ? ` · ${line.qtyPerSellableUnit}/unit` : ""}
          </div>
        </div>
      );})}
    </div>
  );
}

function ChargesGroup({
  owner,
  tiers,
  tier,
  quoteId,
  editMode,
}: {
  owner: OverviewOwner;
  tiers: readonly OverviewTierFact[];
  tier: TierContext;
  quoteId: string;
  editMode: boolean;
}) {
  return (
    <div className="cm2-group">
      <GroupHead
        title="One-time charges"
        chip={`${owner.charges.length} from Setup`}
        sub="identity and owner come from Setup · amount entered per tier"
        itemLabel="charge"
        tailLabel="classification"
        tiers={tiers}
        tier={tier}
      />
      {/* ABSENCE, stated as absence. "Setup selected none" asserts a reviewed
          decision the record does not carry — nothing distinguishes "nobody has
          been here yet" from "considered and declined". */}
      {owner.charges.length === 0 ? (
        <div className="cm2-note">
          No one-time charges on this product. They are added in Setup.
        </div>
      ) : (
        <>
          {owner.charges.map((charge) => (
            <div className="cm2-row" key={charge.chargeInstanceId}>
              <div className="cm2-ident">
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
                  stored={charge.amounts.get(t.id)?.cost ?? null}
                  tierLabel={`${t.label} · cost as recorded`}
                  highlighted={t.id === tier.activeTierId}
                />
              ))}
              <TextCell text="—" />
              <div className="cm2-tail">{toolingLabel(charge.toolingClassification) ?? " "}</div>
            </div>
          ))}
          {/* No "Charges per tier" foot. The prototype computes that sum; this
              surface cannot, and a row of dashes reads as a total that failed. */}
          <div className="cm2-group-foot">
            A one-time charge is counted once inside each alternative, never
            across them.
          </div>
        </>
      )}
    </div>
  );
}

function ServiceGroup({
  owner,
  tiers,
  tier,
}: {
  owner: OverviewOwner;
  tiers: readonly OverviewTierFact[];
  tier: TierContext;
}) {
  return (
    <div className="cm2-group">
      <GroupHead
        title="Service cost"
        chip="own quote line"
        sub="line total per tier"
        itemLabel="line"
        tailLabel="accounting item"
        tiers={tiers}
        tier={tier}
      />
      {owner.productionLines.map((line) => (
        <div className="cm2-row" key={line.field}>
          <div className="cm2-ident">
            <div className="cm2-label">{line.label}</div>
          </div>
          {tiers.map((t) => (
            <ValueCell
              key={t.id}
              stored={line.amounts.get(t.id) ?? null}
              tierLabel={`${t.label} · line total as recorded`}
              highlighted={t.id === tier.activeTierId}
            />
          ))}
          <TextCell text="—" />
          <div className="cm2-tail">line total</div>
        </div>
      ))}
    </div>
  );
}

function ProductionGroup({
  owner,
  tiers,
  tier,
  href,
}: {
  owner: OverviewOwner;
  tiers: readonly OverviewTierFact[];
  tier: TierContext;
  href: string;
}) {
  return (
    <div className="cm2-group">
      <GroupHead
        title="Production costs · tier totals"
        chip="group Production module"
        sub="a total for the tier · never multiplied by unit quantity"
        itemLabel="worksheet cost"
        tailLabel="entered in"
        tiers={tiers}
        tier={tier}
      />
      {owner.productionLines.map((line) => (
        <div className="cm2-row" key={line.field}>
          <div className="cm2-ident">
            <div className="cm2-label cm2-muted">{line.label}</div>
          </div>
          {tiers.map((t) => (
            <ValueCell
              key={t.id}
              stored={line.amounts.get(t.id) ?? null}
              tierLabel={`${t.label} · tier total as recorded`}
              highlighted={t.id === tier.activeTierId}
            />
          ))}
          <TextCell text="—" />
          <div className="cm2-tail">group Production module</div>
        </div>
      ))}
      <div className="cm2-row">
        <div className="cm2-ident">
          <div className="cm2-label cm2-muted">Group Production module</div>
        </div>
        {tiers.map((t) => (
          <BlankCell key={t.id} />
        ))}
        <BlankCell />
        <div className="cm2-tailfield" style={{ border: 0 }}>
          <Link className="cm2-entry" href={href}>
            Open Production module →
          </Link>
        </div>
      </div>
      <div className="cm2-note">
        Production costs, not one-time fees: they stay in the group&rsquo;s
        Production module, keep their tier-total basis and are never brought
        under the one-time amount control.
      </div>
    </div>
  );
}

function MembersGroup({ owner }: { owner: OverviewOwner }) {
  return (
    <div className="cm2-group">
      <div className="cm2-group-head">
        <span className="cm2-group-title">Members</span>
        <Tag>same records</Tag>
        <span className="cm2-group-sub">costed on their own lines</span>
      </div>
      {owner.members.map((m) => (
        <div className="cm2-row" key={m.key} style={{ gridTemplateColumns: "1fr auto" }}>
          <div className="cm2-label cm2-muted">
            {m.name}
            {m.quantity ? ` · ${m.quantity} per group` : ""}
          </div>
          <div className="cm2-tail">{m.sku || "SKU unresolved"}</div>
        </div>
      ))}
    </div>
  );
}
