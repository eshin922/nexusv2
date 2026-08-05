> # ⚠️ SUPERSEDED — THE GATE COLUMN BELOW IS VOID
>
> **Superseded:** 2026-08-04 · **By:** operator review and
> [`phase-2-freight-dom-parity-audit.md`](phase-2-freight-dom-parity-audit.md)
>
> **The Design Authority Matrix in this document marks all thirteen rows PASS.
> Those PASS verdicts are void.** They recorded *engineering completion* and
> were self-certified before real operator validation. Operator review of the
> implemented surface contradicted several of them.
>
> Under [`NEXUS_IMPLEMENTATION_STANDARD.md` §2](NEXUS_IMPLEMENTATION_STANDARD.md),
> operator-reviewed corrections are **tier 2** authority and outrank the design
> bundle at tier 3. An operator finding is not a defect against the design — it
> carries information the design's author did not have, and it refines the
> bundle.
>
> Operator findings not reflected in the matrix: duplicated Freight headers ·
> incorrect typography hierarchy · missing T1/T2/T3 visual hierarchy · spacing
> rhythm deviations · incorrect nesting · generic CRUD remnants · implementation
> approximated the supplied CSS rather than using it verbatim.
>
> **Work from [`phase-2-freight-dom-parity-audit.md`](phase-2-freight-dom-parity-audit.md)
> instead** — thirteen rows, source-component by source-component, with a
> disposition for each.
>
> ### Why this document is retained
>
> It is the **origin record for the four approved deviations** (product-scoped
> ownership, inherited shipment contents, invoice-entered customs only, dynamic
> tier columns), and its matrix row structure is what the parity audit is built
> on. Deleting it would orphan both. The deviations are now also carried
> forward, with rationale, in
> [`design-authority/freight-1a/BUNDLE.md`](design-authority/freight-1a/BUNDLE.md),
> which is their governing home.
>
> **Bundle location note:** the authority cited below as
> `Extract file as project (11).zip` is now tracked at
> [`design-authority/freight-1a/`](design-authority/freight-1a/), with the
> original archive retained at `design-authority/_intake/freight-1a.zip`.

---

# Phase 2 Freight Design Authority

Authority: `Extract file as project (11).zip`, `freight-1a`, Option A.

The bundled artifact is the executable UI specification. Existing Nexus edit,
save, validation, provenance, and modal conventions apply only where the bundle
is silent. The only approved source deviations are:

- Freight is grouped by Setup-defined products; the product-scoped entry point
  establishes shipment ownership.
- Initial shipment contents inherit the owning product's Setup components;
  governed changes use `Edit shipment contents` and cannot cross that product.
- V1 customs accepts invoice-entered Duty and Tariff only. MPF/HMF remain within
  Duty; rate/base authority and Entry Fees are out of scope.
- The bundled tier-column grammar scales to the Quote's actual tier count.

The production surface now uses the bundle's `fr-*` component grammar and its
canonical `app/freight/styles.css`; it does not maintain a parallel visual model.

## Design Authority Matrix

| Bundle screen/state | Required production behavior | Production owner | Evidence | Gate |
|---|---|---|---|---|
| 01 Empty section | Freight header, Quote tier columns, “Nothing ships yet”, `+ What ships` | `FreightDrilldown` | `evidence/phase-2-freight/bundled-empty.png`; `evidence/phase-2-freight/implemented-empty.png` | PASS |
| 02 What ships | Product-scoped business-language modal for shipment, origin, carrier, Incoterm, journey, cargo ready, treatment, border status, inherited Setup contents, and first destination | `CreateShipmentModal` | permanent browser visual baseline | PASS |
| 03 Nothing costed | Subcategory → destination → Quote-break hierarchy without an empty generic CRUD table | `ShipmentLedger`, `DestinationRow` | Permanent design-authority regression | PASS |
| 04 First figure | Amount × markup → sell per unit at the actual Quote break | `DestinationRow` | `evidence/phase-2-freight/implemented-complete.png` | PASS |
| 05 Breaks differ | “One value, all breaks” copies the entry into every break; “differs by break” unlocks independent values | `DestinationRow`, `updateFreightDestinationBreakGroup` | Permanent action regression; `evidence/phase-2-freight/implemented-expanded.png` | PASS |
| 06 Customs entry | Invoice-entered Duty and Tariff are separate from freight and retained once per subcategory | `CustomsLedger` | `evidence/phase-2-freight/implemented-complete.png` | PASS |
| 07 Second destination | Inline destination candidate, inherited entry defaults, retained comparison evidence | `InlineDestination`, `addFreightDestination` | `evidence/phase-2-freight/implemented-complete.png` | PASS |
| 08 Choose + why | Radio selection, `in the price`, per-unit delta, editable reason, no implicit promotion | `DestinationRow`, `Comparison`, `SelectionReason` | `evidence/phase-2-freight/implemented-expanded.png`; permanent deletion regression | PASS |
| 09 Complete | Multiple subcategories, selected rows, comparison rows, customs, supporting detail, tracking, totals | `FreightDrilldown` | `evidence/phase-2-freight/bundled-complete.png`; `evidence/phase-2-freight/implemented-complete.png` | PASS |
| Resting state | Compact shipment evidence with detail collapsed and comparison options retained | `ShipmentLedger` | `evidence/phase-2-freight/bundled-resting.png`; `evidence/phase-2-freight/implemented-complete.png` | PASS |
| Expanded ledger | Type/description rows beneath every Quote break; supporting comparison/reason/tracking detail | `DestinationRow`, `ShipmentLedger` | `evidence/phase-2-freight/implemented-expanded.png` | PASS |
| Tracking after selection change | Tracking remains attached to its recorded destination and a stale-endpoint warning is shown | `TrackingStrip`, `updateFreightTracking` | Permanent design-authority and action regressions | PASS |

Automated behavior proof and operator review remain separate acceptance gates.

The permanent source-fidelity baseline is
`tests/e2e/costing/phase-2-component-freight.spec.ts-snapshots/freight-source-authority-six-sku-costing-serial-win32.png`.
