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

## Lifecycle ambition — two-layer architecture (revised May 2026)

The v1/v2 boundary above is product-master direction (HubSpot vs.
NetSuite). Sitting alongside it is a longer-arc **lifecycle
ambition** that operates on a different axis: how the quote-to-
fulfillment workflow is structured over time.

**Revision note (2026-05-17):** This section previously framed
Operations as a v1.1+ peer surface (6th surface in the canon).
That framing was the wrong shape. The lifecycle ambition is
structurally a **two-layer architecture** — a per-quote flow
(Layer 1) and an orchestration wrapper above it (Layer 2). v1
ships Layer 1; Layer 2 is post-v1. See revised framing below.

### v1 strategic frame — per-quote lifecycle, HubSpot → Nexus → NetSuite

v1 ships the per-quote lifecycle as a coherent flow from inquiry
through NetSuite SO push:

- **HubSpot** seeds the data (read-only at v1)
- **Nexus** owns the build → send → accept → tier-select →
  advance-to-NetSuite lifecycle
- **NetSuite** receives the SO as the operational handoff

The Quote umbrella surface (4th peer surface) is where the
execute phase lives, with internal sub-tab structure: **Preview
Quote · Send to Client · Mark Accepted · Tier Selection**. Each
sub-tab carries an explicit Advance action; HubSpot deal stage
push fires on Mark Accepted Advance; NetSuite SO push fires on
Tier Selection Advance (the irreversible commit).

**v1 ends at NetSuite SO push.** Post-acceptance operational
artifacts (BoM, packing list, freight tracking, procurement /
production / shipment status, actuals-vs-estimate reconciliation,
etc.) are post-v1 scope — they belong to Layer 2, not the per-
quote flow.

See `CLAUDE.md` "Surface naming canon" section + "Quote umbrella
structure" subsection. See `docs/quote-umbrella-brief.md` (v1
path item 4 — combined slice).

### v1.1+ / v2 strategic frame — orchestration wrapper above per-quote flow

Post-v1, Nexus grows a second architectural layer:

**Layer 1 — per-quote flow (v1 scope).** Setup → Costs → Pricing
→ Quote (umbrella with sub-tabs). Build and execute one quote at
a time. Linear sequence; each surface is a phase of work on a
single internal quote artifact.

**Layer 2 — orchestration wrapper (v1.1+ / v2).** Cross-cutting
dashboard layer that sits ABOVE the per-quote flow. Different
KIND of surface — it manages many quotes/deals from above, not
the work inside any single one. Concept includes:

- Home dashboard
- Items in flight (cross-quote view)
- Post-acceptance tracking (procurement, production, shipment,
  delivery, invoice)
- BOM generation
- Packing list
- Freight tracker
- Cross-quote views
- Actuals-vs-estimate reconciliation

Placement TBD (home-page level? deal organizer level? separate
workspace concept?) — design call when scoped post-v1. See
UX_BACKLOG entry "Operations wrapper / orchestration layer" for
the full scope inventory + open boundary questions.

### HubSpot deprecation path

Post-quote operations moves fully to Nexus over time. HubSpot
stays CRM for pre-quote deal pipeline, contacts, account
hierarchy, and pre-quote conversation history. Post-acceptance
lifecycle tracking — currently scattered across Monday.com
boards, SharePoint folders, and HubSpot deal-stage hacks —
consolidates in Nexus's Layer 2 orchestration wrapper.

NetSuite continues as GL/inventory backbone. The v2 commitment
(Nexus → NetSuite direct integration, replacing the HubSpot
writeback) absorbs the assembly-aware operational artifacts
NetSuite handles poorly today — assemblies, BOMs, nested
costing. NetSuite retains the ledger-of-truth role for
transactions; Nexus retains the operational-process role for
assembly-aware work.

### Corroborating signal — Aisha 1:1 (May 15 2026)

Ops-analyst Aisha Manjra independently surfaced two corroborating
observations during the May 15 2026 workflow review:

1. "HubSpot remains as syncing and reporting middleman for now
   but will be phased out later." Aligns with the HubSpot
   deprecation path above.
2. "Operational dashboard to replace Monday.com and SharePoint."
   Aligns with the Layer 2 orchestration wrapper scope — the
   wrapper IS Aisha's operational dashboard need.

The convergence between Edward's two-layer architectural framing
and Aisha's independent ops-side dashboard request is strong
signal that the orchestration wrapper is the right post-v1
direction.

### Relationship to the v1/v2 product-master boundary

The v1/v2 product-master boundary is still load-bearing. The
lifecycle ambition rides *on top of* that boundary — it doesn't
replace it.

- **v1 (today):** HubSpot is product-master; Nexus consumes
  HubSpot products; the Quote umbrella slice (v1 path item 4)
  is the peak of HubSpot integration depth. Layer 2
  orchestration wrapper builds out post-v1 in the HubSpot-master
  regime initially.
- **v2 (later):** NetSuite becomes product-master; Nexus →
  NetSuite direct integration replaces the HubSpot writeback.
  Layer 2 orchestration wrapper continues operating; the
  product-master switch doesn't disturb the lifecycle layer.

The two axes are independent: layer expansion (Layer 1 → Layer
1+2) can advance on the v1 product-master regime; product-master
switch (HubSpot → NetSuite) can advance independently of layer
scope.

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
