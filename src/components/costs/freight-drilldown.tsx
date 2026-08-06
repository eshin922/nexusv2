"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  addFreightDestination,
  createFreightSubcategory,
  deleteFreightDestination,
  selectFreightDestination,
  updateFreightCustomsBreak,
  updateFreightCustomsEntry,
  updateFreightDestination,
  updateFreightDestinationBreakGroup,
  updateFreightSubcategory,
  updateFreightTracking,
} from "@/app/actions/freight-worksheet";
import type { FreightWorkbook } from "@/lib/freight-workbook";
import { FREIGHT_LEG_MODES, enumLabel } from "@/lib/enum-labels";
import { alignBreaksToTiers } from "@/lib/freight-tier-cells";

type Tier = { id: string; label: string; qty: number | null; recommended?: boolean };
type Product = { id: string; label: string };
type Component = { id: string; assemblyId: string; label: string; sku: string | null };
type Result = { ok: boolean; data?: Record<string, unknown>; error?: { message: string } };

const money4 = (value: number) => `$${value.toFixed(4)}`;
const money2 = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });
const autosave = (formId: string) => () => {
  const form = document.getElementById(formId);
  if (form instanceof HTMLFormElement) form.requestSubmit();
};
// Reconciliation coalesce window. Long enough to absorb a burst of blurs as
// the operator tabs across a row, short enough that a deliberate single edit
// still reconciles promptly. Mirrors the 250ms realtime coalesce in
// costing-store-provider; blur bursts are slower than keystrokes, so this
// sits slightly wider.
const REFRESH_COALESCE_MS = 400;

const fields = (values: Record<string, string | number | null | undefined>) => {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value === null || value === undefined ? "" : String(value)));
  return data;
};

/**
 * Shipment coverage for one Setup product group.
 *
 * Membership answers "what is this shipment for"; coverage answers the
 * question the operator actually holds in their head — "is everything
 * accounted for yet?". Without it, recording a split shipment means tracking
 * the remainder mentally across several modal openings.
 *
 * Overlap is legitimate: a component may travel in more than one shipment
 * (part ocean, part air). So a component counts as assigned once it appears in
 * any shipment, and coverage is complete when nothing is left over — not when
 * assignments sum to the component count.
 */
function shipmentCoverage(
  productComponents: Component[],
  shipments: Array<{ id: string }>,
  memberships: Array<{ freightSubcategoryId: string; assemblyLeafId: string }>,
) {
  const shipmentIds = new Set(shipments.map((s) => s.id));
  const assignedIds = new Set(
    memberships
      .filter((m) => shipmentIds.has(m.freightSubcategoryId))
      .map((m) => m.assemblyLeafId),
  );
  const assigned = productComponents.filter((c) => assignedIds.has(c.id));
  const unassigned = productComponents.filter((c) => !assignedIds.has(c.id));
  return {
    assigned,
    unassigned,
    complete: productComponents.length > 0 && unassigned.length === 0,
  };
}

export function FreightDrilldown(props: {
  quoteId: string;
  tiers: Tier[];
  editable: boolean;
  workbook: FreightWorkbook;
  products: Product[];
  components: Component[];
}) {
  const { quoteId, tiers, editable, workbook, products, components } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [createProductId, setCreateProductId] = useState<string | null>(null);
  const [openDestinations, setOpenDestinations] = useState<string[]>(() =>
    workbook.destinations.length <= 2 ? workbook.destinations.map((row) => row.id) : [],
  );
  const [openSupport, setOpenSupport] = useState<string[]>([]);

  // Section-level expand-all (disposition C1). The bundle justifies this as
  // the answer to Option A's own weakness — nine disclosures to type
  // twenty-seven totals. It operates on destination rows, not on the host
  // accordion, so it stays in the section body rather than migrating
  // upward with the family summary.
  const allDestinationIds = workbook.destinations.map((row) => row.id);
  const allDetailOpen =
    allDestinationIds.length > 0 && openDestinations.length === allDestinationIds.length;

  // Action-scoped pending (Pattern 47(f)).
  //
  // A single shared transition previously gated every control on this
  // surface, so any in-flight write disabled unrelated workflows -- most
  // visibly, editing a break left "+ Record shipment" dead with no
  // explanation. Availability is now keyed to the action that owns it:
  // `pendingKey` names the specific action instance in flight, and a control
  // consults `busy(key)` for its own key only.
  //
  // The key carries the entity id, so editing one destination cannot disable
  // the controls of its sibling.
  //
  // Write-to-render timing marks are retained alongside it. They are what
  // identified the refresh-amplification defect below, and they stay while
  // the deployed latency is still being reduced. `browser update` fires after
  // paint, so it reports when the operator can actually read the value.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const busy = (key: string) => pendingKey === key;

  // Coalesced reconciliation — refresh amplification correction.
  //
  // Every autosave-on-blur previously called router.refresh() directly. A
  // burst of related edits (freight, then markup, then duty, or tabbing
  // through one row) therefore issued one FULL-PAGE refresh per field.
  //
  // Measured on the deployed preview, one interaction produced ~14-15
  // concurrent GET /costs requests. Renders started ~12 times and completed
  // once: eleven were abandoned after already paying post-auth (338-1058ms)
  // and post-meta (463-1784ms), and the survivor took 3689ms. Each render
  // runs an 8-wide Promise.all, so ~15 in flight is ~120 concurrent database
  // operations against a pool sized max:3 -- the documented saturation shape,
  // reached through self-inflicted fan-out rather than user traffic.
  //
  // revalidateQuoteTree is NOT the cause; it measured 0-1ms. The cost is the
  // refresh count, so the fix is to make refreshes scale with the operator's
  // interaction rather than with the number of fields they touched.
  //
  // Trailing debounce: each edit cancels the pending refresh and re-arms it,
  // so a burst settles into exactly one reconciliation. Server writes are
  // untouched -- every edit still persists immediately and independently;
  // only the read-back is coalesced.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = (since?: (label: string) => void) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      since?.("refresh coalesced");
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      since?.("refresh start");
      router.refresh();
      // The transition resolves once the refreshed tree is applied, so the
      // next frame is the first on which the operator can read the value.
      requestAnimationFrame(() => since?.("browser update"));
    }, REFRESH_COALESCE_MS);
  };

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  const submit = (action: (fd: FormData) => Promise<Result>, key: string, onSuccess?: (result: Result) => void) => (fd: FormData) => {
    setMessage(null);
    setPendingKey(key);
    const t0 = performance.now();
    const since = (label: string) =>
      console.log(`[freight-timing] ${label.padEnd(22)} ${(performance.now() - t0).toFixed(0)} ms`);
    since("submit");
    startTransition(async () => {
      since("action start");
      const result = await action(fd);
      since("action complete");
      if (!result.ok) setMessage(result.error?.message ?? "Unable to save freight worksheet.");
      else {
        if (result.data?.selectionCleared) setMessage(`${result.data.deletedDestination} was removed. No destination is in the price; choose one explicitly.`);
        onSuccess?.(result);
        scheduleRefresh(since);
      }
      setPendingKey(null);
    });
  };

  return <div className="cw-section freight-authority" style={{ "--freight-tier-count": tiers.length } as CSSProperties}>
    <div className="fr-grid fr-tierhead"><div className="lab">Freight · sell per unit{allDestinationIds.length > 0 && <button className={`fr-edit${allDetailOpen ? " on" : ""}`} onClick={() => setOpenDestinations(allDetailOpen ? [] : allDestinationIds)}>{allDetailOpen ? "hide all detail" : `show type + description · all ${allDestinationIds.length}`}</button>}</div>{tiers.map((tier) => <div className="fr-cell" key={tier.id}><span className="v">{tier.label}{tier.recommended && <span className="rec"> ★</span>}</span><span className="s">{tier.qty?.toLocaleString()} units</span></div>)}</div>
    {message && <div className="fr-lost" role="alert"><span className="mk">!</span><span>{message}</span></div>}

    {products.map((product) => {
      const productComponents = components.filter((item) => item.assemblyId === product.id);
      const shipments = workbook.subcategories.filter((item) => item.assemblyId === product.id);
      const coverage = shipmentCoverage(productComponents, shipments, workbook.memberships);
      return <div className={`fr-product-group${products.length === 1 ? " single" : ""}`} key={product.id}>
        {/* Components carry their coverage state, so "what still needs a
            shipment" is readable from the product head rather than
            reconstructed by opening each shipment in turn. */}
        <div className="fr-product-head"><div className="identity"><strong className="product-name">{product.label}</strong><span className="source">Commercial structure from Setup</span></div><div className="fr-product-components"><span className="k">Components</span>{productComponents.map((item) => <span className={`fr-chip${coverage.assigned.some((c) => c.id === item.id) ? " on" : ""}`} key={item.id} title={coverage.unassigned.some((c) => c.id === item.id) ? "Not yet in any shipment" : "Assigned to a shipment"}>{item.label}</span>)}</div>{editable && <button className="fr-addbtn" onClick={() => setCreateProductId(product.id)}>{shipments.length ? "+ Record shipment" : products.length === 1 ? "+ What ships" : "+ Record shipment"}</button>}</div>
        {shipments.length > 0 && (
          <div className={`fr-coverage${coverage.complete ? " complete" : ""}`} role="status">
            <span className="k">coverage</span>
            {coverage.complete ? (
              <span>All {productComponents.length} components are in a shipment.</span>
            ) : (
              <span>
                <strong>{coverage.unassigned.length} of {productComponents.length}</strong> not yet
                in any shipment: {coverage.unassigned.map((c) => c.sku || c.label).join(", ")}.
              </span>
            )}
          </div>
        )}
        {shipments.length === 0 && <div className="fr-empty"><div className="t">Nothing ships yet</div><div className="s">Record the Logistics decision for this Setup product. Its components, SKU hierarchy and quantity tiers are already established.</div></div>}
        {shipments.map((shipment, index) => <ShipmentLedger
          key={shipment.id} shipment={shipment} index={index} count={shipments.length}
          tiers={tiers} workbook={workbook} components={components} editable={editable} busy={busy}
          openDestinations={openDestinations} setOpenDestinations={setOpenDestinations}
          supportOpen={openSupport.includes(shipment.id)} setSupportOpen={(open: boolean) => setOpenSupport((rows) => open ? [...new Set([...rows, shipment.id])] : rows.filter((id) => id !== shipment.id))}
          submit={submit}
        />)}
      </div>;
    })}
    {workbook.subcategories.length > 0 && <TotalStrip tiers={tiers} workbook={workbook}/>}
    {createProductId && (() => {
      const modalComponents = components.filter((item) => item.assemblyId === createProductId);
      const modalShipments = workbook.subcategories.filter((item) => item.assemblyId === createProductId);
      const modalCoverage = shipmentCoverage(modalComponents, modalShipments, workbook.memberships);
      // First shipment for a product: default to everything — the common case
      // is one shipment carrying the whole product. Subsequent shipments:
      // default to whatever is still unassigned, which is what the operator is
      // almost always recording next. Falls back to everything once coverage
      // is complete, since an overlapping shipment (part ocean, part air) is
      // legitimate and would otherwise open with nothing selected.
      const defaultSelected = (modalShipments.length === 0 || modalCoverage.unassigned.length === 0
        ? modalComponents
        : modalCoverage.unassigned).map((item) => item.id);
      return <CreateShipmentModal quoteId={quoteId} product={products.find((item) => item.id === createProductId)} components={modalComponents} defaultSelected={defaultSelected} remaining={modalShipments.length > 0 && modalCoverage.unassigned.length > 0} pending={busy(`createShipment:${createProductId}`)} close={() => setCreateProductId(null)} submit={submit(createFreightSubcategory, `createShipment:${createProductId}`, () => setCreateProductId(null))}/>;
    })()}
  </div>;
}

function ShipmentLedger({ shipment, index, count, tiers, workbook, components, editable, busy, openDestinations, setOpenDestinations, supportOpen, setSupportOpen, submit }: any) {
  const destinations = workbook.destinations.filter((row: any) => row.freightSubcategoryId === shipment.id);
  const memberships = workbook.memberships.filter((row: any) => row.freightSubcategoryId === shipment.id);
  const selected = destinations.find((row: any) => row.id === shipment.selectedDestinationId);
  const customsEntry = workbook.customsEntries.find((row: any) => row.freightSubcategoryId === shipment.id);
  const tracking = workbook.tracking.find((row: any) => row.freightDestinationId === shipment.selectedDestinationId);
  const staleTracking = workbook.tracking.find((row: any) => row.freightDestinationId !== shipment.selectedDestinationId && destinations.some((destination: any) => destination.id === row.freightDestinationId) && (row.etd || row.eta || row.actualDeliveryDate));
  const displayedTracking = tracking ?? staleTracking;
  const forcedSupport = destinations.length > 1 && (!!selected && !shipment.selectionReason || !!staleTracking);
  const shownSupport = supportOpen || forcedSupport;
  return <div className={`fr-sc${destinations.length === 1 ? " solo" : ""}${shipment.crossesInternationalBorder ? " import" : ""}`}>
    <div className="fr-schead">
      <div className="fr-eyebrow"><span className="num">{index + 1} of {count}</span><span>what ships</span><span className={shipment.crossesInternationalBorder ? "kind" : undefined}>· {shipment.crossesInternationalBorder ? "import · clears customs" : "domestic · no border"}</span></div>
      <div className="fr-scname"><span className="ships">{shipment.label}</span><span className="from">from {shipment.origin || "not set"}</span>{destinations.length > 1 && <span className={`count${shipment.selectedDestinationId ? "" : " undecided"}`}>{destinations.length} destinations priced</span>}</div>
      <div className="fr-skus"><span className="k">for</span>{memberships.length === components.filter((item: Component) => item.assemblyId === shipment.assemblyId).length && <span className="fr-chip all">all {memberships.length} SKUs</span>}{memberships.map((membership: any) => { const item = components.find((component: Component) => component.id === membership.assemblyLeafId); return item ? <span className="fr-chip on" key={item.id} title={item.label}>{item.sku || item.label}</span> : null; })}</div>
      <div className="fr-fields"><Fact label="carrier" value={shipment.carrierForwarder}/><Fact label="incoterm" value={shipment.incoterm}/><Fact label="journey" value={shipment.journeyLabel}/><Fact label="cargo ready" value={shipment.cargoReadyDate}/><Fact label="treatment" value={shipment.treatment === "pass_through" ? "pass-through" : "bundled · amortised across units"}/></div>
      {destinations.length > 1 && <DecisionSummary shipment={shipment} destinations={destinations} selected={selected} tiers={tiers} workbook={workbook}/>}
      {editable && <ShipmentEdit shipment={shipment} memberships={memberships} components={components} pending={busy(`editShipment:${shipment.id}`)} submit={submit(updateFreightSubcategory, `editShipment:${shipment.id}`)}/>}
    </div>

    {destinations.map((destination: any) => <DestinationRow key={destination.id} destination={destination} shipment={shipment} destinations={destinations} selected={selected} tiers={tiers} workbook={workbook} editable={editable} busy={busy} open={openDestinations.includes(destination.id)} toggle={() => setOpenDestinations((rows: string[]) => rows.includes(destination.id) ? rows.filter((id) => id !== destination.id) : [...rows, destination.id])} submit={submit}/>)}

    {editable && <InlineDestination shipmentId={shipment.id} pending={busy(`addDestination:${shipment.id}`)} submit={submit(addFreightDestination, `addDestination:${shipment.id}`)}/>}
    {shipment.crossesInternationalBorder && <CustomsLedger shipment={shipment} tiers={tiers} entry={customsEntry} workbook={workbook} editable={editable} pending={busy(`customsBreak:${shipment.id}`) || busy(`customsEntry:${shipment.id}`)} submitBreak={submit(updateFreightCustomsBreak, `customsBreak:${shipment.id}`)} submitEntry={submit(updateFreightCustomsEntry, `customsEntry:${shipment.id}`)}/>}
    <div className="fr-fold"><button className={`fr-foldbtn${shownSupport ? " on" : ""}`} onClick={() => setSupportOpen(!shownSupport)} disabled={forcedSupport}><span className="cv">{shownSupport ? "▾" : "▸"}</span>{shownSupport ? "Hide supporting detail" : "Supporting detail"}</button><span className="fr-chips">{supportChips(shipment, destinations, tracking, staleTracking).map((chip) => <span className={`fr-fchip${chip.warn ? " warn" : ""}`} key={chip.t}>{chip.t}</span>)}</span>{forcedSupport && <span className="fr-forced">kept open — needs attention</span>}</div>
    {shownSupport && <><Comparison destinations={destinations} selected={selected} tiers={tiers} workbook={workbook}/>{destinations.length > 1 && <SelectionReason shipment={shipment} selected={selected} editable={editable} pending={busy(`selectDestination:${shipment.id}`)} submit={submit(selectFreightDestination, `selectDestination:${shipment.id}`)}/>}<TrackingStrip selected={selected} tracking={displayedTracking} stale={staleTracking} pending={busy(`tracking:${shipment.id}`)} submit={submit(updateFreightTracking, `tracking:${shipment.id}`)}/></>}
  </div>;
}

function DestinationRow({ destination, shipment, destinations, selected, tiers, workbook, editable, busy, open, toggle, submit }: any) {
  const rows = workbook.breaks.filter((row: any) => row.freightDestinationId === destination.id);
  const [flat, setFlat] = useState(destination.sameValueAllBreaks);
  const isSelected = destination.id === shipment.selectedDestinationId;
  const priced = rows.some((row: any) => row.freightAmount !== null);
  // A destination added after the first inherits type + markup from the one
  // above it (addFreightDestination seeds mode / markup / note from the
  // prior destination's breaks). The disclosure holds until the operator
  // prices it, at which point the values are theirs rather than carried.
  // A first destination has nothing to inherit from, so its breaks carry
  // neither mode nor markup and this is self-limiting.
  const inherited = !priced && rows.some((row: any) => row.mode || row.freightMarkupPct !== null);
  // One alignment path for every tier-positioned cell in this row. Columns
  // follow the tiers collection; each break row is resolved by id. See
  // src/lib/freight-tier-cells.ts for why this is not left to array order.
  const cells = alignBreaksToTiers<Tier, any>(tiers, rows);
  const modes = cells.map((cell) => cell.row?.mode ?? "");
  const varies = new Set(modes).size > 1;
  const comparisonTier: Tier | undefined = tiers.find((tier: Tier) => tier.recommended) ?? tiers[tiers.length - 1] ?? tiers[0];
  const delta = !isSelected && selected && comparisonTier
    ? sellPerUnit(destination, comparisonTier, workbook) - sellPerUnit(selected, comparisonTier, workbook)
    : null;
  const rowRef = useRef<HTMLDivElement>(null);
  const saveBreaks = () => {
    if (!rowRef.current) return;
    const data = fields({ destinationId: destination.id, sourceTierId: tiers[0]?.id, breakMode: flat ? "flat" : "different" });
    rowRef.current.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-break-field]").forEach((field) => data.set(field.name, field.value));
    submit(updateFreightDestinationBreakGroup, `breaks:${destination.id}`)(data);
  };
  return <div className={`fr-dest${isSelected && destinations.length > 1 ? " sel" : ""}`} ref={rowRef}>
    <div className="fr-grid">
      <div className="fr-dlab">{destinations.length > 1 && <button className={`fr-pick${isSelected ? " on" : ""}`} disabled={!editable || !priced || busy(`selectDestination:${shipment.id}`)} aria-label={`Select ${destination.destination}`} title={!priced ? "Enter a freight amount before selecting this destination" : busy(`selectDestination:${shipment.id}`) ? "Saving selection…" : undefined} onClick={() => submit(selectFreightDestination, `selectDestination:${shipment.id}`)(fields({ freightSubcategoryId: shipment.id, destinationId: destination.id, selectionReason: shipment.selectionReason }))}/>}<span className="fr-dname"><span className="n">{destinations.length > 1 ? "to " : ""}{destination.destination}{destination.consignee ? ` · ${destination.consignee}` : ""}</span><span className="m"><span>{destination.transitDays || "transit not set"} door to door</span><span className={varies ? "varies" : ""}>{varies ? modes.map(modeChip).join(" / ") : modeChip(modes[0] ?? "")}</span>{inherited && <span className="fr-inherit">type + markup inherited</span>}</span><input className="fr-note" defaultValue={destination.internalNotes ?? ""} placeholder="note — optional" disabled={!editable} onBlur={(event) => submit(updateFreightDestination, `editDestination:${destination.id}`)(fields({ destinationId: destination.id, destination: destination.destination, consignee: destination.consignee, transitDays: destination.transitDays, quoteReference: destination.quoteReference, internalNotes: event.currentTarget.value }))}/></span>{isSelected && destinations.length > 1 && <span className="fr-vs win">in the price</span>}{destinations.length > 1 && !isSelected && priced && delta !== null && <span className={`fr-vs ${delta > 0 ? "worse" : "better"}`}>{delta > 0 ? "+" : "−"}{money4(Math.abs(delta)).slice(1)}/unit</span>}{destinations.length > 1 && !priced && <span className="fr-vs">no total yet</span>}<button type="button" className="fr-tog" onClick={() => setFlat(!flat)}>{flat ? "differs by break" : "one value, all breaks"}</button><button className={`fr-edit${open ? " on" : ""}`} onClick={toggle}>{open ? "hide detail" : "type + description"}</button>{destinations.length > 1 && editable && <button className="fr-del" disabled={busy(`deleteDestination:${destination.id}`)} title={busy(`deleteDestination:${destination.id}`) ? "Removing…" : undefined} onClick={() => submit(deleteFreightDestination, `deleteDestination:${destination.id}`)(fields({ destinationId: destination.id }))}>remove</button>}</div>
      {cells.map(({ tier, row, index: tierIndex }) => { const amount = Number(row?.freightAmount ?? 0); const markup = Number(row?.freightMarkupPct ?? 0); const customsEntry = workbook.customsEntries.find((item: any) => item.freightSubcategoryId === shipment.id); const customsSell = customsEntry && tier.qty ? workbook.customsBreaks.filter((item: any) => item.freightCustomsEntryId === customsEntry.id && item.tierId === tier.id).reduce((sum: number, item: any) => sum + Number(item.amount ?? 0) * (1 + Number(item.markupPct ?? 0)), 0) / tier.qty : 0; return <div className="fr-cell fr-entrycell" key={tier.id}>{row ? flat && tierIndex > 0 ? <span className="cbm">one value, all breaks</span> : <><input className="fr-in" data-break-field name={`freightAmount:${tier.id}`} type="number" min="0" step="0.01" defaultValue={row.freightAmount ?? ""} placeholder="total cost" disabled={!editable} onBlur={saveBreaks}/><span className="mrow"><span className="x">×</span><input className="fr-in pct" data-break-field name={`freightMarkupPct:${tier.id}`} type="number" min="0" max="999" step="1" placeholder="40" aria-label="Freight markup, whole percent" title="Enter whole percent — 40 means 40%" defaultValue={row.freightMarkupPct === null ? "" : markup * 100} disabled={!editable} onBlur={saveBreaks}/><span className="arr">→</span><span className="sell">{priced && tier.qty ? money4(amount * (1 + markup) / tier.qty) : "—"}</span></span>{shipment.crossesInternationalBorder && priced && <span className="cbm">incl. d/t {money4(customsSell).slice(1)}</span>}</> : "—"}</div>; })}
    </div>
    {/* Mode and description render for EVERY break regardless of flat state.
        "One value, all breaks" governs the commercial terms (amount + markup)
        — a shipment may be LTL at one break and FTL at another while sharing
        one negotiated amount at one markup. Suppressing these inputs when flat would collapse
        the operational identity of the individual quantity breaks. */}
    {open && <div className="fr-entry"><div className="fr-grid"><div className="fr-elab">freight type · per break</div>{cells.map(({ tier, row }) => <div className="fr-cell" key={tier.id}>{row ? <select className="fr-in txt" data-break-field name={`mode:${tier.id}`} defaultValue={row.mode ?? ""} disabled={!editable} onChange={saveBreaks} aria-label={`Freight type · ${tier.label}`}><option value="">Not set</option>{FREIGHT_LEG_MODES.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select> : <span className="cbm">—</span>}</div>)}</div><div className="fr-grid"><div className="fr-elab">item / description</div>{cells.map(({ tier, row }) => <div className="fr-cell" key={tier.id}>{row ? <input className="fr-in txt" data-break-field name={`shipmentNote:${tier.id}`} defaultValue={row.shipmentNote ?? ""} placeholder="4 pallets" disabled={!editable} onBlur={saveBreaks} aria-label={`Item or description · ${tier.label}`}/> : <span className="cbm">—</span>}</div>)}</div>{editable && <DestinationEdit destination={destination} pending={busy(`editDestination:${destination.id}`)} submit={submit(updateFreightDestination, `editDestination:${destination.id}`)}/>}</div>}
  </div>;
}

// The chip is a dense summary beside transit time, so it drops the carriage
// prefix the full label carries: `ocean_fcl` -> "Ocean FCL" -> "FCL". The
// governed selector below shows the full label.
//
// An unset break says so. Rendering "" produced an empty segment ("FCL / /
// FCL") that reads as a rendering fault rather than as missing data, and it
// hid which break still needs a type.
const modeChip = (mode: string) => mode ? enumLabel(mode).replace(/^(Ocean|Air|Domestic) /, "") : "not set";

function InlineDestination({ shipmentId, pending, submit }: any) { const [open, setOpen] = useState(false); return <div className="fr-add">{!open ? <button className="fr-addbtn" onClick={() => setOpen(true)}><span className="pl">+</span> Another destination</button> : <form action={submit} className="fr-dest-draft"><input type="hidden" name="freightSubcategoryId" value={shipmentId}/><input className="fr-din" autoFocus required name="destination" placeholder="destination — e.g. Aurora, OH"/><input className="fr-din" name="transitDays" placeholder="transit days"/><input className="fr-din" name="consignee" placeholder="consignee — optional"/><input className="fr-note" name="internalNotes" placeholder="note — optional"/><button className="btn primary" disabled={pending} title={pending ? "Adding this destination…" : undefined}>{pending ? "Adding…" : "Add destination"}</button><button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button></form>}<span className="fr-addnote">A second destination makes this a choice: one goes in the price, the rest stay as the comparison that justified it.</span></div>; }

function CustomsLedger({ shipment, tiers, entry, workbook, editable, pending, submitBreak, submitEntry }: any) {
  const columns = `minmax(200px, 1.5fr) 152px repeat(${tiers.length}, minmax(112px, 1fr))`;
  const customsRef = useRef<HTMLDivElement>(null);
  const saveEntry = () => {
    const root = customsRef.current;
    if (!root) return;
    submitEntry(fields({
      freightSubcategoryId: shipment.id,
      invoiceReference: root.querySelector<HTMLInputElement>('[name="invoiceReference"]')?.value,
      entryDescription: root.querySelector<HTMLInputElement>('[name="entryDescription"]')?.value,
    }));
  };
  const saveBreak = (chargeType: string, tierId: string) => {
    const root = customsRef.current;
    if (!root) return;
    submitBreak(fields({
      freightSubcategoryId: shipment.id,
      tierId,
      chargeType,
      amount: root.querySelector<HTMLInputElement>(`[data-customs-amount="${chargeType}:${tierId}"]`)?.value,
      markupPct: root.querySelector<HTMLInputElement>(`[data-customs-markup="${chargeType}:${tierId}"]`)?.value,
    }));
  };
  return <div className="fr-customs" ref={customsRef}>
    <div className="fr-chead">
      <span className="h">Customs entry</span>
      <span className="fr-entryref">
        <input className="fr-note" name="invoiceReference" defaultValue={entry?.invoiceReference ?? ""} placeholder="invoice reference" disabled={!editable} onBlur={saveEntry}/>
        <input className="fr-note" name="entryDescription" defaultValue={entry?.entryDescription ?? ""} placeholder="entry note" disabled={!editable} onBlur={saveEntry}/>
      </span>
    </div>
    <div className="fr-cgrid fr-chd" style={{ gridTemplateColumns: columns }}>
      <div>charge · entered once, carried to all {workbook.destinations.filter((row: any) => row.freightSubcategoryId === shipment.id).length}</div>
      <div>markup</div>
      {tiers.map((tier: Tier) => <div className="n" key={tier.id}>{tier.label} · {tier.qty?.toLocaleString()} units</div>)}
    </div>
    {(["duty", "tariff"] as const).map((chargeType) => {
      const label = chargeType === "duty" ? "Duty" : "Tariff";
      return <div className="fr-cgrid fr-crow" style={{ gridTemplateColumns: columns }} key={chargeType}>
        <div className="lb"><span className="n">{label}</span><span className="d">invoice-entered amount</span></div>
        <div className="mk">{tiers.map((tier: Tier) => {
          const current = entry && workbook.customsBreaks.find((row: any) => row.freightCustomsEntryId === entry.id && row.tierId === tier.id && row.chargeType === chargeType);
          return <input className="fr-in pct" data-customs-markup={`${chargeType}:${tier.id}`} type="number" min="0" max="999" step="1" placeholder="10" aria-label="Markup, whole percent" title="Enter whole percent — 10 means 10%" defaultValue={current?.markupPct === null || current?.markupPct === undefined ? "" : Number(current.markupPct) * 100} disabled={!editable} onBlur={() => saveBreak(chargeType, tier.id)} key={tier.id}/>;
        })}</div>
        {tiers.map((tier: Tier) => {
          const current = entry && workbook.customsBreaks.find((row: any) => row.freightCustomsEntryId === entry.id && row.tierId === tier.id && row.chargeType === chargeType);
          const amount = Number(current?.amount ?? 0);
          const markup = Number(current?.markupPct ?? 0);
          return <div className="n" key={tier.id}>
            <input className="fr-in" data-customs-amount={`${chargeType}:${tier.id}`} type="number" min="0" step="0.01" defaultValue={current?.amount ?? ""} disabled={!editable} onBlur={() => saveBreak(chargeType, tier.id)}/>
            <span className="s">sell {money2(amount * (1 + markup))}</span>
          </div>;
        })}
      </div>;
    })}
    <div className="fr-cgrid fr-crow tot" style={{ gridTemplateColumns: columns }}>
      <div className="lb"><span className="n">Carried to every destination</span></div>
      <div className="mk"/>
      {tiers.map((tier: Tier) => {
        const rows = entry ? workbook.customsBreaks.filter((row: any) => row.freightCustomsEntryId === entry.id && row.tierId === tier.id) : [];
        const amount = rows.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
        const sell = rows.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0) * (1 + Number(row.markupPct ?? 0)), 0);
        return <div className="n" key={tier.id}><span className="v">{money2(amount)}</span><span className="s">{tier.qty ? money4(sell / tier.qty) : "—"}/unit sell</span></div>;
      })}
    </div>
  </div>;
}

// Incoterm is an enum-backed `<select>`, not the bundle's free-text input:
// the persisted authority is the `freightIncoterm` pgEnum, and free text
// would admit values the column rejects. Journey, treatment and transit are
// governed schema columns surfaced at creation. Recorded as an approved
// deviation in docs/phase-2-freight-dom-parity-audit.md (F-G).
function CreateShipmentModal({ quoteId, product, components, defaultSelected, remaining, pending, close, submit }: any) { return <div className="fr-scrim" onMouseDown={(event) => event.target === event.currentTarget && close()}><form className="fr-modal" action={submit}><div className="fr-mhead"><div className="t">What shipment am I recording?</div><div className="s"><strong>{product?.label}</strong> and its commercial structure come from Setup. Record only the Logistics decision here.</div></div><div className="fr-mbody"><input type="hidden" name="quoteId" value={quoteId}/><input type="hidden" name="assemblyId" value={product?.id ?? ""}/><ShipmentContentsPicker components={components} defaultSelected={defaultSelected} remaining={remaining}/><div className="full"><label className="fr-lbl" htmlFor="freight-label">what ships</label><input id="freight-label" className="fr-tin" required name="label" placeholder="Packaging from overseas — bottles + sprayers"/></div><div><label className="fr-lbl" htmlFor="freight-origin">from</label><input id="freight-origin" className="fr-tin" name="origin" placeholder="Ningbo, China"/></div><div><label className="fr-lbl" htmlFor="freight-carrier">forwarder or carrier</label><input id="freight-carrier" className="fr-tin" name="carrierForwarder" placeholder="Straight Forwarding, Inc."/></div><div><label className="fr-lbl" htmlFor="freight-incoterm">incoterm</label><select id="freight-incoterm" className="fr-tin" name="incoterm"><option value="">Choose</option>{["DDP","DAP","FOB","EXW","FCA","CIF"].map((item) => <option key={item}>{item}</option>)}</select></div><div><label className="fr-lbl" htmlFor="freight-journey">journey</label><input id="freight-journey" className="fr-tin" name="journeyLabel" placeholder="Outbound · journey 1"/></div><div><label className="fr-lbl" htmlFor="freight-ready">cargo ready</label><input id="freight-ready" className="fr-tin date" name="cargoReadyDate" type="date"/></div><div><label className="fr-lbl" htmlFor="freight-treatment">treatment</label><select id="freight-treatment" className="fr-tin" name="treatment" defaultValue="bundled"><option value="bundled">Bundled · amortised across units</option><option value="pass_through">Pass-through</option></select></div><div className="full"><label className="fr-lbl">does this shipment cross a border?</label><div className="fr-srcpick"><label className="fr-src on"><input type="radio" name="crossesInternationalBorder" value="true" defaultChecked/> yes — it clears customs</label><label className="fr-src"><input type="radio" name="crossesInternationalBorder" value="false"/> no — domestic</label></div><div className="fr-hint">Crossing a border adds the customs entry — invoice-entered Duty and Tariff, recorded once and carried to every destination.</div></div><div className="full"><label className="fr-lbl" htmlFor="freight-destination">first destination</label><input id="freight-destination" className="fr-tin" required name="destination" placeholder="Edina, MN 55439"/><div className="fr-hint">One destination is the whole thing for most shipments. Add alternatives only when you priced them.</div></div><div><label className="fr-lbl" htmlFor="freight-transit">transit</label><input id="freight-transit" className="fr-tin" name="transitDays" placeholder="42 days"/></div></div><div className="fr-mfoot"><span className="sp">freight type, description and rates are entered per break, on the section</span><button className="btn ghost" type="button" onClick={close}>Cancel</button><button className="btn primary" disabled={pending} title={pending ? "Recording this shipment…" : undefined}>{pending ? "Recording…" : "Add"}</button></div></form></div>; }

/**
 * Shipment contents selector for the create modal.
 *
 * Every eligible component starts selected, which preserves the common case —
 * one shipment carrying the whole product — and leaves single-component quotes
 * behaving exactly as before. The operator deselects to model a split: partial
 * ocean / partial air, staggered releases, customer-specific groupings.
 *
 * "All selected" is shown explicitly rather than implied. The previous
 * treatment rendered the same components as read-only chips, so a shipment
 * silently contained everything and the only way to change it was an Edit
 * disclosure the operator had no reason to open mid-flow.
 *
 * Toggle chips (not checkboxes) follow the Design Authority's `SkuChips`,
 * which models assignment as `<button className={"fr-chip" + (on ? " on" : "")}
 * onClick={() => onToggle(id)}>`. Selected ids post as `assemblyLeafId`, the
 * same field `updateFreightSubcategory` already consumes.
 */
function ShipmentContentsPicker({
  components,
  defaultSelected,
  remaining = false,
}: {
  components: Component[];
  defaultSelected?: string[];
  remaining?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(
    () => defaultSelected ?? components.map((item) => item.id),
  );
  const all = selected.length === components.length;
  const toggle = (id: string) =>
    setSelected((rows) => (rows.includes(id) ? rows.filter((row) => row !== id) : [...rows, id]));

  return (
    <div className="fr-inherited full">
      <span className="k">this shipment is for</span>
      {/* Marker so the action can tell "deselected everything" from "caller
          predates this selector" — without it, an empty selection would be
          indistinguishable from an absent field and would select all. */}
      <input type="hidden" name="membershipProvided" value="1" />
      {selected.map((id) => (
        <input key={id} type="hidden" name="assemblyLeafId" value={id} />
      ))}
      <div className="fr-skus" style={{ marginTop: 2 }}>
        {all && <span className="fr-chip all">all {components.length} SKUs</span>}
        {components.map((item) => (
          <button
            type="button"
            key={item.id}
            className={"fr-chip" + (selected.includes(item.id) ? " on" : "")}
            title={item.label}
            aria-pressed={selected.includes(item.id)}
            onClick={() => toggle(item.id)}
          >
            {item.sku || item.label}
          </button>
        ))}
      </div>
      <div className="fr-hint">
        {selected.length === 0
          ? "Select at least one component — a shipment must carry something."
          : remaining
            ? "Pre-selected the components not yet in any shipment. Override freely — a component may travel in more than one shipment."
            : "Assignment says which SKUs the freight is for. It does not divide the cost."}{" "}
        Contents cannot cross into another product, and can be changed later with Edit shipment contents.
      </div>
    </div>
  );
}

/**
 * Shipment edit.
 *
 * Every control is labelled, and each carries its own required/optional
 * marker. The previous form was a row of bare inputs whose meaning depended
 * entirely on position, so a blank field was indistinguishable from an
 * optional one and the operator could not tell what was blocking completion.
 *
 * Optional here means commercially optional -- freight still prices without
 * it. Only the shipment name is required, because it is what every later
 * surface refers to the shipment by.
 */
function ShipmentEdit({ shipment, memberships, components, pending, submit }: any) {
  const own = components.filter((item: Component) => item.assemblyId === shipment.assemblyId);
  const selectedCount = own.filter((item: Component) =>
    memberships.some((row: any) => row.assemblyLeafId === item.id)).length;
  // Names what is still unrecorded, so completion is readable rather than
  // inferred from which boxes happen to look empty.
  const missing = [
    !shipment.origin && "origin",
    !shipment.carrierForwarder && "forwarder or carrier",
    !shipment.incoterm && "incoterm",
    !shipment.cargoReadyDate && "cargo ready date",
  ].filter(Boolean) as string[];

  return <details className="fr-edit-disclosure"><summary>Edit shipment</summary>
    <form action={submit} className="fr-editform">
      <input type="hidden" name="freightSubcategoryId" value={shipment.id}/>
      <div className="fr-field"><label htmlFor={`se-label-${shipment.id}`}>what ships <span className="req">required</span></label><input id={`se-label-${shipment.id}`} required name="label" defaultValue={shipment.label} placeholder="Packaging from overseas — bottles + sprayers"/></div>
      <div className="fr-field"><label htmlFor={`se-origin-${shipment.id}`}>from <span className="opt">optional</span></label><input id={`se-origin-${shipment.id}`} name="origin" defaultValue={shipment.origin ?? ""} placeholder="Ningbo, China"/></div>
      <div className="fr-field"><label htmlFor={`se-carrier-${shipment.id}`}>forwarder or carrier <span className="opt">optional</span></label><input id={`se-carrier-${shipment.id}`} name="carrierForwarder" defaultValue={shipment.carrierForwarder ?? ""} placeholder="Straight Forwarding, Inc."/></div>
      <div className="fr-field"><label htmlFor={`se-incoterm-${shipment.id}`}>incoterm <span className="opt">optional</span></label><select id={`se-incoterm-${shipment.id}`} name="incoterm" defaultValue={shipment.incoterm ?? ""}><option value="">Not set</option>{["DDP","DAP","FOB","EXW","FCA","CIF"].map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className="fr-field"><label htmlFor={`se-journey-${shipment.id}`}>journey <span className="opt">optional</span></label><input id={`se-journey-${shipment.id}`} name="journeyLabel" defaultValue={shipment.journeyLabel ?? ""} placeholder="Outbound · journey 1"/></div>
      <div className="fr-field"><label htmlFor={`se-ready-${shipment.id}`}>cargo ready <span className="opt">optional</span></label><input id={`se-ready-${shipment.id}`} name="cargoReadyDate" type="date" defaultValue={shipment.cargoReadyDate ?? ""}/></div>
      <div className="fr-field"><label htmlFor={`se-treatment-${shipment.id}`}>treatment <span className="req">required</span></label><select id={`se-treatment-${shipment.id}`} name="treatment" defaultValue={shipment.treatment}><option value="bundled">Bundled · amortised across units</option><option value="pass_through">Pass-through</option></select></div>
      <div className="fr-field check"><label><input type="checkbox" name="crossesInternationalBorder" value="true" defaultChecked={shipment.crossesInternationalBorder}/> crosses a border — it clears customs</label></div>
      <fieldset className="fr-shipment-contents"><legend>Shipment contents <span className="req">at least one</span></legend>
        {own.map((item: Component) => <label key={item.id}><input type="checkbox" name="assemblyLeafId" value={item.id} defaultChecked={memberships.some((row: any) => row.assemblyLeafId === item.id)}/> {item.label}</label>)}
        <span className="fr-hint">{selectedCount} of {own.length} selected. Assignment says which SKUs the freight is for. It does not divide the cost.</span>
      </fieldset>
      <div className="fr-editfoot">
        <span className="fr-missing">{missing.length === 0 ? "All shipment detail recorded." : `Not recorded yet: ${missing.join(", ")}. None of these block pricing.`}</span>
        <button disabled={pending} title={pending ? "Saving this shipment…" : undefined}>{pending ? "Saving…" : "Save shipment"}</button>
      </div>
    </form>
  </details>;
}
/**
 * Destination edit.
 *
 * Previously a run of unlabelled inputs appended after the destination row,
 * which read as loose fields rather than one editable destination record --
 * the operator had to reverse-engineer the column order to know what each
 * box held. Now grouped as its own labelled form.
 */
function DestinationEdit({ destination, pending, submit }: any) {
  const missing = [
    !destination.consignee && "consignee",
    !destination.transitDays && "transit",
    !destination.quoteReference && "forwarder quote reference",
  ].filter(Boolean) as string[];

  return <details className="fr-edit-disclosure"><summary>Edit destination</summary>
    <form action={submit} className="fr-editform">
      <input type="hidden" name="destinationId" value={destination.id}/>
      <div className="fr-field"><label htmlFor={`de-dest-${destination.id}`}>destination <span className="req">required</span></label><input id={`de-dest-${destination.id}`} required name="destination" defaultValue={destination.destination} placeholder="Edina, MN 55439"/></div>
      <div className="fr-field"><label htmlFor={`de-consignee-${destination.id}`}>consignee <span className="opt">optional</span></label><input id={`de-consignee-${destination.id}`} name="consignee" defaultValue={destination.consignee ?? ""} placeholder="Acme Beauty DC"/></div>
      <div className="fr-field"><label htmlFor={`de-transit-${destination.id}`}>transit <span className="opt">optional</span></label><input id={`de-transit-${destination.id}`} name="transitDays" defaultValue={destination.transitDays ?? ""} placeholder="42 days"/></div>
      <div className="fr-field"><label htmlFor={`de-ref-${destination.id}`}>forwarder quote reference <span className="opt">optional</span></label><input id={`de-ref-${destination.id}`} name="quoteReference" defaultValue={destination.quoteReference ?? ""} placeholder="SF-2026-0142"/></div>
      <div className="fr-field wide"><label htmlFor={`de-note-${destination.id}`}>note <span className="opt">optional</span></label><input id={`de-note-${destination.id}`} name="internalNotes" defaultValue={destination.internalNotes ?? ""} placeholder="what the numbers do not say"/></div>
      <div className="fr-editfoot">
        <span className="fr-missing">{missing.length === 0 ? "All destination detail recorded." : `Not recorded yet: ${missing.join(", ")}. None of these block pricing.`}</span>
        <button disabled={pending} title={pending ? "Saving this destination…" : undefined}>{pending ? "Saving…" : "Save destination"}</button>
      </div>
    </form>
  </details>;
}
function TrackingStrip({ selected, tracking, stale, pending, submit }: any) {
  if (!selected) return <div className="fr-track pending"><span className="k">shipment</span><span className="none">no destination chosen — nothing ships yet, so there is nothing to track</span></div>;
  const formId = `tracking-${selected.id}`;
  return <form id={formId} className={`fr-track${stale ? " stale" : ""}`} action={submit}>
    <input type="hidden" name="destinationId" value={tracking?.freightDestinationId ?? selected.id}/>
    <span className="k">shipment · {selected.destination}</span>
    {/* `<label className="f">` rather than the source's `<div className="f">`
        — an accepted Nexus accessibility extension; the class tree, field
        order and the `unset` indicator are canonical. */}
    <div className="fr-tfields">
      <TrackingField label="vessel etd" name="etd" value={tracking?.etd ?? null} formId={formId}/>
      <TrackingField label="vessel eta" name="eta" value={tracking?.eta ?? null} formId={formId}/>
      <TrackingField label="actual delivery" name="actualDeliveryDate" value={tracking?.actualDeliveryDate ?? null} formId={formId}/>
    </div>
    {stale && <span className="warn">these dates were entered for a different endpoint — an ETA for one destination is not an ETA for another</span>}
  </form>;
}
// Supporting-detail chips, built conditionally per the bundle's `Support`
// (freight-1a/app/freight/1a.jsx). Comparison and reason chips are
// multi-destination concepts and are omitted for a single-destination
// shipment; the tracking chip appears only once tracking exists.
//
// The bundle's fourth chip — `duty workings`, paired with the `fr-math`
// block — is EXCLUDED from V1 per disposition C2: it is designer rationale
// for the worksheet's invoice-entered customs model, not operator-facing
// functionality. V1 remains invoice-entered Duty and Tariff only.
function supportChips(
  shipment: { selectionReason: string | null },
  destinations: unknown[],
  tracking: { eta: string | null } | undefined,
  staleTracking: unknown,
): Array<{ t: string; warn?: boolean }> {
  const multi = destinations.length > 1;
  const chips: Array<{ t: string; warn?: boolean }> = [];
  if (multi) chips.push({ t: "comparison" });
  if (multi) chips.push(shipment.selectionReason ? { t: "why recorded" } : { t: "why not recorded", warn: true });
  if (tracking || staleTracking) {
    chips.push(
      staleTracking
        ? { t: "dates entered for another endpoint", warn: true }
        : { t: tracking?.eta ? `eta ${tracking.eta}` : "no eta set" },
    );
  }
  return chips;
}

function TrackingField({ label, name, value, formId }: { label: string; name: string; value: string | null; formId: string }) {
  return <label className="f"><span className="k">{label}</span><input className="fr-tin sm date" type="date" name={name} defaultValue={value ?? ""} onBlur={autosave(formId)}/>{!value && <span className="unset">not set</span>}</label>;
}

function Fact({ label, value }: { label: string; value: unknown }) { return <div className="f"><span className="k">{label}</span><span className="v">{String(value || "not set")}</span></div>; }
function sellPerUnit(destination: any, tier: Tier, workbook: FreightWorkbook) {
  const row = workbook.breaks.find((item: any) => item.freightDestinationId === destination?.id && item.tierId === tier.id);
  return tier.qty ? Number(row?.freightAmount ?? 0) * (1 + Number(row?.freightMarkupPct ?? 0)) / tier.qty : 0;
}
function Comparison({ destinations, selected, tiers, workbook }: any) {
  if (destinations.length < 2) return null;
  const tier: Tier | undefined = tiers.find((item: Tier) => item.recommended) ?? tiers[tiers.length - 1] ?? tiers[0];
  const selectedValue = selected && tier ? sellPerUnit(selected, tier, workbook) : null;
  return <div className="fr-reason sys"><span className="k">comparison · {tier?.label ?? "quantity break"}</span><span className="t">{destinations.map((destination: any, index: number) => { const value = tier ? sellPerUnit(destination, tier, workbook) : 0; const delta = selectedValue === null ? null : value - selectedValue; return <span key={destination.id}><strong>{destination.destination}</strong>{destination.id === selected?.id ? " · in the price" : delta === null ? " · comparison retained" : ` · ${delta >= 0 ? "+" : "−"}${money4(Math.abs(delta))}/unit`}{index < destinations.length - 1 ? "; " : ""}</span>; })}</span></div>;
}
function SelectionReason({ shipment, selected, editable, submit }: any) { const formId = `selection-reason-${shipment.id}`; return <form id={formId} className="fr-reason" action={submit}><input type="hidden" name="freightSubcategoryId" value={shipment.id}/><input type="hidden" name="destinationId" value={selected?.id ?? ""}/><span className="k">why · {shipment.selectionReason ? "Logistics" : "unrecorded"}</span><input className="t" name="selectionReason" defaultValue={shipment.selectionReason ?? ""} placeholder="the deltas above are the system's; the reason is yours — add what the numbers don't say" disabled={!editable || !selected} onBlur={autosave(formId)}/></form>; }
function DecisionSummary({ selected, destinations, tiers, workbook }: any) { const tier: Tier | undefined = tiers.find((item: Tier) => item.recommended) ?? tiers[tiers.length - 1] ?? tiers[0]; const selectedValue = selected && tier ? sellPerUnit(selected, tier, workbook) : null; return <div className="fr-decision">{selected ? <><span className="chose">{selected.destination} chosen</span><span className="sep">·</span><span>{destinations.length - 1} comparison option{destinations.length === 2 ? "" : "s"} retained</span>{selectedValue !== null && <span className="sep">· {money4(selectedValue)}/unit at {tier?.label}</span>}</> : <span className="fr-vs worse">no destination selected</span>}</div>; }
function TotalStrip({ tiers, workbook }: any) {
  const totals = useMemo(() => tiers.map((tier: Tier) => workbook.subcategories.reduce((sum: number, shipment: any) => { const destination = workbook.destinations.find((row: any) => row.id === shipment.selectedDestinationId); const row = destination && workbook.breaks.find((item: any) => item.freightDestinationId === destination.id && item.tierId === tier.id); const customsEntry = workbook.customsEntries.find((item: any) => item.freightSubcategoryId === shipment.id); const customs = customsEntry ? workbook.customsBreaks.filter((item: any) => item.freightCustomsEntryId === customsEntry.id && item.tierId === tier.id).reduce((value: number, item: any) => value + Number(item.amount ?? 0) * (1 + Number(item.markupPct ?? 0)), 0) : 0; return sum + (tier.qty ? (Number(row?.freightAmount ?? 0) * (1 + Number(row?.freightMarkupPct ?? 0)) + customs) / tier.qty : 0); }, 0)), [tiers, workbook]);
  // Conditional meta line per the bundle's `TotalStrip`. An unselected
  // multi-destination shipment is the state that makes this total
  // provisional, so it is named rather than silently summed to zero.
  // "shipment" is the approved operator term for the bundle's
  // "subcategory" (disposition C3).
  const count = workbook.subcategories.length;
  const undecided = workbook.subcategories.filter((shipment: any) =>
    workbook.destinations.filter((row: any) => row.freightSubcategoryId === shipment.id).length > 1 && !shipment.selectedDestinationId,
  ).length;
  const meta = undecided
    ? `${undecided} shipment${undecided > 1 ? "s have" : " has"} no selection`
    : `sum of the selected destination in each of ${count} shipment${count > 1 ? "s" : ""}`;
  return <><div className="fr-grid fr-total"><div className="lab"><span className="n">Freight sell per unit</span><span className="m">{meta}</span></div>{totals.map((total: number, index: number) => <div className="fr-cell" key={tiers[index].id}><span className="v">{money4(total)}</span><span className="s">freight + duty/tariff</span></div>)}</div><div className="fr-assert"><span className="mk">✓</span><span>Candidate destinations are internal — they reach neither the quote nor the PDF. Freight, duty and tariff stay separate rows into Pricing&apos;s cost stack.</span></div></>;
}
