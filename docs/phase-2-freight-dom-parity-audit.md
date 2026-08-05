# Phase 2 Freight DOM/Class Parity Audit

> **This is the current, governing gap list for Freight design fidelity.**
> Work from this document.
>
> **Precedence:** tier 2 — operator-reviewed corrections — under
> [`NEXUS_IMPLEMENTATION_STANDARD.md` §2](NEXUS_IMPLEMENTATION_STANDARD.md).
> It **outranks the design bundle** it audits against, because operator review
> carries information the bundle's author did not have.
>
> **Supersedes** the Design Authority Matrix in
> [`phase-2-freight-design-authority.md`](phase-2-freight-design-authority.md),
> whose PASS verdicts are void.
>
> **The bundle is now tracked** at
> [`design-authority/freight-1a/`](design-authority/freight-1a/BUNDLE.md) —
> the citation below by original ZIP filename resolves there. The four approved
> deviations are recorded with rationale in that bundle's `BUNDLE.md`.
>
> **Scope note:** this audit covers the Freight **worksheet**. Whether the
> bundle's Costs-page shell (`app/costs/styles.css`, 23 `cw-*` classes) is also
> in Phase 2 scope is undecided — [OD-008](OPEN_DECISIONS.md).

Authority: `Extract file as project (11).zip`,
`freight-1a/app/freight/1a.jsx`, Option A, with canonical
`freight-1a/app/freight/styles.css`.

Approved deviations remain limited to Setup-owned product grouping, inherited
shipment contents, invoice-entered Duty/Tariff only, and dynamic Quote tiers.

| Source component/state | Production divergence before reconciliation | Missing/modified DOM or class | Disposition |
|---|---|---|---|
| `OptionA` section head | Freight was named by both the Costs accordion and an inner `cw-shead` | Duplicate hierarchy and spacing | **Migrate, not reinstate — see C1 below.** Keep the Costs accordion as the one section heading; begin the worksheet at `TierHead` inside its drawer. Publish the family summary upward into the accordion header; keep Expand All in the section body. |
| `TierHead` | Dynamic columns existed, but local inline geometry overrode the canonical grid rhythm | Modified `fr-grid fr-tierhead` geometry | Use the canonical class tree and only parameterize the repeat count. |
| `OptionA > fr-sc` | Production compressed the source hierarchy into `ShipmentLedger` and added edit/save controls inside the resting header | Modified nesting around `fr-schead`, `fr-eyebrow`, `fr-scname`, `fr-skus`, `fr-fields`, `fr-decision` | Reproduce the source nesting; retain governed edit disclosure only where the bundle is silent. |
| Destination resting row | Inputs were present, but amount/markup/sell and label metadata used modified wrappers; a standalone `Save` appeared in the label column | Missing `fr-dname`, `mrow`, `x`, `arr`, `sell` fidelity; invented visible save control | Use the source row grammar; persist on field exit through the Nexus autosave convention. |
| One-value state | The carry message was rendered per cell and aligned differently from the source row grammar | Modified `fr-entrycell`/`cbm` placement | Match source `fr-entrycell` and `cbm` nesting for every actual Quote tier. |
| `EntryRows` | Production used anonymous grids and adapter CSS | Missing `fr-grid`, `fr-elab`, `fr-cell`, `fr-in txt` hierarchy | Reproduce `EntryRows` directly and parameterize only the tier count. |
| `EntryCosts` | Customs used forms as grid cells, omitted the source total row, and exposed repeated save controls | Modified `fr-chead`; missing `lb/n/d`, `mk`, `n/v/s`; missing `fr-crow tot` | Reproduce the source customs ledger, omit only the disallowed source selector/Entry Fees, add `Carried to every destination`, autosave inputs. |
| `Support` | Chips and tracking were approximated after initial implementation | Modified `fr-foldbtn`, `fr-chips`, `fr-fchip`, reason and tracking nesting | Reproduce the source fold, comparison, reason, and tracking class tree. |
| `Tracking` | Field labels were adapted but not nested identically | Modified `fr-track`, `fr-tfields`, `f/k`, `fr-tin sm date` | Use the source hierarchy; retain endpoint ownership and stale warning. |
| `TotalStrip` | Total values existed, but the row initially used custom wrappers | Modified `lab/n/m`, `fr-cell/v/s`, assertion nesting | Use the source DOM exactly with dynamic Quote tiers. |
| `AddModal` | Business fields were correct but depended on descendant CSS adapters instead of source classes | Missing `fr-lbl` and `fr-tin` on controls | Apply source classes directly; retain only product ownership/inherited membership deviations. |
| Product grouping | Not present in the bundle | Approved later business disposition | Wrap source-faithful shipment cards in a minimal Setup-owned product group; do not alter the inner worksheet grammar. |
| Canonical CSS | Bundle CSS was copied, then adapter rules compensated for divergent DOM | Modified spacing/typography through compatibility selectors | Delete compatibility styling as reconciled nodes adopt the canonical DOM; retain only product-group and dynamic-tier rules. |

No remaining row is permitted to use a parallel `fr1-*` visual grammar. Tests
and screenshots prove behavior and fidelity separately.

---

## C1 — approved Design Authority interpretation (2026-08-04)

**Design Authority for the section head is MIGRATE, not reinstate.**

> The bundle's authority is the operator information and interactions, not the
> original Costs-page shell.

The first row's disposition removed `cw-shead` to end the duplicated Freight
heading. That was correct, but it also removed two affordances the row never
addressed: the **family summary** and the **section-level Expand All**. The
bundle justifies the latter in its own source comment as the answer to Option
A's known weakness — *"nine disclosures to type 27 totals."*

**Why the original placement could not be reinstated.** `.cw-shead` is itself a
header bar (`padding: 13px 18px; background: var(--paper-3); border-bottom`).
Removing `<span className="t">Freight</span>` removes the word, not the bar;
restoring the container re-creates the duplicate hierarchy the operator review
rejected. Separately, `.cw-shead` has no rules anywhere in `src/styles/` —
`app/costs/styles.css` was never adopted (see OD-008) — so the removed markup
had been rendering unstyled.

**Approved resolution:**

| Element | Destination | Rationale |
|---|---|---|
| Section title + ownership | **Accordion header only** | Single owner. No second Freight header in the body |
| Family summary | **Published upward into the accordion `sublabel`** | The collapsed section keeps exposing operator-critical state — the property the bundle's placement provided |
| Unresolved-work warning | **`indicatorChip` (`tone: "warn"`) on the accordion header** | Visible while collapsed; uses an existing host affordance, no new props |
| Expand All | **Section body, in the `fr-tierhead` label cell** | It operates on destination rows, not on the accordion. It must not appear in the host header |

The CD fallback (thin summary strip at the top of the section body) was **not
required**: `SectionWithDrilldown` already accepts `sublabel` and an optional
`indicatorChip` rendered inline with it in the always-visible header. No host
component change was needed, so no architectural debt was introduced.

**Implemented:** `freightSublabel` / `freightIndicatorChip` /
`freightUndecidedCount` in the Costs page; expand-all control in
`FreightDrilldown`.

## C2 — `fr-math` excluded from V1

The bundle's `duty workings` chip and its paired `fr-math` block are **designer
rationale** for the invoice-entered customs model, not operator-facing
functionality. Excluded from V1. V1 remains invoice-entered Duty and Tariff
only. **No replacement operator copy was written.**

## Full 13-row pass — findings and dispositions (2026-08-04)

All thirteen rows audited line-by-line against
`freight-1a/app/freight/1a.jsx`. Four rows matched as assembled; the
findings below were dispositioned and closed.

| ID | Row | Finding | Disposition |
|---|---|---|---|
| **F-A** | 3 | `ShipmentEdit` / `DestinationEdit` `<details>` disclosures are not in the bundle | **Approved Nexus deviation.** Follows the platform form-action convention; no conflict with the bundle's operator hierarchy or business behaviour. Not removed for literal DOM parity |
| **F-B** | 4 | `fr-inherit` "type + markup inherited" disclosure missing; the behaviour existed but was invisible | **Fixed.** Derived from a destination carrying seeded mode/markup with no amount yet |
| **F-C** | 4 | Unpriced destination rendered `$0.0000` | **Fixed.** Renders `—`; the sell guard is `priced`, matching source |
| **F-D** | 4 | Bundle models a new destination as inline `.fr-dest.draft`; production uses a separate `fr-dest-draft` form | **Approved Nexus deviation.** The form-action convention provides the same destination-creation workflow. Retained unless operator validation finds a workflow defect |
| **F-E** | 6 | Flat mode collapsed per-break mode and description | **Fixed — capability correction.** See below |
| **F-F** | 9 | `unset` "not set" tracking indicators missing; `<label>` used for `<div>` | **Fixed.** Indicators restored; the accessible `<label className="f">` retained as an accepted extension |
| **F-G** | 11 | Free-text incoterm replaced by a select; journey / treatment / transit added; two `fr-hint`s missing | **Fixed + approved deviation.** Hints and `fr-src on` restored. **Free-text incoterm is intentionally not adopted: the persisted authority is the `freightIncoterm` pgEnum**, and free text would admit values the column rejects. Journey, treatment and transit are governed schema columns surfaced at creation |

### F-E — "one value, all breaks" governs the amount only

The authoritative design places mode and shipment description on the break
row, not the shipment, because the same shipment family may legitimately be
**LTL at one break and FTL at another while carrying one negotiated amount
across all of them.**

Production had extended flat mode to those fields — the UI suppressed them for
tiers 2+, and the action keyed every field on `sourceTierId`. No data was lost,
but the operational identity of the individual breaks was collapsed.

Corrected: amount and markup source from the flat tier; mode and description
always persist against each row's own `tierId`; absent fields are preserved
rather than nulled, so toggling flat cannot destroy tier-specific values.

Field-source resolution is a pure contract in `src/lib/freight-break-write.ts`
with behavioural coverage in `tests/unit/phase-2-freight-break-write.test.ts`
— outcomes, not source text.

### Row status

| Row | Status |
|---|---|
| 1 `OptionA` head | ✅ Closed — C1 migration |
| 2 `TierHead` | ✅ Match |
| 3 `fr-sc` / `fr-schead` | ✅ Closed — F-A approved deviation |
| 4 Destination resting row | ✅ Closed — F-B, F-C fixed; F-D approved deviation |
| 5 One-value state | ✅ Match |
| 6 `EntryRows` | ✅ Closed — F-E corrected |
| 7 `EntryCosts` | ✅ Match |
| 8 `Support` | ✅ Closed — C2 |
| 9 `Tracking` | ✅ Closed — F-F fixed |
| 10 `TotalStrip` | ✅ Closed — C3 |
| 11 `AddModal` | ✅ Closed — F-G fixed + deviation recorded |
| 12 Product grouping | ✅ Match — deviation D1; inner grammar unaltered |
| 13 Canonical CSS | ✅ Closed — dead variant rules removed in an isolated cleanup commit |

### Approved non-bundle classes

Retained, each with a recorded rationale: `.freight-authority`,
`.fr-product-group`, `.fr-product-head`, `.fr-product-components`,
`.fr-shipment-contents` (deviations D1/D2) · `.fr-edit-disclosure` (F-A) ·
`.fr-dest-draft` (F-D).

## C3 — conditional behaviour and operator terminology

`TotalStrip`'s conditional meta line and `Support`'s conditional chip
construction are restored from source. **"shipment" is the approved operator
term** for the bundle's *subcategory*, applied consistently across the operator
surface; schema entities keep `freight_subcategories`.
