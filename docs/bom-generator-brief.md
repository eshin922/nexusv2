# Brief: BOM Generator (v1.1)

> **Status:** Backlog / v1.1 — not yet active. Slice opens after §6.c (Component cost data unification), R8 design round, and Multi-route implementation slice ship.

## §0 Fidelity Discipline

This brief is a **scope contract**, not a fidelity contract. Visual/IA fidelity comes from the R8 design round (multi-route IA + BOM IA, coupled design round). When R8 ships:

- Brief authorship paraphrase is NEVER source of truth for visual treatment, copy verbatim, or layout
- R8 designer notes + prototype source files are canonical (Pattern 30 — unbundled prototype source ships alongside HTML shell at R8 time)
- Per-commit two-layer manifest discipline applies (Pattern 26+27 — STRUCTURAL + POLISH split into Visual / Copy)
- Schema-verification pass precedes Edward approval of the implementation brief (Pattern 25, promoted to standing protocol)

## Context

The DPS operates as a CDM (contract manufacturer) producing finished goods for customer brands. After a quote is accepted, internal teams (production, procurement, freight forwarder, Korean CM, China packaging vendor) need a **source-of-truth artifact** describing what to produce, where to produce it, what it costs, and how it ships.

Today this artifact is either reconstructed manually from the quote + tribal knowledge, or it doesn't exist as a unified document. Nexus generates it natively at acceptance time.

**Operational rule:** BOM is **locked at acceptance, immutable**. Later quote edits do not mutate the accepted BOM. If the quote is re-issued (rare, requires explicit re-acceptance), a new BOM version is generated. Same snapshot semantics as Costing at acceptance.

## Intent

- **Trigger:** post-quote-acceptance, alongside HubSpot deal writeback + NetSuite Sales Order push (from v1 Mark-Accepted external writebacks slice — BOM gen is a third writeback action on the same state-machine extension point)
- **Output:** PDF artifact (likely; confirmed at R8 design time) — distributable to internal recipients
- **Audience:** Production team, procurement, Korean CM, China packaging vendor, freight forwarder, internal cost archive — different recipients may receive different rendering variants (see Open Q1 below)

## Section spec

Eight sections. Three are hidden by default (schema preserved, render suppressed in default BOM). Compliance Claims sub-section ships in a later v1.1 slice, not the base slice.

| Section | Render in default BOM | Data source (preliminary; verify each at brief-active time) |
|---|---|---|
| Packaging | ✅ | `quote_skus` filtered by `hs_product_type ∈ {Primary Packaging, Secondary Packaging}` |
| Formula | ✅ | `quote_skus` filtered by `hs_product_type = Formulation` |
| Components | ✅ | Full `quote_skus` tree (assembly leaves) — depends on §6.c clean component data |
| Vendors | ❌ hidden by default | HubSpot product properties (vendor field per product) — verify property exists |
| Manufacturing | ✅ (trimmed) | Quote-level metadata — **production location + lead times only**; CM identity hidden by default |
| Costing | ✅ | Cost build snapshot tables, locked at acceptance |
| Compliance (base) | ✅ | FSC fields on products + country of origin per component + regulatory certs (verify schema) |
| Compliance Claims | ❌ deferred within v1.1 | Ships as later v1.1 amendment slice |
| Logistics | ✅ | Quote-level multi-route data (depends on R8 multi-route impl slice) |

### Hidden-by-default semantics

Vendors + CM identity are hidden by default but the schema is preserved. Three possible interpretations of "hidden by default" pending R8 disposition:

1. **Schema-preserved, render-suppressed permanently** — fields exist but BOM never renders them; future toggle/admin view could reveal
2. **Conditional rendering by audience** — default BOM hides; specific export variants (e.g., internal-only) show. Korean CM doesn't see China vendor identity; customer doesn't see anyone (white-label thinking)
3. **Render-suppressed permanently** — never surface in BOM; vendor/CM data lives in NetSuite/HubSpot only

Most likely #2 given the multi-route shipping context. **R8 design round dispositions.**

### Manufacturing section content

Render in default BOM:
- Production location (where the run executes — Korean CM facility, etc.)
- Lead times (production lead + transit per leg from Logistics section)

Hidden by default:
- CM identity (specific contractor)
- Vendor identities per component

## Architectural decisions needed (open questions for R8 design round)

1. **Hidden-by-default semantics** — interpretations 1, 2, or 3 above
2. **Output format** — PDF only, or also a viewable in-app surface (e.g., "BOM" tab on accepted quotes)?
3. **Audience-based rendering** — if interpretation 2, what are the variant rendering rules per recipient type?
4. **Distribution mechanism** — email at acceptance? Download from accepted-quote view? PM-initiated share with specific recipient?

## Open questions for brief-active time (before slice begins)

5. **NetSuite BOM record integration** — does BOM data also push to NetSuite as Item BOM relationships on the assembly? Or is BOM a Nexus-only artifact that mirrors NetSuite's already-existing assembly structure?
6. **Versioning** — strict "accepted once, BOM is final" OR re-issue on re-acceptance with version increment?
7. **Vendor field source of truth in HubSpot** — verify property exists on `hubspot_product` (Pattern 22)
8. **Manufacturing schema verification** — `production_location` + `lead_time` fields on `quotes` table? Or computed from leg + component data? Pattern 22 verification required
9. **Compliance section content beyond FSC + country-of-origin** — regulatory certs (FDA, REACH, EU cosmetics regs), MSDS references, allergen flags?
10. **Trigger mechanics** — automatic generation on acceptance state transition, OR PM-confirmed generation step?
11. **Re-generation** — if a BOM has rendering bugs after generation, is it regeneratable from the locked snapshot data, or strictly one-shot?

## Dependencies (must ship before BOM slice begins)

| Dependency | Why |
|---|---|
| §6.c Component cost data unification | Components section reads canonical component data |
| R8 design round (multi-route + BOM IA — coupled) | Logistics section IA + BOM IA disposed before implementation |
| Multi-route implementation slice | Logistics section reads multi-route schema |
| Mark-Accepted external writebacks (from v1) | BOM gen is a third post-acceptance writeback action on the same state-machine extension point |

## Phased plan within v1.1

### Phase 1 — BOM base slice
- 7 rendering sections: Packaging / Formula / Components / Manufacturing (trimmed) / Costing / Compliance (base) / Logistics
- Hidden-section scaffolding (Vendors + CM identity schema-preserved, render-suppressed) per R8 disposition
- PDF generation pipeline (likely shares infrastructure with v1 customer-quote PDF render path)
- Post-acceptance trigger wired into Mark-Accepted state machine
- Pre-defined recipient distribution mechanism (per R8 disposition)
- Smoke + designer audit + PR

### Phase 2 — Compliance Claims sub-section slice
- Adds Claims sub-section to Compliance section
- Schema work for claim records on products / quotes
- Render integration into existing BOM PDF pipeline
- Smoke + designer audit + PR

## Methodological discipline (carries forward from v1 patterns)

- **Pattern 22** — Schema verification per section before encoding rendering. Each of the 8 sections is a Pattern 22 opportunity — confirm the data exists or scope the data-architecture work to make it exist.
- **Pattern 25 (promoted to standing protocol)** — CC schema-verification pass on brief BEFORE Edward approval of implementation
- **Pattern 26+27** — Per-commit two-layer manifest (STRUCTURAL + POLISH split into Visual / Copy verbatim)
- **Pattern 28** — Brief is scope contract; R8 design docs + prototype source files are fidelity contract
- **Pattern 30** — Prototype source files (R8 design round) are first-class deliverables — unbundled source alongside HTML shell at R8 time
- **Pattern 33** — Scope/cost evaluation separate from architectural cleanliness evaluation. Concrete work breakdown surfaced before brief approval.
- **Pattern 35 candidate** — Multi-section artifacts (the 8 BOM sections) require explicit per-section data-source mapping at brief time. Each section is its own Pattern 22 opportunity.

## Sequencing in v1.1

| Order | Slice | Note |
|---|---|---|
| 1 | §6.c Component cost data unification | Carves from §6.b Mismatch 1; unblocks BOM Components section |
| 2 | R8 design round | Multi-route IA + BOM IA — coupled design round |
| 3 | Multi-route implementation slice | Logistics section reads multi-route data |
| 4 | **BOM generator base slice (Phase 1)** | This brief, Phase 1 scope |
| 5 | BOM Compliance Claims sub-section slice (Phase 2) | This brief, Phase 2 scope |
| ... | (other v1.1 slices) | Slice 9, Slice 11, Slice 13, HubSpot webhook, Pull from Inventory, R7c, etc. |

## Reference: Section content distinguishing notes

- **Packaging vs Components** — Packaging section is filtered subset (Primary + Secondary Packaging product types); Components section is full assembly tree. There IS overlap (packaging items appear in both). The Packaging section is the focused view for procurement/customs; Components is the engineering reference.
- **Manufacturing vs Logistics** — Manufacturing covers WHERE the run executes (production location) + WHEN (lead times). Logistics covers HOW goods move post-production (multi-route shipping legs). They share lead-time-per-leg data but render distinctly.
- **Costing vs the customer-facing Quote PDF** — BOM Costing section is INTERNAL; shows full cost build per component. Customer Quote PDF shows accepted-tier pricing only, never the cost build. These are two distinct PDFs from the same quote artifact, generated at acceptance, distributed to different audiences.
