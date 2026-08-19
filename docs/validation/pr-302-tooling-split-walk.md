# PR #302 — Tooling/Artwork split + BV-011 destinations · browser pass

Run 2026-08-19 against the isolated certification lineage. No client project or
pre-split work was touched.

| | |
|---|---|
| project | `d9dc519a` · ZZ-VALIDATION — Nexus Certification Lineage |
| quote | `7d4983a7` · CERT-302 tooling artwork split (draft) |

## 1 · Separate Tooling and Artwork rows on a fresh quote — GREEN

Costs → Production renders, in order: Filling / blending · CM assembly ·
**Setup fee** · **Tooling total** · **Artwork total** · R&D fee · Other service
fee · Bulk raw cost. Both new rows carry category `Tooling`, kind `one-time`,
markup `40.0%`.

## 2 · No legacy row on a fresh quote — GREEN

`Tooling / artwork total` is absent from that list. It is offered only where a
value already exists, so an operator cannot create new unresolvable data.

## 3 · Legacy row visible and editable where a value exists — GREEN

With `tooling_artwork_total = 900` seeded, the row appears **above** its two
governed successors, showing `900.00 → $0.90/u`, editable. Production header
reads `$1.26` for Tier 1.

The value was seeded directly, because the UI deliberately will not offer the
input on a quote that has never carried one — that is the behaviour under test.
It reproduces the migration state old data contains; it invents no derived
economics. `bv011-seed-legacy.ts` **refuses any project not named
ZZ-VALIDATION**, verified against a real client quote:

```
REFUSED — "Smart Pressed Juice - Juice Cleanse Reorder 2026" is not a ZZ-VALIDATION project.
```

## 4 · Resolution works and persists — GREEN

Entered Tooling `600`, Artwork `300`, cleared the combined `900`, saved, reloaded:

```
tier      legacy_combined   tooling   artwork   allocated
Tier 1                  —    600.00    300.00   true
```

`TOTAL — PRODUCTION` stayed `$900.00` throughout, and the two rows show
`$0.60/u` and `$0.30/u`.

## 5 · Customer economics do not move — GREEN

Same allocation state (`allocated = true`), split summing to the same 900:

```
                 unit_subtotal   otc   tier_commercial_total   unit rate
legacy 900          1260.0000   0.00              1260.0000    1.260000
600 + 300           1260.0000   0.00              1260.0000    1.260000
```

Identical to four decimals on the total and six on the rate. Splitting the
input changes which accounting destination a fee posts to; it changes no price.

## 6 · An unresolved legacy charge blocks projection — GREEN

Run headless inside a rolled-back transaction, because the state needs a frozen
matrix (only possible post-#300) carrying an unresolved legacy line at an
accepted tier.

```
PASS  projection is BLOCKED, not skipped
PASS  the blocker names the legacy combined charge specifically
PASS  exactly ONE line is legacy combined, not every null-destination line
PASS  the remediation names both governed inputs and where to enter them
PASS  NOTHING was committed — no injected line, no accepted tier
```

> "Tooling & artwork" is a legacy combined Tooling + Artwork charge. BV-011
> governs those as separate destinations with different item types, and no rule
> can say which half this amount is. Resolve it into the Tooling and Artwork
> inputs on Costs, then revise and re-send.

**This check found a real defect.** On its first run it reported the
**Formulation Direct Service** as a legacy Tooling/Artwork charge — because
`bv011_destination IS NULL` meant both "legacy combined" and "frozen before the
column existed", and every frozen line today is the second. Fixed by migration
`0089` (`legacy_unresolved`, an explicit statement rather than an inference) plus
deriving a Direct Service's destination from its frozen `service_identity`. The
run above is post-fix, and now returns three *distinct* blockers.

## 7 · Keyed and displayed by BV-011 destination — GREEN

Settings → NetSuite lists all sixteen destinations by label and key
(`OTC - Filling` / `otc_filling`), with the governed BV-011 item type beside
each. Not by service identity. The page states that admins map the record and
not the meaning, and that `R&D` and the `Formulation` service share one row.

The old service-identity table is still rendered below, tagged **superseded**.

## 8 · Migrated Filling mapping intact — GREEN

```
PASS  OTC - Filling is present in the destination map · BLD-FILL · ns=14525
PASS  it carries the SAME NetSuite item as the service-identity row it came from
PASS  the mapped internal id resolves in NetSuite · BLD-FILL
```

## 9 · Other Service cannot receive a firm-wide mapping — GREEN

Its row renders `Chosen per line — no firm-wide item` with a `Per line` chip and
**no input and no Save button**. The server action refuses it independently
(`isPerLineDestination` → `ActionGuardError`), so the guard does not depend on
the UI omitting a control.

## Economics across the whole population

Baseline captured on real `main`, branch code verified against it:

```
ok  34 quotes — every governed commercial scalar identical
ok  per-SKU freight attribution conserved
```

Note the committed gate-1b baseline is stale for unrelated reasons — 8 failures
on unmodified `main`, all four affected quotes drafts edited between Jul 15 and
Aug 17. Benign, and deliberately not refreshed inside a feature slice.

## Fixture restored

All three Tooling/Artwork columns cleared on `7d4983a7`. The scenario itself is
retained as certification infrastructure alongside the CERT-300 quote.

## Still in place

#293's Direct Service projection block is untouched — no NetSuite file changed
in this slice.
