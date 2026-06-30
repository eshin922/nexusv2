// Slice 11 Step 3 — TEMPORARY sample customer-PDF render.
//
// Renders StatePure (tier_table · itemized) against CD's fixture data
// from `docs/design-prototypes/dist/Nexus Customer PDF Render/app/
// cpdf/data.js`. Confirms the component tree compiles end-to-end
// and the fixture-shape prop types align with CD's source.
//
// **REMOVE in pre-v1 cleanup PR.** This route is the live equivalent
// of CD's `CustomerPdfHost` (preview chrome) — NOT a production
// surface. Step 4 wires real data via the `CustomerView` adapter.

import { renderToStream } from "@react-pdf/renderer";

import { StatePure } from "@/components/pdf/customer-pdf-document";
import type {
  CpdfData,
  CpdfSku,
} from "@/components/pdf/customer-pdf-types";

// ─── CD fixture verbatim (data.js) ───────────────────────────
// Values copied 1:1 from `docs/design-prototypes/dist/Nexus Customer
// PDF Render/app/cpdf/data.js` per Pattern 30. Step 4 swaps these
// for adapter-projected `CustomerView` data.

const FIXTURE: CpdfData = {
  vendor: {
    name: "The DPS",
    sub: "Turnkey product development & manufacturing for beauty, health & wellness brands",
    address: "3943 Irvine Blvd, #1129 · Irvine, CA 92602",
    contact_name: "Maya Okafor",
    contact_email: "maya@dps.co",
    contact_phone: "+1 (909) 555-0142",
  },
  customer: {
    name: "Lumen & Co.",
    contact: "Beth Yamamoto",
    role: "VP Operations",
    email: "beth@lumenco.com",
    address: "1450 Mission St · San Francisco, CA 94103",
  },
  quote: {
    quote_number: "DPS-2418",
    issued_date: "2026-05-17",
    valid_until: "2026-08-31",
    payment_terms: "50% deposit on PO · balance Net 30 from ship date",
    lead_time: "10–12 weeks from PO approval; first shipment FOB Long Beach",
    incoterms_bundled:
      "FOB Long Beach — container freight, duty & applicable tariffs included in unit price",
    incoterms_passthrough:
      "EXW Long Beach — outbound freight billed separately at cost; charges itemized",
    customer_facing_notes:
      "Pricing assumes a single port-of-origin (Ningbo). Bulk-material costs are subject to a ±2% adjustment if published indices move more than 15% before PO. Tooling is shown as a one-time charge and amortizes into unit cost from Tier 3 forward.",
  },
  tiers: [
    { id: "t1", label: "T1", full: "Tier 1", quantity: 5000 },
    { id: "t2", label: "T2", full: "Tier 2", quantity: 10000, recommended: true },
    { id: "t3", label: "T3", full: "Tier 3", quantity: 25000 },
    { id: "t4", label: "T4", full: "Tier 4", quantity: 50000 },
  ],
  recommendedTierIdx: 1,
  skus: [
    {
      id: "s1",
      code: "GLW-30",
      name: "Hydra-Glow Vitamin C Serum",
      pack: "30 ml glass dropper, screw cap",
      tier_prices: [4.45, 3.95, 3.49, 3.18],
      shape: "step",
    },
    {
      id: "s2",
      code: "GLW-50",
      name: "Hydra-Glow Vitamin C Serum",
      pack: "50 ml glass dropper, screw cap",
      tier_prices: [6.85, 6.1, 5.42, 4.92],
      shape: "step",
    },
    {
      id: "s3",
      code: "RPL-200",
      name: "Replenish Body Lotion",
      pack: "200 ml HDPE pump bottle",
      tier_prices: [4.65, 4.65, 4.65, 4.65],
      shape: "flat",
    },
    {
      id: "s4",
      code: "RPL-400",
      name: "Replenish Body Lotion",
      pack: "400 ml HDPE pump bottle",
      tier_prices: [7.85, 7.2, 6.55, 5.95],
      shape: "step",
    },
  ],
  serviceFees: [
    {
      id: "sf1",
      scope: "project",
      label: "Project setup & tooling",
      sub: "Per-project, one-time. Includes filling-line setup, dye-cuts, plates.",
      amount: 4800,
      qty_label: "1 (per project)",
    },
    {
      id: "sf2",
      scope: "sku",
      sku_id: "s2",
      label: "GLW-50 — custom mold tooling",
      sub: "One-time. Mold ownership transfers to client at PO + 50k cumulative units.",
      amount: 9600,
      qty_label: "1 (GLW-50 only)",
    },
  ],
  freightLines: [
    {
      id: "fr1",
      label: "Inbound ocean — Ningbo → Long Beach",
      sub: "Container freight allocated per unit. Booked & billed at cost as LCL/FCL is confirmed.",
      qty_label: "Per unit · per shipment",
      tier_amounts: [0.48, 0.42, 0.36, 0.31],
    },
    {
      id: "fr2",
      label: "Outbound LTL — Long Beach → Lumen DC (Tracy, CA)",
      sub: "Per shipment. Estimate at current rates; actual billed at cost + 15%.",
      qty_label: "Per unit · per shipment",
      tier_amounts: [0.38, 0.31, 0.26, 0.22],
    },
  ],
};

const PURE_SET_IDS: ReadonlyArray<string> = ["s1", "s2", "s3", "s4"];

export async function GET() {
  const skuSet: ReadonlyArray<CpdfSku> = PURE_SET_IDS.map((id) => {
    const sku = FIXTURE.skus.find((s) => s.id === id);
    if (!sku) throw new Error(`sample fixture: SKU ${id} not found`);
    return sku;
  });

  const stream = await renderToStream(
    <StatePure
      data={FIXTURE}
      skuSet={skuSet}
      layout="tier_table"
      detail="itemized"
    />
  );

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
    },
  });
}
