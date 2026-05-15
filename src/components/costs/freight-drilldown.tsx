"use client";

import React, { useEffect, useRef, useState, useTransition } from "react";
import { Modal } from "@/components/modal/modal";
import {
  addLeg,
  addLegGroup,
  deleteLeg,
  deleteLegGroup,
  moveLeg,
  updateCustomerArrangesMeta,
  updateLegCustoms,
  updateLegMarkup,
  updateLegMetadata,
  updateLegTierCell,
} from "@/app/actions/freight";
import { useCostingStore } from "@/components/costing-store-provider";
import {
  selectFreightCustomerArrangesMeta,
  selectFreightLegGroups,
  selectFreightLegs,
  selectFreightLegTiers,
  selectUpdateFreightCustomerArrangesMeta,
  selectUpdateFreightLegCustoms,
  selectUpdateFreightLegMarkup,
  selectUpdateFreightLegMeta,
  selectUpdateFreightLegTier,
} from "@/lib/costing-store";

// ---------------------------------------------------------------------------
// Slice R6.2 commit 2 — Freight drilldown rebuilt against the multi-leg
// journey model. Renders INSIDE the Costs section accordion (not the
// CD prototype's standalone-page chrome). Layout grammar mirrors
// docs/design-prototypes/dist/r6_2_freight-panel.jsx + r6_2_styles.css
// per Pattern 30 canonical-CSS-imported-verbatim:
//
//   Mode chooser (DPS arranges · Multi-leg · Customer arranges · Empty)
//   Leg-group wrapper (label · leg count · journey transit caption)
//     Leg head (direction chip · route · ↔ BORDER · treatment toggle · ⋯)
//     Leg body grid (mode · carrier · incoterm · cargo ready · vessel ETD · freight markup)
//     Per-tier rate table (rate × markup → billable per unit)
//     Customs cluster (DDP + crosses_border) with duty/tariff markup pills
//     PDF slot (P1 visual; upload P2)
//
// Page chrome from the prototype (eyebrow / h1 / sub / page-level
// "+ Add leg" / Save draft) is INTENTIONALLY stripped — the host is
// the costs page accordion section header. Add-Leg fires as a centered
// Modal (Setup's primitive) instead of the prototype's slide-in drawer.
// ---------------------------------------------------------------------------

const FREIGHT_LEG_MODES = [
  { value: "parcel", label: "Parcel" },
  { value: "ocean_fcl", label: "Ocean FCL" },
  { value: "ocean_lcl", label: "Ocean LCL" },
  { value: "air_freight", label: "Air freight" },
  { value: "air_express", label: "Air express" },
  { value: "ltl_truck", label: "LTL truck" },
  { value: "truckload", label: "Truckload" },
  { value: "drayage", label: "Drayage" },
  { value: "exw_pickup", label: "EXW pickup" },
  { value: "other", label: "Other" },
] as const;

const INCOTERMS = [
  { value: "DDP", label: "DDP", desc: "Delivered Duty Paid" },
  { value: "DAP", label: "DAP", desc: "Delivered At Place" },
  { value: "FOB", label: "FOB", desc: "Free On Board" },
  { value: "EXW", label: "EXW", desc: "Ex Works" },
  { value: "FCA", label: "FCA", desc: "Free Carrier" },
  { value: "CIF", label: "CIF", desc: "Cost Insurance Freight" },
] as const;

type Tier = { id: string; label: string; qty: number | null };

function fmtCurr2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(decimal: number, fractionDigits = 1): string {
  return `${(decimal * 100).toFixed(fractionDigits)}%`;
}

function fmtDate(d: string | null): string {
  return d ?? "—";
}

function transitWeeksBetween(
  cargoReady: string | null,
  etd: string | null,
): number | null {
  if (!cargoReady || !etd) return null;
  const diffMs = new Date(etd).getTime() - new Date(cargoReady).getTime();
  if (!Number.isFinite(diffMs)) return null;
  return Math.round((diffMs / (1000 * 60 * 60 * 24 * 7)) * 10) / 10;
}

// ---- top-level ----

export function FreightDrilldown({
  quoteId,
  tiers,
  editable,
}: {
  quoteId: string;
  tiers: Tier[];
  editable: boolean;
}) {
  const legGroups = useCostingStore(selectFreightLegGroups);
  const legs = useCostingStore(selectFreightLegs);
  const [addLegOpen, setAddLegOpen] = useState<{ legGroupId: string } | null>(
    null,
  );
  const [pendingAddGroup, startAddGroupTransition] = useTransition();

  if (tiers.length === 0) {
    return (
      <div
        style={{
          padding: "12px 14px",
          background: "var(--warn-soft)",
          border: "1px solid oklch(from var(--warn) l c h / 0.40)",
          borderRadius: 6,
          fontSize: 13,
          color: "var(--warn)",
        }}
      >
        Add at least one tier to the quote before entering freight legs.
      </div>
    );
  }

  function handleAddFirstLeg() {
    // Auto-create the first leg-group if none exists yet, then open
    // the add-leg modal pointing at it. v1 typically has one journey
    // per quote; multi-route flows are P2.
    if (legGroups.length > 0) {
      setAddLegOpen({ legGroupId: legGroups[0].id });
      return;
    }
    const fd = new FormData();
    fd.set("quoteId", quoteId);
    fd.set("label", "Outbound · journey 1");
    startAddGroupTransition(async () => {
      const result = await addLegGroup(fd);
      if (result.ok) {
        setAddLegOpen({ legGroupId: result.data.id });
      }
    });
  }

  if (legGroups.length === 0) {
    return (
      <>
        <div className="r62-empty">
          <div className="glyph">∅</div>
          <h4>No freight entered yet</h4>
          <p>
            Build a journey of one or more legs — Shenzhen → Long Beach is
            one leg; Shenzhen → Busan → Long Beach is two. Customs lands
            on each border-crossing leg with DPS-customs obligation.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={!editable || pendingAddGroup}
              onClick={handleAddFirstLeg}
            >
              + Add first leg
            </button>
          </div>
        </div>
        {addLegOpen && (
          <AddLegModal
            legGroupId={addLegOpen.legGroupId}
            tiers={tiers}
            onClose={() => setAddLegOpen(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      {legGroups.map((group) => {
        const groupLegs = legs.filter((l) => l.legGroupId === group.id);
        return (
          <LegGroupBlock
            key={group.id}
            group={group}
            legs={groupLegs}
            tiers={tiers}
            editable={editable}
            onAddLeg={() => setAddLegOpen({ legGroupId: group.id })}
          />
        );
      })}
      {addLegOpen && (
        <AddLegModal
          legGroupId={addLegOpen.legGroupId}
          tiers={tiers}
          onClose={() => setAddLegOpen(null)}
        />
      )}
    </>
  );
}

// ---- leg-group ----

function LegGroupBlock({
  group,
  legs,
  tiers,
  editable,
  onAddLeg,
}: {
  group: { id: string; label: string; displayOrder: number };
  legs: Array<{
    id: string;
    legGroupId: string;
    cargoReadyDate: string | null;
    vesselEtd: string | null;
  }>;
  tiers: Tier[];
  editable: boolean;
  onAddLeg: () => void;
}) {
  const [pendingDelete, startDeleteTransition] = useTransition();

  // Journey transit caption: max(vessel_etd) − min(cargo_ready_date)
  // across the group's legs. Hidden if ANY leg is missing either date
  // (Gap 6 disposition).
  const journeyTransitWeeks = (() => {
    if (legs.length === 0) return null;
    let maxEtdMs = -Infinity;
    let minCargoMs = Infinity;
    for (const leg of legs) {
      if (!leg.cargoReadyDate || !leg.vesselEtd) return null;
      const cargoMs = new Date(leg.cargoReadyDate).getTime();
      const etdMs = new Date(leg.vesselEtd).getTime();
      if (!Number.isFinite(cargoMs) || !Number.isFinite(etdMs)) return null;
      if (cargoMs < minCargoMs) minCargoMs = cargoMs;
      if (etdMs > maxEtdMs) maxEtdMs = etdMs;
    }
    const ms = maxEtdMs - minCargoMs;
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.round((ms / (1000 * 60 * 60 * 24 * 7)) * 10) / 10;
  })();

  function handleDeleteGroup() {
    if (
      !confirm(
        `Delete "${group.label}" — all ${legs.length} leg${legs.length === 1 ? "" : "s"} and per-tier rates will be removed.`,
      )
    )
      return;
    const fd = new FormData();
    fd.set("legGroupId", group.id);
    startDeleteTransition(async () => {
      await deleteLegGroup(fd);
    });
  }

  return (
    <div className="r62-leg-group" style={{ marginBottom: 12 }}>
      <div className="r62-leg-group-head">
        <span className="label">{group.label}</span>
        <span className="meta">
          · {legs.length} leg{legs.length === 1 ? "" : "s"}
          {journeyTransitWeeks !== null && (
            <span style={{ marginLeft: 12, color: "var(--ink-2)" }}>
              · {journeyTransitWeeks}w total transit
            </span>
          )}
        </span>
        <button
          type="button"
          className="add-leg"
          disabled={!editable}
          onClick={onAddLeg}
        >
          + Add leg
        </button>
        <button
          type="button"
          onClick={handleDeleteGroup}
          disabled={!editable || pendingDelete}
          title="Delete journey"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            cursor: "pointer",
            padding: "0 6px",
            fontFamily: "var(--mono)",
            fontSize: 14,
          }}
        >
          ···
        </button>
      </div>
      {legs.length === 0 ? (
        <div
          style={{
            padding: "24px 18px",
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          No legs yet — click <em>+ Add leg</em> above to add the first.
        </div>
      ) : (
        legs.map((_leg, idx) => (
          <LegBlock
            key={legs[idx].id}
            legId={legs[idx].id}
            tiers={tiers}
            editable={editable}
            position={idx}
            siblingCount={legs.length}
          />
        ))
      )}
    </div>
  );
}

// ---- single leg ----

function LegBlock({
  legId,
  tiers,
  editable,
  position,
  siblingCount,
}: {
  legId: string;
  tiers: Tier[];
  editable: boolean;
  position: number;
  siblingCount: number;
}) {
  const legs = useCostingStore(selectFreightLegs);
  const legMaybe = legs.find((l) => l.id === legId);
  const legTiers = useCostingStore(selectFreightLegTiers);
  const meta = useCostingStore(selectFreightCustomerArrangesMeta);
  const updateLegMeta = useCostingStore(selectUpdateFreightLegMeta);
  const updateLegMarkupStore = useCostingStore(selectUpdateFreightLegMarkup);
  const updateLegCustomsStore = useCostingStore(
    selectUpdateFreightLegCustoms,
  );
  const updateMetaStore = useCostingStore(
    selectUpdateFreightCustomerArrangesMeta,
  );
  const [pending, startTransition] = useTransition();

  if (!legMaybe) return null;
  // `leg` is non-null past this point; aliased so the closures
  // below (selectTreatment, fireMetaSave, etc.) get a stable
  // non-null type without TS narrowing across closure boundaries.
  const leg = legMaybe;

  // Customer-arranges mode (per Slice R6.2 design) is signaled by the
  // leg having a customer_arranges_meta row attached. We use the
  // meta presence as the mode discriminator since meta-on-leg is the
  // architectural commitment.
  const customerMeta = meta.find((m) => m.freightLegId === legId);
  const isCustomerArranges = Boolean(customerMeta);

  // Customs cluster visibility per Gap 12 + math contract:
  // crosses_international_border AND incoterm === 'DDP'. Hidden for
  // customer-arranges legs entirely.
  const showCustoms =
    !isCustomerArranges &&
    leg.crossesInternationalBorder &&
    leg.incoterm === "DDP";

  const computedTransit = transitWeeksBetween(
    leg.cargoReadyDate,
    leg.vesselEtd,
  );

  function fireMetaSave(formFields: Record<string, string | null>) {
    if (!editable) return;
    const fd = new FormData();
    fd.set("legId", legId);
    for (const [k, v] of Object.entries(formFields)) {
      fd.set(k, v ?? "");
    }
    startTransition(async () => {
      await updateLegMetadata(fd);
    });
  }

  function selectTreatment(t: "bundled" | "pass_through") {
    if (!editable || pending || t === leg.treatment) return;
    updateLegMeta(legId, { treatment: t });
    fireMetaSave({ treatment: t });
  }

  function handleDeleteLeg() {
    if (!editable) return;
    if (!confirm(`Delete this leg?`)) return;
    const fd = new FormData();
    fd.set("legId", legId);
    startTransition(async () => {
      await deleteLeg(fd);
    });
  }

  function handleMoveLeg(direction: "up" | "down") {
    if (!editable) return;
    const fd = new FormData();
    fd.set("legId", legId);
    fd.set("direction", direction);
    startTransition(async () => {
      await moveLeg(fd);
    });
  }

  return (
    <div className="r62-leg">
      <div className="r62-leg-head">
        <span className={`direction ${leg.direction}`}>{leg.direction}</span>
        <div className="lhs">
          <span className="lab">{leg.label ?? "(unlabeled leg)"}</span>
          <span className="route">
            <span>{leg.origin ?? "—"}</span>
            <span className="arrow">→</span>
            <span>
              {leg.destination ??
                (isCustomerArranges ? "(customer's destination)" : "—")}
            </span>
            {leg.crossesInternationalBorder && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 9,
                  letterSpacing: 0.06,
                  padding: "1px 6px",
                  borderRadius: 3,
                  marginLeft: 6,
                  background: "oklch(0.55 0.07 215 / 0.12)",
                  color: "oklch(0.45 0.10 215)",
                  textTransform: "uppercase",
                }}
              >
                ↔ border
              </span>
            )}
          </span>
        </div>
        {!isCustomerArranges ? (
          <div className="r62-treat">
            <button
              type="button"
              className={leg.treatment === "bundled" ? "on bundled" : ""}
              disabled={!editable || pending}
              onClick={() => selectTreatment("bundled")}
            >
              Bundled
            </button>
            <button
              type="button"
              className={
                leg.treatment === "pass_through" ? "on passthrough" : ""
              }
              disabled={!editable || pending}
              onClick={() => selectTreatment("pass_through")}
            >
              Passthrough
            </button>
          </div>
        ) : (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.05em",
            }}
          >
            COST = $0 · METADATA ONLY
          </span>
        )}
        <LegActionMenu
          position={position}
          siblingCount={siblingCount}
          editable={editable}
          pending={pending}
          onDelete={handleDeleteLeg}
          onMoveUp={() => handleMoveLeg("up")}
          onMoveDown={() => handleMoveLeg("down")}
        />
      </div>

      {/* Leg body grid */}
      <div
        className="r62-leg-body"
        style={{
          gridTemplateColumns: isCustomerArranges
            ? "1fr 1fr 1fr 1fr"
            : "1fr 1fr 1fr 1fr 1fr",
        }}
      >
        <BodyField label="Mode">
          {isCustomerArranges ? (
            <div className="display">
              {FREIGHT_LEG_MODES.find((m) => m.value === leg.mode)?.label ??
                "—"}
            </div>
          ) : (
            <select
              defaultValue={leg.mode ?? ""}
              disabled={!editable || pending}
              onChange={(e) => {
                const v = e.target.value || null;
                updateLegMeta(legId, { mode: v as typeof leg.mode });
                fireMetaSave({ mode: v });
              }}
            >
              <option value="">—</option>
              {FREIGHT_LEG_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </BodyField>
        <BodyField label="Carrier / forwarder">
          {isCustomerArranges ? (
            <div
              className="display"
              style={{ color: "var(--ink-4)", fontStyle: "italic" }}
            >
              (customer&rsquo;s choice)
            </div>
          ) : (
            <DebouncedTextInput
              key={`carrier-${legId}`}
              defaultValue={leg.carrier ?? ""}
              disabled={!editable || pending}
              placeholder="—"
              onCommit={(v) => {
                updateLegMeta(legId, { carrier: v });
                fireMetaSave({ carrier: v });
              }}
            />
          )}
        </BodyField>
        <BodyField label="Incoterm">
          <select
            defaultValue={leg.incoterm ?? ""}
            disabled={!editable || pending}
            onChange={(e) => {
              const v = e.target.value || null;
              updateLegMeta(legId, { incoterm: v as typeof leg.incoterm });
              fireMetaSave({ incoterm: v });
            }}
          >
            <option value="">—</option>
            {INCOTERMS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value} — {t.desc}
              </option>
            ))}
          </select>
        </BodyField>
        <BodyField label="Cargo ready">
          <input
            type="date"
            defaultValue={leg.cargoReadyDate ?? ""}
            disabled={!editable || pending}
            onChange={(e) => {
              const v = e.target.value || null;
              updateLegMeta(legId, { cargoReadyDate: v });
              fireMetaSave({ cargoReadyDate: v });
            }}
          />
        </BodyField>
        {!isCustomerArranges && (
          <BodyField
            label={
              <>
                Vessel ETD
                {(leg.incoterm === "FOB" || leg.incoterm === "EXW") && (
                  <span
                    style={{
                      marginLeft: 4,
                      fontSize: 9,
                      color: "var(--ink-4)",
                      fontStyle: "italic",
                      letterSpacing: 0,
                    }}
                  >
                    · optional
                  </span>
                )}
              </>
            }
          >
            <input
              type="date"
              defaultValue={leg.vesselEtd ?? ""}
              disabled={!editable || pending}
              onChange={(e) => {
                const v = e.target.value || null;
                updateLegMeta(legId, { vesselEtd: v });
                fireMetaSave({ vesselEtd: v });
              }}
            />
          </BodyField>
        )}
      </div>

      {/* Freight markup + transit caption row (DPS-arranges modes only) */}
      {!isCustomerArranges && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 18px",
            borderBottom: "1px solid var(--rule)",
            background: "var(--paper-2)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              letterSpacing: 0.1,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              marginRight: 8,
            }}
          >
            Freight markup
          </span>
          <MarkupPill
            value={leg.freightMarkupPct}
            disabled={!editable}
            onCommit={(v) => {
              updateLegMarkupStore(legId, "freight", v);
              const fd = new FormData();
              fd.set("legId", legId);
              fd.set("component", "freight");
              fd.set("value", (v * 100).toFixed(2));
              startTransition(async () => {
                await updateLegMarkup(fd);
              });
            }}
          />
          {computedTransit !== null && (
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--mono)",
                fontSize: 10,
                color: "var(--ink-4)",
                letterSpacing: 0.04,
              }}
            >
              · {computedTransit}w in transit
            </span>
          )}
        </div>
      )}

      {/* Customer-arranges populated state (cargo ready already on leg head) */}
      {isCustomerArranges && customerMeta && (
        <div className="r62-customer-meta">
          <div className="field">
            <div className="lbl">Customer freight contact</div>
            <DebouncedTextInput
              key={`contact-${legId}`}
              defaultValue={customerMeta.customerContact ?? ""}
              disabled={!editable || pending}
              placeholder="Name · email"
              onCommit={(v) => {
                updateMetaStore(legId, { customerContact: v });
                const fd = new FormData();
                fd.set("legId", legId);
                fd.set("customerContact", v ?? "");
                fd.set("auditNote", customerMeta.auditNote ?? "");
                startTransition(async () => {
                  await updateCustomerArrangesMeta(fd);
                });
              }}
            />
          </div>
          <div className="field audit-note-field">
            <div className="lbl">Audit note</div>
            <DebouncedTextarea
              key={`audit-${legId}`}
              defaultValue={customerMeta.auditNote ?? ""}
              disabled={!editable || pending}
              placeholder="Pickup window, 3PL details, contractual references…"
              onCommit={(v) => {
                updateMetaStore(legId, { auditNote: v });
                const fd = new FormData();
                fd.set("legId", legId);
                fd.set("customerContact", customerMeta.customerContact ?? "");
                fd.set("auditNote", v ?? "");
                startTransition(async () => {
                  await updateCustomerArrangesMeta(fd);
                });
              }}
            />
          </div>
        </div>
      )}

      {/* Per-tier rate table (DPS-arranges only) */}
      {!isCustomerArranges && (
        <PerTierRateTable
          legId={legId}
          tiers={tiers}
          legTiers={legTiers}
          freightMarkupPct={leg.freightMarkupPct}
          editable={editable}
        />
      )}

      {/* Customs cluster (DDP + crosses_border) */}
      {showCustoms && (
        <CustomsCluster
          legId={legId}
          incoterm={leg.incoterm ?? "DDP"}
          customs={leg.customs}
          dutyMarkupPct={leg.dutyMarkupPct}
          tariffMarkupPct={leg.tariffMarkupPct}
          editable={editable}
          onCustomsCommit={(fields) => {
            updateLegCustomsStore(legId, fields);
            const fd = new FormData();
            fd.set("legId", legId);
            if ("dutyPct" in fields) {
              fd.set(
                "dutyPct",
                fields.dutyPct === undefined ? "" : String(fields.dutyPct * 100),
              );
            }
            if ("tariffPct" in fields) {
              fd.set(
                "tariffPct",
                fields.tariffPct === undefined
                  ? ""
                  : String(fields.tariffPct * 100),
              );
            }
            startTransition(async () => {
              await updateLegCustoms(fd);
            });
          }}
          onMarkupCommit={(component, value) => {
            updateLegMarkupStore(legId, component, value);
            const fd = new FormData();
            fd.set("legId", legId);
            fd.set("component", component);
            fd.set("value", (value * 100).toFixed(2));
            startTransition(async () => {
              await updateLegMarkup(fd);
            });
          }}
        />
      )}

      {/* PDF slot — P1 visual; upload P2 per Gap 24 */}
      {!isCustomerArranges && (
        <div className="r62-pdf empty">
          ↑ Attach forwarder quote PDF
          <span className="r62-phase-tag p2" style={{ marginLeft: 8 }}>
            upload · P2
          </span>
        </div>
      )}
    </div>
  );
}

// ---- per-tier rate table ----

function PerTierRateTable({
  legId,
  tiers,
  legTiers,
  freightMarkupPct,
  editable,
}: {
  legId: string;
  tiers: Tier[];
  legTiers: Array<{
    rowId: string;
    freightLegId: string;
    tierId: string;
    totalFreight: number | null;
    unitsInShipment: number | null;
  }>;
  freightMarkupPct: number;
  editable: boolean;
}) {
  const updateLegTier = useCostingStore(selectUpdateFreightLegTier);
  const [pending, startTransition] = useTransition();

  return (
    <div className="r62-tier-table">
      <div className="r62-tier-thead">
        <span>Tier</span>
        <span>Units</span>
        <span className="num">Total freight (cost)</span>
        <span className="num">Per unit (billable)</span>
        <span></span>
      </div>
      {tiers.map((t) => {
        const row = legTiers.find(
          (lt) => lt.freightLegId === legId && lt.tierId === t.id,
        );
        const effectiveUnits = row?.unitsInShipment ?? t.qty ?? 0;
        const billablePerUnit =
          row?.totalFreight !== null &&
          row?.totalFreight !== undefined &&
          effectiveUnits > 0
            ? (row.totalFreight * (1 + freightMarkupPct)) / effectiveUnits
            : null;
        return (
          <div key={t.id} className="r62-tier-row">
            <span className="tier-label">{t.label}</span>
            <span className="units">
              {(t.qty ?? 0).toLocaleString()}
            </span>
            <span className="num">
              <TierTotalFreightCell
                rowId={row?.rowId ?? null}
                defaultValue={row?.totalFreight ?? null}
                disabled={!editable || pending}
                onCommit={(value) => {
                  if (!row) return;
                  updateLegTier(row.rowId, { totalFreight: value });
                  const fd = new FormData();
                  fd.set("rowId", row.rowId);
                  fd.set("totalFreight", value === null ? "" : String(value));
                  fd.set(
                    "unitsInShipment",
                    row.unitsInShipment === null
                      ? ""
                      : String(row.unitsInShipment),
                  );
                  startTransition(async () => {
                    await updateLegTierCell(fd);
                  });
                }}
              />
            </span>
            <span className="num per-unit">
              {billablePerUnit === null ? (
                <span
                  style={{
                    color: "var(--ink-4)",
                    fontStyle: "italic",
                    fontFamily: "var(--ui)",
                    fontSize: 11,
                  }}
                >
                  —
                </span>
              ) : (
                <>
                  {fmtCurr2(billablePerUnit)}
                  <span className="raw">
                    ${(row?.totalFreight ?? 0).toLocaleString()} ×{" "}
                    {(1 + freightMarkupPct).toFixed(2)} ÷{" "}
                    {effectiveUnits.toLocaleString()}
                  </span>
                </>
              )}
            </span>
            <span></span>
          </div>
        );
      })}
    </div>
  );
}

function TierTotalFreightCell({
  rowId,
  defaultValue,
  disabled,
  onCommit,
}: {
  rowId: string | null;
  defaultValue: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [value, setValue] = useState<string>(
    defaultValue === null ? "" : String(defaultValue),
  );
  // Re-hydrate on rowId / external value change.
  useEffect(() => {
    setValue(defaultValue === null ? "" : String(defaultValue));
  }, [rowId, defaultValue]);

  if (!rowId) {
    return (
      <span
        style={{
          color: "var(--ink-4)",
          fontStyle: "italic",
          fontFamily: "var(--ui)",
          fontSize: 11,
        }}
      >
        —
      </span>
    );
  }

  function commitIfChanged() {
    const stripped = value.trim();
    if (stripped === "" && defaultValue === null) return;
    if (stripped !== "" && Number(stripped) === defaultValue) return;
    const next = stripped === "" ? null : Number(stripped);
    onCommit(Number.isFinite(next as number) || next === null ? next : null);
  }

  return (
    <input
      type="number"
      step="1"
      min={0}
      value={value}
      disabled={disabled}
      placeholder="total $"
      aria-label="Total freight cost for this tier"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commitIfChanged}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ---- customs cluster ----

function CustomsCluster({
  legId: _legId,
  incoterm,
  customs,
  dutyMarkupPct,
  tariffMarkupPct,
  editable,
  onCustomsCommit,
  onMarkupCommit,
}: {
  legId: string;
  incoterm: string;
  customs: { dutyPct?: number; tariffPct?: number };
  dutyMarkupPct: number;
  tariffMarkupPct: number;
  editable: boolean;
  onCustomsCommit: (fields: {
    dutyPct?: number | undefined;
    tariffPct?: number | undefined;
  }) => void;
  onMarkupCommit: (component: "duty" | "tariff", value: number) => void;
}) {
  return (
    <div className="r62-customs">
      <div className="r62-customs-head">
        <span className="lab">
          Customs · {incoterm} · border crossing
        </span>
        <span className="desc">
          Duty + tariff land on freight at port of entry · markup applied
          to amount, not rate
        </span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="cell">
          <div className="ck">Duty rate</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <CustomsPctCell
              defaultValue={customs.dutyPct ?? null}
              disabled={!editable}
              onCommit={(v) =>
                onCustomsCommit({ dutyPct: v === null ? undefined : v })
              }
            />
            <MarkupPill
              value={dutyMarkupPct}
              disabled={!editable}
              onCommit={(v) => onMarkupCommit("duty", v)}
            />
          </div>
        </div>
        <div className="cell">
          <div className="ck">Tariff (Section 301)</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <CustomsPctCell
              defaultValue={customs.tariffPct ?? null}
              disabled={!editable}
              onCommit={(v) =>
                onCustomsCommit({ tariffPct: v === null ? undefined : v })
              }
            />
            <MarkupPill
              value={tariffMarkupPct}
              disabled={!editable}
              onCommit={(v) => onMarkupCommit("tariff", v)}
            />
          </div>
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px dashed oklch(0.55 0.07 215 / 0.25)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: 0.04,
          textTransform: "uppercase",
        }}
      >
        Math: duty_billable = duty_pct × goods_cost × (1 + duty_markup) ·
        tariff same · feeds D+T row
      </div>
    </div>
  );
}

function CustomsPctCell({
  defaultValue,
  disabled,
  onCommit,
}: {
  defaultValue: number | null;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [value, setValue] = useState<string>(
    defaultValue === null ? "" : (defaultValue * 100).toFixed(1),
  );
  useEffect(() => {
    setValue(defaultValue === null ? "" : (defaultValue * 100).toFixed(1));
  }, [defaultValue]);

  function commitIfChanged() {
    const stripped = value.trim();
    if (stripped === "" && defaultValue === null) return;
    const n = stripped === "" ? null : Number(stripped) / 100;
    if (
      n !== null &&
      defaultValue !== null &&
      Math.abs(n - defaultValue) < 1e-9
    )
      return;
    onCommit(n);
  }

  return (
    <input
      type="number"
      step="0.1"
      min={0}
      value={value}
      disabled={disabled}
      placeholder="0.0%"
      style={{ flex: "0 0 60px" }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commitIfChanged}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ---- markup pill ----

function MarkupPill({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editValue, setEditValue] = useState<string>(
    (value * 100).toFixed(0),
  );
  const isDefault = Math.abs(value - 0.3) < 0.0001;

  useEffect(() => {
    setEditValue((value * 100).toFixed(0));
  }, [value]);

  function commitIfChanged() {
    setOpen(false);
    const stripped = editValue.trim();
    if (stripped === "") {
      // Empty → revert to current (Gap 13).
      setEditValue((value * 100).toFixed(0));
      return;
    }
    const n = Number(stripped);
    if (!Number.isFinite(n)) {
      setEditValue((value * 100).toFixed(0));
      return;
    }
    if (n < 0 || n > 999.99) {
      // Range reject inline (Gap 13). Revert.
      setEditValue((value * 100).toFixed(0));
      return;
    }
    const dec = n / 100;
    if (Math.abs(dec - value) < 1e-9) return;
    onCommit(dec);
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginLeft: 8,
      }}
    >
      {open ? (
        <input
          autoFocus
          type="number"
          step="1"
          min={0}
          value={editValue}
          disabled={disabled}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitIfChanged}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setEditValue((value * 100).toFixed(0));
              setOpen(false);
            }
          }}
          style={{
            width: 48,
            padding: "2px 6px",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            fontFamily: "var(--mono)",
            fontSize: 11,
            background: "var(--paper)",
            color: "var(--ink)",
            textAlign: "right",
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          title={
            isDefault
              ? "Default markup — click to override"
              : "Override — click to edit"
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            padding: "1px 6px",
            borderRadius: 4,
            fontFamily: "var(--mono)",
            fontSize: 10,
            background: isDefault
              ? "var(--paper-3)"
              : "oklch(from var(--accent) l c h / 0.12)",
            color: isDefault ? "var(--ink-3)" : "var(--accent-ink)",
            border: `1px solid ${
              isDefault ? "var(--rule)" : "oklch(from var(--accent) l c h / 0.30)"
            }`,
            cursor: disabled ? "not-allowed" : "pointer",
            lineHeight: 1.4,
            letterSpacing: 0.02,
          }}
        >
          × {(1 + value).toFixed(2)}
          {!isDefault && (
            <span style={{ fontSize: 9, opacity: 0.7 }}>OVR</span>
          )}
        </button>
      )}
    </span>
  );
}

// ---- leg action menu (delete / move) ----

function LegActionMenu({
  position,
  siblingCount,
  editable,
  pending,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  position: number;
  siblingCount: number;
  editable: boolean;
  pending: boolean;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  return (
    <div
      ref={ref}
      className="actions"
      style={{ position: "relative", cursor: "pointer" }}
    >
      <button
        type="button"
        disabled={!editable || pending}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--ink-3)",
          cursor: "pointer",
          padding: "0 6px",
          fontFamily: "var(--mono)",
          fontSize: 14,
        }}
        title="Leg actions"
      >
        ···
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 10,
            background: "var(--paper)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            boxShadow: "0 4px 12px oklch(0 0 0 / 0.12)",
            minWidth: 140,
            padding: "4px 0",
          }}
        >
          <MenuItem
            label="Delete leg"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
          <MenuItem
            label="Move up"
            disabled={position === 0}
            onClick={() => {
              setOpen(false);
              onMoveUp();
            }}
          />
          <MenuItem
            label="Move down"
            disabled={position === siblingCount - 1}
            onClick={() => {
              setOpen(false);
              onMoveDown();
            }}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        padding: "6px 12px",
        textAlign: "left",
        background: "transparent",
        border: "none",
        color: disabled ? "var(--ink-4)" : "var(--ink)",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ---- body grid field wrapper ----

function BodyField({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <div className="lbl">{label}</div>
      {children}
    </div>
  );
}

// ---- debounced text input + textarea (autosave on blur) ----

function DebouncedTextInput({
  defaultValue,
  disabled,
  placeholder,
  onCommit,
}: {
  defaultValue: string;
  disabled: boolean;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);
  function commitIfChanged() {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : trimmed;
    const prev = defaultValue.trim() === "" ? null : defaultValue;
    if (next === prev) return;
    onCommit(next);
  }
  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commitIfChanged}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function DebouncedTextarea({
  defaultValue,
  disabled,
  placeholder,
  onCommit,
}: {
  defaultValue: string;
  disabled: boolean;
  placeholder?: string;
  onCommit: (value: string | null) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);
  function commitIfChanged() {
    const next = value === "" ? null : value;
    const prev = defaultValue === "" ? null : defaultValue;
    if (next === prev) return;
    onCommit(next);
  }
  return (
    <textarea
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commitIfChanged}
    />
  );
}

// ---- add-leg modal ----

// Slice R6.2 — Add Leg modal uses the canonical .r62-drawer-* form
// register inside a centered Modal overlay (per kickoff: same field
// set as the slide-in drawer, different chrome). Modal primitive
// provides the portal + overlay positioning; the inner sections
// (.r62-drawer-head/body/foot, .field/.lbl, .row-pair, .row-route,
// .r62-drawer-section, .r62-drawer-rates, .r62-drawer-customs,
// .r62-drawer-pdf) match the canonical R6.2 prototype's AddLegDrawer
// design 1:1.
function AddLegModal({
  legGroupId,
  tiers,
  onClose,
}: {
  legGroupId: string;
  tiers: Tier[];
  onClose: () => void;
}) {
  const [direction, setDirection] = useState<"inbound" | "outbound">(
    "outbound",
  );
  const [label, setLabel] = useState("");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [mode, setMode] = useState<string>("ocean_fcl");
  const [carrier, setCarrier] = useState("");
  const [incoterm, setIncoterm] = useState<string>("DDP");
  const [cargoReadyDate, setCargoReadyDate] = useState("");
  const [vesselEtd, setVesselEtd] = useState("");
  const [crossesBorder, setCrossesBorder] = useState(true);
  const [treatment, setTreatment] = useState<"bundled" | "pass_through">(
    "bundled",
  );
  // Per-component markup pcts (canonical: default 0.30, overridable
  // per-leg, per Cally's tariff-anomaly case). Sent to addLeg as
  // decimals already wired in the action layer.
  const [freightMk, setFreightMk] = useState(0.3);
  const [dutyMk, setDutyMk] = useState(0.3);
  const [tariffMk, setTariffMk] = useState(0.3);
  // Customs rates (canonical: percent-display). Sent to addLeg which
  // stores them in the leg's customs JSONB.
  const [dutyPct, setDutyPct] = useState("");
  const [tariffPct, setTariffPct] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Customs cluster visibility — same rule as the rendered leg
  // (crosses_international_border AND incoterm === 'DDP').
  const showCustoms = crossesBorder && incoterm === "DDP";

  function handleSubmit() {
    setError(null);
    const fd = new FormData();
    fd.set("legGroupId", legGroupId);
    fd.set("direction", direction);
    fd.set("label", label);
    fd.set("origin", origin);
    fd.set("destination", destination);
    fd.set("crossesInternationalBorder", crossesBorder ? "true" : "false");
    fd.set("treatment", treatment);
    fd.set("mode", mode);
    fd.set("carrier", carrier);
    fd.set("incoterm", incoterm);
    fd.set("cargoReadyDate", cargoReadyDate);
    fd.set("vesselEtd", vesselEtd);
    // Per-component markup decimals → percent-display for the action
    // layer's parseMarkupPct helper (divides by 100 on store).
    fd.set("freightMarkupPct", (freightMk * 100).toFixed(2));
    fd.set("dutyMarkupPct", (dutyMk * 100).toFixed(2));
    fd.set("tariffMarkupPct", (tariffMk * 100).toFixed(2));
    if (showCustoms) {
      if (dutyPct.trim() !== "") fd.set("dutyPct", dutyPct);
      if (tariffPct.trim() !== "") fd.set("tariffPct", tariffPct);
    }
    startTransition(async () => {
      const result = await addLeg(fd);
      if (result.ok) {
        onClose();
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <Modal open onClose={onClose} size="lg">
      <div className="r62-drawer-head">
        <div>
          <h2>Add freight leg</h2>
          <p className="sub">
            Customs cluster appears when this leg crosses an international
            border with DPS-customs obligation.
          </p>
        </div>
        <button
          type="button"
          className="close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div className="r62-drawer-body">
        <div className="row-pair">
          <div className="field">
            <div className="lbl">Direction</div>
            <select
              value={direction}
              onChange={(e) =>
                setDirection(e.target.value as "inbound" | "outbound")
              }
            >
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
          </div>
          <div className="field">
            <div className="lbl">Incoterm</div>
            <select
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value)}
            >
              {INCOTERMS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.value} — {t.desc}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <div className="lbl">Label</div>
          <input
            type="text"
            value={label}
            placeholder="e.g., Shenzhen → Busan · Bulk container"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div className="row-pair">
          <div className="field">
            <div className="lbl">Mode</div>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              {FREIGHT_LEG_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <div className="lbl">Carrier</div>
            <input
              type="text"
              value={carrier}
              placeholder="Sino Logistics"
              onChange={(e) => setCarrier(e.target.value)}
            />
          </div>
        </div>

        <div className="row-route">
          <div className="field">
            <div className="lbl">Origin</div>
            <input
              type="text"
              value={origin}
              placeholder="Shenzhen Yantian Port"
              onChange={(e) => setOrigin(e.target.value)}
            />
          </div>
          <span className="arrow">→</span>
          <div className="field">
            <div className="lbl">Destination</div>
            <input
              type="text"
              value={destination}
              placeholder="Long Beach Port"
              onChange={(e) => setDestination(e.target.value)}
            />
          </div>
        </div>

        <div className="row-pair">
          <div className="field">
            <div className="lbl">Cargo ready date</div>
            <input
              type="date"
              value={cargoReadyDate}
              onChange={(e) => setCargoReadyDate(e.target.value)}
            />
          </div>
          <div className="field">
            <div className="lbl">
              Vessel ETD
              {(incoterm === "FOB" || incoterm === "EXW") && (
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: 9,
                    color: "var(--ink-4)",
                    fontStyle: "italic",
                    textTransform: "none",
                    letterSpacing: 0,
                  }}
                >
                  · optional
                </span>
              )}
            </div>
            <input
              type="date"
              value={vesselEtd}
              onChange={(e) => setVesselEtd(e.target.value)}
            />
          </div>
        </div>

        {/* Crosses-border checkbox — canonical inline paper-2 box */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={crossesBorder}
            onChange={(e) => setCrossesBorder(e.target.checked)}
          />
          <span>Crosses international border with DPS-customs obligation</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              color: "var(--ink-4)",
              letterSpacing: 0.06,
              textTransform: "uppercase",
            }}
          >
            drives customs visibility
          </span>
        </label>

        {/* Treatment toggle — canonical .r62-treat per-line shape */}
        <div className="field">
          <div className="lbl">Treatment</div>
          <div className="r62-treat" style={{ alignSelf: "flex-start" }}>
            <button
              type="button"
              className={treatment === "bundled" ? "on bundled" : ""}
              onClick={() => setTreatment("bundled")}
            >
              Bundled
            </button>
            <button
              type="button"
              className={
                treatment === "pass_through" ? "on passthrough" : ""
              }
              onClick={() => setTreatment("pass_through")}
            >
              Passthrough
            </button>
          </div>
        </div>

        {/* Markup pcts panel — canonical: three inline pills,
            paper-2 box, mono caption "per-component · default 0.30" */}
        <div
          style={{
            padding: "10px 14px",
            background: "var(--paper-2)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              letterSpacing: 0.1,
              textTransform: "uppercase",
              color: "var(--ink-4)",
              marginBottom: 8,
            }}
          >
            Markup pcts · per-component · default 0.30
          </div>
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              fontSize: 12,
            }}
          >
            <span>
              Freight{" "}
              <MarkupPill
                value={freightMk}
                disabled={false}
                onCommit={setFreightMk}
              />
            </span>
            <span>
              Duty{" "}
              <MarkupPill
                value={dutyMk}
                disabled={false}
                onCommit={setDutyMk}
              />
            </span>
            <span>
              Tariff{" "}
              <MarkupPill
                value={tariffMk}
                disabled={false}
                onCommit={setTariffMk}
              />
            </span>
          </div>
        </div>

        {/* Rates per tier — canonical .r62-drawer-rates mini-table.
            Visual fidelity in v1; enter values on the rendered leg's
            per-tier rate table after add (the leg's leg-tier rows
            are seeded null at insert time). Banked for v1.1 wiring:
            send per-tier seed values into addLeg's action contract. */}
        <div className="r62-drawer-section">
          <h4>Rates per tier</h4>
          <div className="r62-drawer-rates">
            <span className="h">Tier</span>
            <span className="h num">Total freight</span>
            <span className="h num">Per unit (billable)</span>
            {tiers.map((t) => (
              <React.Fragment key={t.id}>
                <span className="t-lab">{t.label}</span>
                <input
                  type="number"
                  disabled
                  placeholder="$ — "
                  title="Enter rates on the leg's per-tier table after adding"
                />
                <span className="per-unit">—</span>
              </React.Fragment>
            ))}
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--mono)",
              fontSize: 9.5,
              letterSpacing: 0.04,
              color: "var(--ink-4)",
            }}
          >
            Enter per-tier rates on the leg row after adding · v1
          </p>
        </div>

        {/* Customs section — canonical .r62-drawer-section with
            .grid3 layout. Visible only when crosses_border + DDP. */}
        {showCustoms && (
          <div className="r62-drawer-section">
            <h4>Customs · {incoterm} · border</h4>
            <div
              className="grid3"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div className="field">
                <div className="lbl">Duty %</div>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={dutyPct}
                  placeholder="5.8"
                  onChange={(e) => setDutyPct(e.target.value)}
                />
              </div>
              <div className="field">
                <div className="lbl">Tariff %</div>
                <input
                  type="number"
                  step="0.1"
                  min={0}
                  value={tariffPct}
                  placeholder="7.5"
                  onChange={(e) => setTariffPct(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* PDF attachment slot — visual P1; upload P2 per Gap 24 */}
        <div className="r62-drawer-pdf">
          ↑ Attach forwarder quote PDF{" "}
          <span className="r62-phase-tag p2" style={{ marginLeft: 8 }}>
            upload · P2
          </span>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              background: "var(--bad-soft)",
              border: "1px solid oklch(from var(--bad) l c h / 0.40)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--bad)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div className="r62-drawer-foot">
        <span className="left">
          Border + incoterm drive customs visibility · markup applied to amount
        </span>
        <div className="right">
          <button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleSubmit}
            disabled={pending}
          >
            {pending ? "Adding…" : "Add leg"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Helpers + utilities banked above; fmtPct + fmtDate kept for future
// surface polish (currently unreferenced in this build).
void fmtPct;
void fmtDate;
