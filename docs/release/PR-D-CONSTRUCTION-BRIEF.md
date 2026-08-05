# PR-D — Construction Brief

**Status:** Approved, not yet constructed.
**Type:** Release reconstruction, **not** new implementation.
**Approved:** 2026-08-05

PR-D is a curated diff that never existed as a commit. It presents the final
architecture for review rather than replaying an intermediate implementation
state that PR-E immediately removes.

---

## Scope

**Contains:** the enduring quote-level Freight markup authority, migration
`0053` in full, and the send/clone paths that are still live.

**Excludes:** the superseded R5 Freight UI and its UI-only plumbing, fixtures
and assertions.

---

## ⚠️ The boundary decision, and why it is not "cleaner" the other way

`0053` creates two component-tier tables — `freight_leg_component_tier_costs`
and `quote_snapshot_freight_inputs`. An architecturally tidier PR-D would split
them out. **It must not.**

Those tables are **still live at HEAD**:

- `sendQuote` writes the dual Freight snapshot
- clone remaps component-tier costs through canonical identities
- both paths execute and are regression-covered by
  `phase-2-freight-lifecycle.test.ts`
- **PR-E depends on the tables existing**

Splitting `0053` would pull legacy retirement into a release-reconstruction
task and leave PR-E referencing tables no migration creates. PR-E would not
build.

### Required classification in the PR description

> **Transitional compatibility infrastructure retained until F3 Stage 4.**

Do **not** describe the component-tier schema as enduring V1 authority. It is
not. Retirement is governed by **F3 Stage 4** and was explicitly deferred to
pre-V1.

---

## Include

| File | Content |
|---|---|
| `drizzle/0053_phase_2_component_freight_expand.sql` | **Whole** — both component-tier tables included |
| `drizzle/meta/_journal.json` | idx 51 entry |
| `src/db/schema.ts` | `firm_settings.freight_markup_pct_default`; `quotes.freight_markup_pct`; pin extension; the two transitional tables |
| `src/lib/commercial-settings.ts` | Markup in lifecycle resolution (×3) |
| `src/lib/commercial-settings-contract.ts` | Markup in the resolution type (×1) |
| `src/app/actions/firm-settings.ts` | Versioned carry-forward of the new column (×1) |
| `src/app/actions/quotes.ts` | Quote init from firm default; pin write; send/clone snapshot dependencies |
| `src/lib/costing.ts` | Quote-level markup consumption |
| Tests | `phase-2-freight-schema`, `phase-2-freight-costing`, `phase-2-freight-lifecycle`, `commercial-settings-contract`, `phase-1-commercial-pin-writer` |

## Exclude

| File | Evidence it is superseded |
|---|---|
| `src/components/costs/freight-drilldown.tsx` | PR-E replaces **2,411 lines** |
| `costs/page.tsx` — R5 freight section | PR-E rewrites 149 lines |
| `tests/harness/fixtures/world.ts` — R5 freight fixtures | PR-E rewrites 150 lines |
| `tests/unit/phase-2-freight-ui.test.ts`, `phase-2-operator-fixtures.test.ts` | Assert the superseded surface |
| R5 deltas in `scenario-context-strip.tsx`, `costing-store.ts`, `costing-adapter.ts`, `quote-cost-completeness.ts` | Component-tier **UI** plumbing |

---

## Provenance split — preserve exactly

**Retained:** `ad5751a` · `cebdd42` · `d067e09` · `e3ec26f` · `e2ec39e`

**Excluded:** `157ef94` · `28b3dd6` · `a9ab2f5` · `6f0662d` · `63d268d`

**No approved final behaviour is lost.** Every excluded file is superseded by a
later commit already on the Phase 2 branch — nothing is dropped, only
un-replayed.

---

## Verification before opening

1. **Schema state before `0053`** — PR-D is purely additive at migration 49
2. **Schema state after `0053`** — additive columns, backfill, `SET NOT NULL`
3. **Deployed-app compatibility** — `origin/main` neither declares nor selects
   the new columns; no behaviour change
4. **PR-E dependency** — satisfied **only** because `0053` ships whole

Plus: clean `tsc`, green unit suite, all prebuild verifiers.

---

## Release position

```
PR-B → apply 0051–0052 → verify
PR-D → apply 0053      → verify          ← this PR
PR-E → apply 0054–0055 → deploy worksheet code → verify
PR-F → apply 0036      → deploy realtime code  → Stage 4
PR-G → apply 0056      → only after Stage 4 + operator validation
```

## Retirement obligation

**F3 Stage 4** owns retirement of the transitional component-tier persistence:
resolve the dual snapshot in `sendQuote`, migrate the clone remap, then delete
`actions/freight.ts` (orphaned, zero UI importers) and finally drop the tables.
Post-V1. Tracked alongside [OD-010](../OPEN_DECISIONS.md).

Do not attempt any part of it inside PR-D.
