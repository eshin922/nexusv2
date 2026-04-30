# Strategic vision

This file captures the longer-arc product direction that informs current
slice decisions. Slice 5.5's assembly support is the first concrete step
toward the v2 architecture described here.

## Today (Slice 1 → Slice 12)

- **HubSpot is canonical for Products.** Every `quote_sku` *was* a
  reference to a HubSpot Product (Slice 4). After Slice 5.5, leaf SKUs
  still typically are; assemblies may be Nexus-local.
- **NetSuite consumes HubSpot data.** The existing HubSpot → NetSuite
  Sales Order sync is unchanged in v1.
- **Slice 12 writeback** populates `hs_cost_of_goods_sold` on HubSpot
  Quote line items — additive, not preservation. Unlocks native HubSpot
  margin reporting (`hs_margin = amount - hs_cost_of_goods_sold`) for the
  first time at DPS.

## v2 — Nexus → NetSuite direct integration

The HubSpot Products library is a structural bottleneck. It can't carry
BOM/assembly metadata, which means today's manual NetSuite assembly
configuration (done by ops after Sales Order arrival) is a separate
workflow that Nexus has no visibility into.

v2 reorganizes the data flow:

```
                 (today)                      (v2)
PMs in Nexus --> HubSpot Products         PMs in Nexus --> NetSuite items
                 |                                         |
                 v                                         v
              NetSuite SO                              NetSuite SO
              (manual assembly)                        (native assembly,
                                                       BOMs flow through)
              |
              v
            HubSpot CRM (one-way mirror, optional)
```

**NetSuite becomes the single product master.** Nexus writes Sales Orders
directly, with native assembly support. HubSpot Products becomes a
read-only mirror of NetSuite items (optional, for CRM visibility), no
longer the canonical source.

### Why this matters

1. **BOMs flow natively.** Nested assemblies (assembly → leaves, or
   assembly → assembly → leaves) become NetSuite assembly items, not
   flat lists that ops manually unpacks.
2. **Eliminates the manual assembly configuration step.** Ops time
   reclaimed.
3. **Nexus's role clarifies.** Today: "structured replacement for the
   cost worksheet." v2: "the assembly intelligence layer between PM
   thinking and NetSuite execution."
4. **HubSpot stays useful but loses the structural choke point.** CRM
   reporting on margins still works (Slice 12 writeback), but new
   product creation no longer happens in HubSpot first.

## Architectural implications already showing up in v1

- Slice 4: SKUs are references to HubSpot products, not standalone
  definitions. Sets the precedent that Nexus references but doesn't own
  product vocabulary.
- Slice 5.5: `hubspot_product_id` becomes nullable. Assemblies are
  Nexus-conceived structures that don't fit HubSpot's flat product
  model. This decoupling is the schema change that makes v2 viable
  later. The Slice 5.5 architecture revision (collapsing the role enum
  to `leaf | assembly` and pushing formulation classification into
  `cost_category`) further separates *tree structure* from *cost
  classification* — exactly the layering v2 needs to express BOMs to
  NetSuite.
- v2 backlog items (in `UX_BACKLOG.md`): the three NetSuite/HubSpot
  pivot tickets capture the work to flip the integration direction.

## Migration path (sketched)

1. **Slices 6–11.** Continue building the cost/quote model on the v1
   architecture (HubSpot Products as primary). Slice 5.5's assembly
   schema is forward-compatible.
2. **Slice 12.** HubSpot writeback ships as planned. This is the *peak*
   of HubSpot integration depth — and also where it stops growing.
3. **v1 → v2 transition.** New v2 ticket covers a "NetSuite item search"
   replacing the HubSpot Product search panel. Schema change:
   `quote_skus` gains `netsuite_item_id`. Migration backfills from
   HubSpot product names where there's a 1:1 match; ambiguous rows get
   a manual reconciliation pass.
4. **v2.** Nexus → NetSuite direct writeback ships. HubSpot writeback
   continues as a downstream sync (one-way), or is retired if NetSuite
   reporting subsumes the use case.

This is intentionally a v2 decision, not a v1 blocker. Ship Slice 12
first; reassess the integration architecture once we have actual
production usage data.
