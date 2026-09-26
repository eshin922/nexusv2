"use client";
import { useState } from "react";
import { splitShipmentQuantities } from "@/lib/freight-percentage-split";

export function SplitShipmentDialog({ shipments, tiers, pending, close, submit }: {
  shipments: Array<{ id: string; label: string }>;
  tiers: Array<{ id: string; label: string; qty: number | null }>;
  pending: boolean; close: () => void; submit: (form: FormData) => void;
}) {
  const [percentage, setPercentage] = useState("50");
  let plans: ReturnType<typeof splitShipmentQuantities> | null = null;
  let error = "";
  try { plans = splitShipmentQuantities(tiers, Number(percentage)); } catch (cause) { error = (cause as Error).message; }
  return <div className="fr-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <form className="fr-modal" role="dialog" aria-modal="true" aria-label="Split shipment" action={submit}>
      <div className="fr-mhead"><div className="t">Split shipment</div><div className="s">One percentage applies to every order option.</div></div>
      <div className="fr-mbody">
        <div className="full"><label className="fr-lbl" htmlFor="split-source">Existing shipment</label><select id="split-source" className="fr-tin" name="freightSubcategoryId">{shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.label}</option>)}</select></div>
        <div><label className="fr-lbl" htmlFor="split-percentage">First shipment %</label><input id="split-percentage" className="fr-tin" name="percentage" type="number" min="0.01" max="99.99" step="0.01" required value={percentage} onChange={(event) => setPercentage(event.target.value)}/></div>
        <div><label className="fr-lbl">Second shipment %</label><div className="fr-tin">{plans?.[1].percentage ?? "—"}%</div></div>
        <div className="full fr-split-preview">{plans && tiers.map((tier, index) => <div key={tier.id}><span>{tier.qty?.toLocaleString("en-US")} units</span><strong>{plans![0].quantities[index].units.toLocaleString("en-US")} + {plans![1].quantities[index].units.toLocaleString("en-US")}</strong></div>)}</div>
        {error && <div className="full fr-hint" role="alert">{error}</div>}
        <div className="full fr-hint">Quantities round to whole units; the second shipment receives the remainder. The new section copies shipment details. Enter its freight costs separately.</div>
      </div>
      <div className="fr-mfoot"><span className="sp">Applies to all {tiers.length} order options</span><button type="button" className="btn ghost" onClick={close}>Cancel</button><button className="fr-addbtn" disabled={pending || !plans}>{pending ? "Splitting…" : "Split shipment"}</button></div>
    </form>
  </div>;
}
