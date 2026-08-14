# S-7 preservation baseline refresh — 2026-08-13

Authorized refresh. **Not an anonymous full-baseline recapture** — every changed
entry is classified below, and the two causes are recorded separately because
they mean different things.

```
entries          24 → 30
changed digests  23
new quotes        7
globalDigest     541a75a041dd1a29… → fc89ad0fc3c1898c…
```

---

## Cause 1 — OD-017 identity refresh · IDENTITY-ONLY · 21 quotes

`skuRollups[].skuId` moved from legacy **assembly-leaf** UUIDs to canonical
**quote-leaf** UUIDs, following the OD-017 re-key.

**No monetary value moved.** Verified positively, not assumed: for all 21, every
`(totalRevenue, totalCost)` pair on every tier is byte-identical between the old
and new baselines. Only the identity strings differ.

<details><summary>The 21 quotes</summary>

`071486be` `0d76e2eb` `180e6410` `27581262` `2de1dd81` `2f29af72` `54c38f67`
`600dd15c` `93a5d4bb` `9cff9b26` `9de0a19d` `bd95c0f2` `bfc6eebe` `d73b9f11`
`da56da37` `e23f0e2c` `e33d0f54` `e4b25292` `f84334bd` `f88c22e3` `f9c23c2f`

</details>

This is the expected, already-dispositioned consequence of a governed identity
change. It is **not** a commercial correction.

---

## Cause 2 — fixture content changed after capture · 2 quotes

**The preserved fixtures themselves changed. This is not a costing correction —
no pre-existing per-unit commercial value moved in either case.**

### `a264a755` · MISTR — Sachet Rollstock Test Roll / `smoke-matrix-pure-cluster1-0727`

```
tier[0]  revenue  500.019 → 5307.894   (+4807.875)
         cost         300 →     2800   (+2500)
         margin   40.002% →  47.248%
tier[1]  revenue 1733.399 → 15580.079
         cost        1040 →     8240
```

**Evidence.** Baseline captured **2026-08-09** (`caa0e20`), recording `skus: 2`,
`status: draft`. A **second Finished Product** — assembly `5501fb27`,
`ASY-071486be-2` — was created **2026-08-11 20:49**, after capture. The quote was
updated 20:54 and is now `sent`.

The added rollup contributes **exactly** `revenue 4807.875` and `cost 2500`:

```
500.019 + 4807.875 = 5307.894   ✓ exact
    300 +     2500 =     2800   ✓ exact
```

Those two additions explain the entire margin movement. Nothing pre-existing
moved.

### `fa74cbe5` · SMOKE-CB-DELETE-ME-2026-07-28T03-59-50 / `SMOKE`

```
tier[0]  revenue  4733.55 → 6705.8625   (+1972.3125)
         cost        3000 →      4250   (+1250)
tier[1]  revenue 15778.50 → 22878.825
         cost       10000 →     14500
```

**Same cause, same window.** Assembly `a73234da` dates from 2026-07-28; a second,
`5d8f98c5` / `ASY-SMOKE-CB-2`, was created **2026-08-11 20:07**. Quote updated
20:15, now `accepted`.

---

## Correction to the earlier report

The first diagnosis stated **one** material commercial movement. That was wrong:
there are **two**. The initial reading truncated the verifier output at 40 lines
and drew a conclusion from a partial view; the full pre-refresh failure set is
**23**, and `fa74cbe5` sorts past the truncation point.

Recorded because the error is instructive, not incidental: it is the same shape
as the census that could not match numeric differences and the `catch` that
reported "missing" for a read failure — **a conclusion drawn from an instrument
that could not show the whole population.** A truncated list is a filter, and a
filter that cannot express the rest of the set cannot support "only one".

Both movements have the same cause and the same disposition, so the conclusion
does not change. The confidence in it was unearned until this check.

---

## Cause 3 — new since previous baseline · 7 quotes

Not refreshes; these had no prior entry. Four are this programme's Accounting
artifacts, three are earlier OD-004 certification quotes.

`663b4dc2` `7bba3cdd` `89688023` `9af5fe52` `c3c951c7` `f544128a` `f5f5ac14`

---

## Governance note — shared fixtures in preservation evidence

> **A fixture included in preservation evidence must not be materially edited
> without either updating its preservation record with an explicit reason, or
> replacing it with a new fixture.**

Both content changes above were legitimate test-data edits. Because neither was
recorded, they became an **unexplained permanent release failure**: the Vercel
deployment has been red since `788305c`, and the cause looked like a costing
regression until traced. That is the cost this rule prevents — not the edit
itself, which was fine, but the silence around it.

Deliberately not a new governance system. One process rule.

---

## Superseded 2026-08-14 by two further authorized refreshes

The baseline recorded above (**30 entries · `fc89ad0f…`**) was superseded on the
`release/v1-spec-compliance-audit` branch before the merge to main. Recorded
here because the merge presented a conflict in the baseline files and the
resolution is a preservation-gate decision, not a mechanical one.

**Current baseline: 33 entries · `22264ba2919d0908debff2efe799e93a46f3abb44b6df3db04cde860f13dc0e8`.**

### What differs, and why

| | |
|---|---|
| shared quotes | **30** — main's set is a strict subset; `only_theirs = 0` |
| digests differing on shared quotes | **2** |
| quotes present only in the newer baseline | **3** |

The two differing digests are exactly the two **individually authorized,
isolation-evidenced** controlled refreshes performed during the Product Library
operator walk:

- `600dd15c` · Epicuren — Pro Mask Boosters / Alt 5 — the ordering-only delta.
- `2f29af72` · Smart Pressed Juice — Juice Cleanse Reorder 2026 / Primary — the
  operator-walk delta, after which the quote was retired from further mutation.

The three additional quotes (`a4c36959`, `ad6f7513`, `d6a3ba17`) joined the
basket by the standing rule — structure-bearing quotes outside the
`ZZ-VALIDATION-` namespace — because they exist in the shared database.

### How the conflict was settled

**Empirically, not by argument.** `verify:s7-preserved` was run against BOTH
baselines on the same live database:

```
main   (30 · fc89ad0f)  EXIT=1  FAIL 2f29af72 · FAIL 600dd15c
branch (33 · 22264ba2)  EXIT=0  ok 33 quotes — every captured scalar identical
```

Main's baseline no longer describes the database: it fails on precisely the two
quotes whose refreshes were authorized after it was captured. The newer baseline
is therefore the correct one, and taking it loses none of main's coverage.

### Flagged, not absorbed

The three added quotes are labelled **`CERT-MIXED-DELETE-ME-2026-08-13…`**. They
are certification fixtures whose names announce that they are meant to be
deleted, and the basket rule admitted them automatically. **If they are deleted,
S-7 will fail on missing entries until the baseline is refreshed again.** That is
a property of the basket predicate rather than of this merge, so it is recorded
rather than quietly worked around — but it should be dispositioned before the
fixtures are cleaned up.
