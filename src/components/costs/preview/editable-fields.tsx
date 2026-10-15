"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateAssemblyLeafInputLineMeta } from "@/app/actions/assembly-leaf-inputs";
import { updateDirectServiceProduction } from "@/app/actions/direct-service-production";
import { useCostingStore } from "@/components/costing-store-provider";
import { ChargeAmountInput, ChargeBasisField, PackagingTierCell, type LineForUI } from "@/components/costs/packaging-drilldown";
import type { OverviewCharge, OverviewRecurringLine, OverviewTierFact } from "@/lib/costs/costs-overview-model";
import type { PackagingLineTierRead } from "@/lib/costs/packaging-line-graph-read";
import { PACKAGING_DOMAIN } from "@/lib/costs/packaging-domain";
import {
  selectActiveTierId,
  selectArmWrite,
  selectPackaging,
  selectUpdatePackagingLineMeta,
} from "@/lib/costing-store";
import { fmtPct1 } from "@/lib/money-display";

function decimalFromPercent(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const percent = Number(trimmed);
  if (!Number.isFinite(percent) || percent < 0 || percent > 999) return null;
  return (percent / 100).toFixed(4);
}

function percentFromDecimal(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const percent = Number(value) * 100;
  return Number.isFinite(percent) ? String(Number(percent.toFixed(2))) : "";
}

/** Existing per-row/per-tier cost writer with the same focus-safe draft owner. */
export function RecurringCostField({
  line,
  tier,
  read,
  disabled,
}: {
  line: OverviewRecurringLine;
  tier: OverviewTierFact;
  read: PackagingLineTierRead;
  disabled: boolean;
}) {
  const cells = new Map<string, { rowId: string; unitCost: string | null }>();
  for (const [tierId, cell] of line.cells) cells.set(tierId, cell);
  const uiLine: LineForUI = {
    lineGroupId: line.lineGroupId,
    sortOrder: line.sortOrder,
    quoteSkuId: line.quoteLeafId,
    pricingVendorHubspotCompanyId: null,
    pricingVendorNameSnapshot: line.vendor,
    supplier: null,
    qtyPerSellableUnit: line.qtyPerSellableUnit,
    category: line.category,
    markupPct: line.storedMarkupPct,
    markupPctSource: line.markupPctSource,
    inventoryEligible: line.inventoryEligible,
    notes: line.notes,
    cells,
  };
  const activeTierId = useCostingStore(selectActiveTierId);
  return (
    <span className={`cm2-cell${activeTierId === tier.id ? " cm2-hl" : ""}`}>
      <PackagingTierCell
        line={uiLine}
        tierId={tier.id}
        markupPct={line.storedMarkupPct ?? ""}
        markupDirty={false}
        read={read}
        isActive={activeTierId === tier.id}
        disabled={disabled}
      />
    </span>
  );
}

/** A line-scoped override; an empty value continues to inherit the engine rate. */
export function MarkupOverrideField({
  line,
  resolved,
  disabled,
}: {
  line: OverviewRecurringLine;
  resolved: PackagingLineTierRead | null;
  disabled: boolean;
}) {
  const packaging = useCostingStore(selectPackaging);
  const updateLineMeta = useCostingStore(selectUpdatePackagingLineMeta);
  const armWrite = useCostingStore(selectArmWrite);
  const rows = packaging.filter((row) => row.lineGroupId === line.lineGroupId);
  const current = rows[0];
  const initialOverride = line.markupPctSource === "category_default" ? null : line.storedMarkupPct;
  const [draft, setDraft] = useState(() => percentFromDecimal(initialOverride));
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const draftGen = useRef(0);
  const dirty = useRef(false);
  const inFlight = useRef(new Set<number>());
  const saveSeq = useRef(0);
  const lastAcked = useRef(0);
  const rowId = useRef(line.lineGroupId);
  const committed = useRef(initialOverride ?? "");
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const currentMarkup =
    current?.markupPctSource === "category_default" || current?.markupPct == null
      ? ""
      : String(current.markupPct);
  const currentMarkupSource = current?.markupPctSource ?? null;
  useEffect(() => {
    if (rowId.current !== line.lineGroupId) {
      rowId.current = line.lineGroupId;
      draftGen.current += 1;
      dirty.current = false;
      inFlight.current.clear();
      committed.current = currentMarkup;
      setDraft(percentFromDecimal(currentMarkup));
      setError(null);
      return;
    }
    if (dirty.current || inFlight.current.size > 0) return;
    committed.current = currentMarkup;
    setDraft(percentFromDecimal(currentMarkup));
  }, [line.lineGroupId, currentMarkup]);

  function change(value: string) {
    draftGen.current += 1;
    dirty.current = true;
    draftRef.current = value;
    setDraft(value);
    setError(null);
    const decimal = decimalFromPercent(value);
    if (current && (value.trim() === "" || decimal !== null)) {
      updateLineMeta(line.lineGroupId, {
        markupPct: decimal === null ? null : Number(decimal),
        markupPctSource: decimal === null ? null : "manual_override",
      });
    }
  }

  function save() {
    if (!dirty.current || !current || disabled) return;
    const value = draftRef.current;
    const decimal = decimalFromPercent(value);
    if (value.trim() !== "" && decimal === null) {
      setError("Enter a markup from 0 to 999%.");
      return;
    }
    const canonical = decimal ?? "";
    if (canonical === committed.current) {
      dirty.current = false;
      setError(null);
      return;
    }

    const generation = draftGen.current;
    const ticket = ++saveSeq.current;
    inFlight.current.add(ticket);
    const fd = new FormData();
    fd.set("lineGroupId", line.lineGroupId);
    fd.set("markupPct", canonical);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof updateAssemblyLeafInputLineMeta>> | null = null;
      let threw = false;
      try {
        result = await updateAssemblyLeafInputLineMeta(fd);
      } catch {
        threw = true;
      }
      inFlight.current.delete(ticket);
      if (rowId.current !== line.lineGroupId || ticket < lastAcked.current) return;
      lastAcked.current = ticket;
      const ownsDraft = draftGen.current === generation;
      if (threw || !result?.ok) {
        const message = threw
          ? "Markup could not be saved. Please try again."
          : result && !result.ok ? result.error.message : "Markup could not be saved.";
        setError(message);
        if (!ownsDraft) return;
        dirty.current = false;
        setDraft(percentFromDecimal(committed.current));
        updateLineMeta(line.lineGroupId, {
          markupPct: committed.current === "" ? null : Number(committed.current),
          markupPctSource: currentMarkupSource,
        });
        return;
      }

      armWrite({ outcome: "acknowledged", writeId: result.data.writeId, domains: [PACKAGING_DOMAIN] });
      committed.current = result.data.markupPct ?? "";
      updateLineMeta(line.lineGroupId, {
        markupPct: result.data.markupPct === null ? null : Number(result.data.markupPct),
        markupPctSource: result.data.markupPctSource,
      });
      if (ownsDraft) {
        dirty.current = false;
        setDraft(percentFromDecimal(committed.current));
        setError(null);
      }
    });
  }

  const inherited = resolved?.markup == null ? null : fmtPct1(resolved.markup);
  const placeholder = inherited === null ? "—" : String(Number(inherited.replace("%", "")));
  return (
    <span className="cm2-cell cm2-markup-edit">
      <span className="cm2-markup-input-wrap">
        <input
          className="cm2-markup-input"
          type="text"
          inputMode="decimal"
          aria-label={`Markup override for ${line.vendor ?? "product cost"}`}
          aria-invalid={error !== null}
          value={draft}
          placeholder={placeholder}
          disabled={disabled || !current}
          onChange={(event) => change(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span>%</span>
      </span>
      <span className="cm2-basis" title={resolved?.markupSource ? `Inherited from ${resolved.markupSource}` : undefined}>
        {draft.trim() ? "line override" : inherited ? `inherits ${inherited}` : "no rate resolved"}
      </span>
      {error ? <span className="cm2-edit-error" role="alert">{error}</span> : null}
    </span>
  );
}

/** Existing per-tier component-fee writer, labelled against its owning tier. */
export function ChargeCostField({
  quoteId,
  charge,
  tier,
  disabled,
}: {
  quoteId: string;
  charge: OverviewCharge;
  tier: OverviewTierFact;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="cm2-cell cm2-charge-edit">
      <ChargeAmountInput
        quoteId={quoteId}
        chargeInstanceId={charge.chargeInstanceId}
        tierId={tier.id}
        tierLabel={tier.label}
        field="cost"
        value={charge.amounts.get(tier.id)?.cost ?? null}
        disabled={disabled}
        ariaLabel={`Cost for ${charge.typeLabel} at ${tier.label}`}
        onError={setError}
      />
      {error ? <span className="cm2-edit-error" role="alert">{error}</span> : null}
    </span>
  );
}

export type M3EditorFieldProps =
  | { kind: "recurring"; line: OverviewRecurringLine; tier: OverviewTierFact; read: PackagingLineTierRead; disabled: boolean }
  | { kind: "markup"; line: OverviewRecurringLine; resolved: PackagingLineTierRead | null; disabled: boolean }
  | { kind: "charge"; quoteId: string; charge: OverviewCharge; tier: OverviewTierFact; disabled: boolean }
  | { kind: "service"; quoteLeafId: string; tierId: string; value: string | null; basis: "total" | "per_unit"; quantity: number | null; label: string; disabled: boolean }
  | { kind: "charge-basis"; quoteId: string; charge: OverviewCharge; disabled: boolean };

function ServiceAmountField({ quoteLeafId, tierId, value, basis, quantity, label, disabled }: {
  quoteLeafId: string;
  tierId: string;
  value: string | null;
  basis: "total" | "per_unit";
  quantity: number | null;
  label: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(value ?? "");
  const [selectedBasis, setSelectedBasis] = useState(basis);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  useEffect(() => { setSelectedBasis(basis); }, [basis]);

  function save(next = draft.trim(), nextBasis = selectedBasis) {
    if (disabled || (next === (value ?? "") && nextBasis === basis)) return;
    const data = new FormData();
    data.set("quoteLeafId", quoteLeafId);
    data.set("tierId", tierId);
    data.set("amount", next);
    data.set("basis", nextBasis);
    setError(null);
    start(async () => {
      const result = await updateDirectServiceProduction(data);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  }

  function changeBasis(nextBasis: "total" | "per_unit") {
    if (nextBasis === selectedBasis) return;
    const current = Number(draft);
    if (draft.trim() && (!quantity || quantity <= 0 || !Number.isFinite(current))) {
      setError("Set the tier quantity and a valid cost before changing basis.");
      return;
    }
    const next = !draft.trim() ? "" : nextBasis === "per_unit"
      ? (current / quantity!).toFixed(5)
      : (current * quantity!).toFixed(2);
    setSelectedBasis(nextBasis);
    setDraft(next);
    save(next, nextBasis);
  }

  return (
    <span className="cm2-cell">
      <input
        className="cm2-service-input"
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        placeholder="—"
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if ((event.relatedTarget as HTMLElement | null)?.classList.contains("cm2-service-basis")) return;
          save();
        }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
      />
      <select
        className="cm2-service-basis"
        aria-label={`${label} cost basis`}
        value={selectedBasis}
        disabled={disabled}
        onChange={(event) => changeBasis(event.target.value as "total" | "per_unit")}
      >
        <option value="total">Total cost</option>
        <option value="per_unit">Cost per unit</option>
      </select>
      {pending && <span className="cm2-basis">saving…</span>}
      {error && <span className="cm2-basis" role="alert">{error}</span>}
    </span>
  );
}

/** Single lazy-load boundary: mounting read-only M2 must not pull server actions into its module graph. */
export default function M3EditorField(props: M3EditorFieldProps) {
  if (props.kind === "service") {
    return <ServiceAmountField quoteLeafId={props.quoteLeafId} tierId={props.tierId} value={props.value} basis={props.basis} quantity={props.quantity} label={props.label} disabled={props.disabled} />;
  }
  if (props.kind === "charge-basis") {
    return <ChargeBasisField quoteId={props.quoteId} chargeInstanceId={props.charge.chargeInstanceId} basis={props.charge.costBasis} hasCosts={props.charge.amounts.size > 0} disabled={props.disabled} />;
  }
  if (props.kind === "recurring") {
    return <RecurringCostField line={props.line} tier={props.tier} read={props.read} disabled={props.disabled} />;
  }
  if (props.kind === "markup") {
    return <MarkupOverrideField line={props.line} resolved={props.resolved} disabled={props.disabled} />;
  }
  return <ChargeCostField quoteId={props.quoteId} charge={props.charge} tier={props.tier} disabled={props.disabled} />;
}
