// Client-safe HubSpot Product enum constants. Extracted from
// src/lib/hubspot.ts (which carries `import "server-only"`) so the
// Add-product modal — a "use client" component — can render label/
// value option lists without violating the server-only boundary.
//
// These are pure constant data with no runtime dependency on the
// HubSpot SDK. The server-side functions in src/lib/hubspot.ts
// re-export them via `export *` so existing server-side imports
// don't need to change.
//
// Pattern: any HubSpot domain constant that needs to render in a
// client component lives here. Anything that requires the Client
// (read/write paths, search, owner lookups) stays in
// src/lib/hubspot.ts behind the server-only guard.

// Phase 1 hs_product_type enum. THREE label/value divergences per
// brief — display label != stored value. Send the value to HubSpot;
// display the label to PMs. Adding a value here without verifying
// against HubSpot's actual enum list will silently 400 the create
// call.
export const HS_PRODUCT_TYPE_OPTIONS = [
  { label: "Cards/Booklets", value: "Cards/Booklets" },
  { label: "Design", value: "Design" },
  { label: "Filling and Packout Services", value: "Filling and Packout Services" },
  { label: "Finished Goods", value: "Finished Goods" },
  { label: "Formulation", value: "Formulation" },
  { label: "Freight", value: "Freight" },
  { label: "Labels", value: "Labels" },
  // DIVERGENCE — label "Logistics" but stored as "Third Party Logistics"
  { label: "Logistics", value: "Third Party Logistics" },
  { label: "One Time Charges", value: "One Time Charges" },
  // DIVERGENCE — label "Primary Packaging" stored as "Primary"
  { label: "Primary Packaging", value: "Primary" },
  { label: "R&D / Testing", value: "R&D / Testing" },
  { label: "Raw ingredients", value: "Raw ingredients" },
  // DIVERGENCE — label "Secondary Packaging" stored as "Secondary"
  { label: "Secondary Packaging", value: "Secondary" },
  { label: "Soft Goods and Accessories", value: "Soft Goods and Accessories" },
  { label: "Turnkey", value: "Turnkey" },
] as const;

export const TAX_SCHEDULE_OPTIONS = ["Taxable", "Non Taxable"] as const;
export const FSC_CLAIM_TYPE_OPTIONS = [
  "FSC Mix",
  "FSC 100%",
  "FSC Recycled",
] as const;
export const FSC_STATUS_OPTIONS = ["Yes", "No"] as const;
