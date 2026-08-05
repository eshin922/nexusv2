# PR-D — Review Package

**Branch:** `release/pr-d-quote-freight-markup-authority` @ `70f232b`
**Base:** `5669cf1` (end of PR-C) · **Diff:** 20 files, +735 / −30
**Status:** Ready for review. **Not approved to merge or deploy.**
**Governing boundary:** [`PR-D-CONSTRUCTION-BRIEF.md`](PR-D-CONSTRUCTION-BRIEF.md) as amended

---

## What this PR is

A **curated release reconstruction**, not a commit replay. It presents the
final architecture for review rather than an intermediate implementation state
that PR-E immediately removes.

**Additive in schema and type surface.** Deployed code (`origin/main`,
migration 49) neither declares nor selects the new columns. Behaviour is
unchanged.

---

## Diff summary

| File | ± | Brief mapping |
|---|---|---|
| `drizzle/0053_phase_2_component_freight_expand.sql` | +96 | Include — **whole** |
| `drizzle/meta/_journal.json` | +7 | Include — idx 51 |
| `src/db/schema.ts` | +102 | Include — firm/quote/pin columns; legacy decl **retained** |
| `src/app/actions/costing.ts` | +89 | Include — leg projection restored |
| `src/app/actions/freight.ts` | +111 | Include — **amendment 4** |
| `src/app/actions/quotes.ts` | +95 | Include — pin write, send/clone deps |
| `src/lib/costing.ts` | +45 | Include — `CostingFreightLeg` retained |
| `src/lib/quote-cost-completeness.ts` | +36 | Include |
| `src/lib/costing-adapter.ts` | +6 | Include — **amendment 2** |
| `src/lib/commercial-settings.ts` | +4 | Include — lifecycle resolution |
| `src/lib/commercial-settings-contract.ts` | +1 | Include |
| `src/app/actions/firm-settings.ts` | +1 | Include — carry-forward |
| 8 test files | +166 | Include, curated by release owner |

---

## Provenance

**Fully retained:** `ad5751a` · `cebdd42` · `d067e09` · `e2ec39e`

**Partially retained — `e3ec26f`** ("refactor(freight): cut over quote markup authority"):

| Portion | Destination | Why |
|---|---|---|
| Quote-level markup authority; pin/settings plumbing | **PR-D** | Enduring V1 authority |
| `freightLegs.freightMarkupPct` declaration removal | **PR-E** | Removing it here breaks base consumers and would drag the superseded R5 UI in |
| Consumer cleanup in `freight-drilldown.tsx`, `costing-store.ts`, `actions/freight.ts` | **PR-E** | Belongs with the code that replaces those consumers |
| Migration `0054` (now `0056`) cutover | **PR-G** | Destructive; after Stage 4 |

**Excluded:** `157ef94` · `28b3dd6` · `a9ab2f5` · `6f0662d` · `63d268d`

**No approved final behaviour is lost.** Every excluded file is superseded by a
later commit already on the Phase 2 branch — un-replayed, not dropped.

---

## Transitional-infrastructure classification

The following are **transitional compatibility infrastructure retained until
F3 Stage 4**, explicitly **not enduring V1 authority**:

| Item | Why it stays |
|---|---|
| `freight_leg_component_tier_costs`, `quote_snapshot_freight_inputs` (in `0053`) | `sendQuote` still writes the dual snapshot; clone still remaps through canonical identities; **PR-E depends on both existing** |
| `freightLegs.freightMarkupPct` **declaration** | Existing consumers must keep compiling; keeps this release additive in type surface |
| `CostingFreightLeg.freightMarkupPct` | Same reason; still populated from real data |
| `src/app/actions/freight.ts` | Identity guards still execute and remain regression-covered |

Each carries an inline comment recording the classification and pointing at the
brief. **Reviewers should not read any of it as blessed architecture.**

### No new default constant

The projection uses `num(leg.freightMarkupPct, 0.3)` — the governed column
default (`.notNull().default("0.3000")`), identical to the sibling
`dutyMarkupPct` / `tariffMarkupPct` on the same lines, and identical to what
the base code used. **Two earlier `?? 0.3` consumer fallbacks were removed** in
favour of keeping the field populated at source. Nothing new was introduced.

---

## Test ownership handoff

Exact assertions throughout. **No assertion was ranged, relaxed, or deleted.**

| Assertion | Owner | State |
|---|---|---|
| Journal tail = `0053` (×2) | **PR-D** | ✅ Here |
| `0053` schema shape | **PR-D** | ✅ Here |
| Fail-closed Freight identity guards | **PR-D** | ✅ Here, with `actions/freight.ts` |
| Journal tail through `0055` | **PR-E** | ⏳ Handoff |
| R5-UI assertions (`phase-2-freight-ui`, `phase-2-operator-fixtures`) | **PR-E** | ⏳ Superseded surface |
| "authority cutover removes the leg-level column" | **PR-G** | ⏳ **Moved**, pointer left in `phase-2-freight-schema.test.ts` |
| Journal tail = `0056` | **PR-G** | ⏳ Handoff |

Test count 123 → **122**: the cutover assertion transferred to PR-G rather
than removed.

### Canonical-identity guard

`product-structure-slice1-cutover.test.ts` requires explicit classification of
every file touching canonical-identity symbols. Two files triggered it and both
were **classified, not allowlisted**:

- `actions/freight.ts` → **transitional**; component-tier writes keyed on
  canonical `quoteLeafId`
- `lib/costing.ts` → **enduring**; `canonicalQuoteLeafId` on `CostingSku` is
  the math layer keying on canonical identity by design

---

## Deployment position and rollback

**Sequence position — step 2 of the expand–deploy–contract release.**

```
PR-B → apply 0051–0052 → verify
PR-D → apply 0053      → verify            ← THIS PR
PR-E → apply 0054–0055 → deploy worksheet code → verify
PR-F → apply 0036      → deploy realtime code  → Stage 4
PR-G → apply 0056      → after Stage 4 + operator validation
```

**Deployment assumptions**

- Applies against migration state **52**, producing **53**
- **Purely additive.** No column dropped, no data destroyed, no index rebuilt
- Backfills `quotes.freight_markup_pct` and the pin column from the firm
  default, then `SET NOT NULL` — a table scan on `quotes` and
  `quote_commercial_settings_pins`, both small
- **No maintenance window required**
- Deployed code is unaffected: it neither declares nor selects the new columns

**Rollback**

- **Code:** clean revert; no runtime dependency on the new columns outside this PR
- **Schema:** moderate — `DROP COLUMN` × 3 plus `DROP TABLE` × 2. Reversible, but
  the backfilled values are not recoverable once dropped
- **No irreversible step.** The only destructive migration in the release is
  `0056`, owned by PR-G and gated behind Stage 4
- The legacy `freight_legs.freight_markup_pct` column survives this PR
  untouched, preserving the inexpensive rollback path for everything downstream

---

## Confirmation — no PR-E worksheet content entered this branch

Verified by grep across `src/`, `drizzle/`, `tests/` — **all zero**:

```
freight_subcategories          0        FreightWorkbook              0
freightSubcategories           0        freight-worksheet            0
freight_destination_breaks     0        FreightSectionWithDrilldown  0
fr-sc                          0
```

Migrations on branch end at `0053`. Journal: **52 entries**, tail
`0053_phase_2_component_freight_expand`. No worksheet schema, no worksheet UI,
no store/realtime work.

---

## Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Clean |
| Unit tests | ✅ **122 / 122** |
| Prebuild verifiers | ✅ **7 / 7** |
| Working tree | ✅ Clean |
| Pushed | ❌ No |

## Reviewer notes

Four boundary corrections were required during construction, **all discovered
by compiling rather than planning** — `0053` wholeness, `costing-adapter.ts`
classification, retaining the declaration *and* the pure type, and including
`actions/freight.ts`. All four are recorded in the amended brief.

Worth budgeting for the same on PR-E: up-front file classification has not
proven reliably knowable on this codebase without building it.
