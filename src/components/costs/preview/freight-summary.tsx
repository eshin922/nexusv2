"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { freightSummaryShipments, type FreightSummaryInput } from "@/lib/costs/freight-summary";
import { Tag, TierHeadCell } from "./shared";
import type { OverviewTierFact } from "@/lib/costs/costs-overview-model";

export function FreightSummary({ input, tiers, activeTierId, onSelectTier, href, editor }: {
  editor?: ReactNode;
  input?: FreightSummaryInput;
  tiers: readonly OverviewTierFact[];
  activeTierId: string | null;
  onSelectTier: (id: string) => void;
  href: string;
}) {
  const [editorMounted, setEditorMounted] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const shipments = input ? freightSummaryShipments(input.workbook, tiers.map((t) => t.id)) : [];
  const needsInput = shipments.some((s) => s.needsInput);
  const status = !input?.statusAvailable ? "Status unavailable"
    : input.handoff?.status === "completed" ? "Complete"
    : input.handoff?.status === "open" ? "In progress" : "Not handed over";

  const openEditor = () => {
    setEditorMounted(true);
    setEditorOpen(true);
  };

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditorOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [editorOpen]);

  return <section className="cm2-freight" aria-label="Freight inputs">
    <header className="cm2-freight-head">
      <div><h2>Freight, duty and tariffs</h2>
        <div className="cm2-section-note">{shipments.length} shipment{shipments.length === 1 ? "" : "s"} · costs per tier</div>
      </div>
      <div className="cm2-flags">
        <Tag tone={status === "Complete" ? "green" : status === "In progress" ? "accent" : "amber"}>{status}</Tag>
        {needsInput && <Tag tone="amber">Inputs needed</Tag>}
      </div>
      {editor
        ? <button type="button" className="cm2-freight-action" onClick={openEditor}>Record shipment</button>
        : <Link className="cm2-entry" href={href}>Open Freight module →</Link>}
    </header>
    {input?.handoff?.assignedToEmail && <div className="cm2-freight-assignee">Assigned to {input.handoff.assignedToEmail}</div>}
    {shipments.length === 0 ? <div className="cm2-freight-empty">{input ? "No shipments recorded. Use Record shipment to enter the freight decision." : "Shipment details are unavailable. Use Record shipment to enter freight details."}</div>
      : <div className="cm2-freight-scroll" style={{ ["--cm2-cols" as string]: String(tiers.length + 1) }}>
        <div className="cm2-freight-table" role="table" aria-label="Shipment freight, duty and tariff by tier">
        <div className="cm2-freight-grid-row cm2-freight-column-head" role="row">
          <div role="columnheader">Shipment / cost</div>{tiers.map((tier) => <div key={tier.id} role="columnheader">
            <button type="button" className="cm2-tierpick" aria-pressed={tier.id === activeTierId} onClick={() => onSelectTier(tier.id)}><TierHeadCell tier={tier} active={tier.id === activeTierId} /></button>
          </div>)}<div role="columnheader">Markup %</div><div role="columnheader">Cost source</div>
        </div>
        {shipments.map((shipment) => <div key={shipment.id} role="rowgroup">
          <div className="cm2-freight-grid-row cm2-freight-shipment" role="row">
            <div className="cm2-freight-shipment-title" role="rowheader" style={{ gridColumn: "1 / -1" }}>
            <span>{shipment.label}</span><span className="cm2-section-note">{shipment.origin ? `${shipment.origin} → ` : ""}{shipment.destination ?? "Destination decision needed"}</span>
            {shipment.members === 0 && <Tag tone="amber">Products not assigned</Tag>}
            {editor && <button type="button" className="cm2-freight-edit" onClick={openEditor}>Edit</button>}
            </div>
          </div>
          {shipment.rows.map((row) => <div className="cm2-freight-grid-row cm2-freight-data-row" key={row.kind} role="row"><div className="cm2-freight-row-label" role="rowheader">{row.kind === "freight" ? "Freight" : row.kind === "duty" ? "Duty" : "Tariffs"}</div>
            {row.cells.map((cell) => <div role="cell" key={cell.tierId} className={cell.tierId === activeTierId ? "cm2-freight-active" : undefined}>
              {cell.state === "not-applicable" ? <span className="cm2-section-note">Not applicable</span>
                : cell.state === "selection-needed" ? <span className="cm2-section-note">Awaiting selection</span>
              : <span className="cm2-freight-amount">{cell.amount === null ? "Unpriced" : Number(cell.amount).toLocaleString("en-US", { style: "currency", currency: "USD" })}</span>}
            </div>)}
            <div role="cell" className="cm2-freight-markup" title={row.markupDetail}>{row.markupSummary}</div>
            <div role="cell" className="cm2-freight-source">{row.kind === "freight" ? "Selected destination" : "Customs entry"}</div>
          </div>)}
        </div>)}
      </div></div>}
    {editor && editorMounted && <div className="cm2-freight-panel-shell" hidden={!editorOpen}>
      <button type="button" className="cm2-freight-panel-scrim" aria-label="Close Freight editor" onClick={() => setEditorOpen(false)} />
      <aside className="cm2-freight-panel" role="dialog" aria-modal="true" aria-labelledby="cm2-freight-panel-title">
        <header className="cm2-freight-panel-head">
          <div>
            <div className="cm2-eyebrow">Freight on this quote</div>
            <h2 id="cm2-freight-panel-title">Shipments, destinations and costs</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="cm2-freight-panel-close" onClick={() => setEditorOpen(false)} aria-label="Close Freight editor">×</button>
        </header>
        <div className="cm2-freight-panel-body">{editor}</div>
      </aside>
    </div>}
  </section>;
}
