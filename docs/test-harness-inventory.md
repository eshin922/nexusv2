# Test harness inventory — as of 2026-08-06

Taken before Gate 1B implementation, at Edward's request: not "the test count
grew" but **what classes of failure are covered, and which of them anything
actually enforces.**

Every number here was measured, not estimated. Method is stated per section so a
later reader can re-run it rather than trust it.

---

## §1 · The headline, stated first

**Two findings dominate this inventory, and both are about enforcement rather
than coverage.**

**1 · There is no CI.** No `.github/workflows`, no git hooks, no third-party
runner. The only automated check on any commit is a Vercel deployment.

```
$ ls .github/workflows      ->  no such directory
$ ls .git/hooks             ->  samples only, none active
$ gh api .../commits/<main>/status
   { "state": "success", "total": 1, "contexts": ["Vercel"] }
```

**2 · `main` has no branch protection.** Nothing is *required* to pass before a
merge.

```
$ gh api repos/eshin922/nexusv2/branches/main/protection
   404 — Branch not protected
```

So the Vercel status is **advisory**. PRs #188 and #189 were merged in this
session while Vercel was still `pending` — that was possible because nothing
prevents it, not because anything approved it.

**297 unit tests, 18 verifiers and 2 preservation baselines currently gate
nothing.** They run when a person runs them.

---

## §2 · What IS enforced automatically

Exactly one chain: `prebuild`, which npm's lifecycle runs before `build`.
Vercel invokes `npm run build` (a `build` script exists; `vercel.json` sets only
`regions`, no command override), so the chain runs on every preview and
production deployment.

| # | Check | Class |
|---|---|---|
| 1 | `verify:boundaries` | customer-view import containment |
| 2 | `verify:react-pdf-containment` | bundle containment |
| 3 | `verify:font-register-coverage` | asset/style coverage |
| 4 | `verify:autosave-focus-stability` | UI invariant (Pattern 47) |
| 5 | `verify:complete-status-writer` | single-writer, lifecycle |
| 6 | `verify:audit-single-writer` | single-writer, provenance |
| 7 | `verify:pricing-classifier-invariants` | pure-function invariants |
| 8 | `test:netsuite-adapter` | adapter contract |

**What that gate can and cannot do.** A failure here fails the *deployment*, not
the *merge*. Broken code can reach `main`; it just cannot reach production.
Given a single shared database that is a narrower protection than it sounds —
a migration applied locally is already in production before any of this runs.

**Confidence note.** That Vercel runs `npm run build` follows from npm lifecycle
semantics plus Vercel's documented Next.js behaviour. I have **not** read a
Vercel build log to observe the verifier output directly, so this is inferred
rather than witnessed. It is the one claim in this document not backed by a
command I ran.

---

## §3 · Unit suite — 297 tests, and what they actually assert

`npm run test:unit` · 55 files · **local only, never automated.**

The governed command is load-bearing: the loader supplies server-contract shims
and native type-stripping preserves ESM. An ad hoc runner produces fabricated
failures — see CLAUDE.md, "Merge and certification evidence must use the
repository-governed test commands."

### Classified by assertion style

| Style | Files | Tests | What it can catch |
|---|---|---|---|
| **Source-shape** — reads a source file and regexes it | 35 | **192** | structure, design-authority fidelity, banned vocabulary, ordering of statements |
| **Behavioural** — imports and executes real code | 10 | **47** | wrong values, wrong branches, wrong edge-case handling |
| **Mixed** | 10 | ~58 | both |

Method: a file counts as source-shape if it calls `readFile`/`readFileSync`, and
behavioural if it imports from `src/`.

### The uncomfortable observation

**Roughly two-thirds of the unit suite asserts on the shape of source code
rather than on behaviour.**

That is the same class of instrument that just failed us: `needForFloor` in
`lines-requiring-review.tsx` is a commercial derivation that no grep shape in the
A-6 sweep matched, and Edward's own directive from that miss was *"do not create
a grep-based enforcement mechanism for independent derivation — source-shape
matching is not a reliable contract."*

This is **not** an argument that those 192 tests are worthless. They catch real
regressions — the freight design-authority suite caught a banned word in a
comment I wrote this session, and the Slice-1 cutover guard caught an
unclassified identity join in a script I added. For *structural* contracts
("this file must not contain X", "this DOM shape must exist"), source-shape is
the correct instrument.

It is an argument that **the suite is weighted toward structural fidelity and
away from computed correctness**, and that the ratio should be read that way
rather than as 297 undifferentiated tests.

---

## §4 · The Gate 1B additions, and why they change the ratio

`tests/unit/costing-unreachable-paths.test.ts` — **11 tests, all behavioural.**
They execute `computeQuoteCosting` over constructed inputs; they read no source
text.

| Behaviour | Tests | Why it could not be covered before |
|---|---|---|
| `override` | 3 | `assembly_leaf_overrides` — **0 rows in the database** |
| `flagged-out` | 2 | `customer_ships_raws` — **0 rows** |
| markup ladder rungs 1-4 | 6 | rung 4 (`FALLBACK_MARKUP`) is **reached by no packaging line in production** |

Three of these pin distinctions that no scalar can express on its own:

- an override of `0` must beat the computed price — `??` is correct, `||` is not
- a line markup of `0` must beat the category default — nullity, not truthiness
- an *excluded* input and an *absent* input both read `0.00`, so the reason has
  to be carried, never inferred from the value

**Each was verified to fail on a real defect** rather than assumed to work:

| Injected fault | Result |
|---|---|
| `FALLBACK_MARKUP` 0.30 → 0.31 | 1 test fails — **the S-7 baseline sees nothing** |
| `customerShipsRaws` ignored | 3 tests fail |

That first row is the point of the addition. The 24-quote preservation baseline
is byte-exact and still completely blind to that constant, because no production
data reaches the rung. Coverage expanded into a region the baseline structurally
cannot see.

**Effect on the ratio:** behavioural tests 36 → 47 (+31%) while total tests grew
297 from 286 (+3.8%). The additions land entirely in the smaller category.

---

## §5 · Preservation baselines — local only

| Baseline | Scope | Digest |
|---|---|---|
| **S-7 costing** | 24 quotes, whole `QuoteCostingResult`, 17 significant digits | `16b5fd27…62ce6e1b` |
| **Audit vocabulary** | 98 `(action, entity_type)` pairs, 98 structural digests, 2,701 rows | `fa0056de…4bddb0` |

Both are byte-exact and both are **manual**. `gate1b:verify-preserved` and the
audit neutrality script are npm scripts nothing invokes.

Both are adversarially tested — see §7 — and both fail on absence as well as on
change: S-7 fails if a baseline quote disappears, so coverage cannot shrink
silently.

**Known hole, printed on every green S-7 run:** `override` and `flagged-out`
cannot be exercised by any quote. §4 closes that hole behaviourally; the baseline
itself still cannot see those paths, and says so rather than letting a pass read
as complete.

---

## §6 · Verifiers not in the chain

**18 of 25 verifier scripts are not in `prebuild`.**

Two are wired as standalone npm scripts (`verify:ri-7-readiness`,
`verify:scenario-quote-invariant`). Sixteen exist on disk with no script entry at
all: `audit-log`, `audit-log-renderer-smoke`, `costing-adapter`,
`firm-settings-invariant`, `phase-1-sales-order-migration-preflight`,
`quote-warnings-readiness`, `r6-2-commit2-sweep`, `r6-2-journal-audit`,
`r6-2-schema`, `realtime-readiness`, `ri-1-schema-readiness`,
`ri-7-backfill-sanity`, `sample-order-margin`, `slice-11-5-1-warnings-parity`,
`slice-8-migrations`, `canonical-repair-digest`.

Most are slice-scoped readiness checks whose slice has shipped — reasonable to
leave dormant. But **the distinction between "retired" and "forgotten" is not
recorded anywhere**, which means nobody can tell which is which without reading
each one. `costing-adapter` and `slice-11-5-1-warnings-parity` in particular
guard the math layer this gate is about.

---

## §7 · Adversarial testing — real, and entirely manual

Every guard added in this and the preceding gate was proven to fail on an
injected defect, because a check that has only ever passed has not been tested:

| Guard | Injected fault | Outcome |
|---|---|---|
| `audit-single-writer` | direct insert in `quotes.ts` | fails, cites `quotes.ts:269` |
| — exception pinning | second insert in the excepted file | fails: "2 direct insert(s), permits exactly 1" |
| — exception staleness | subject converted away | fails: entry is stale |
| `0062` constraints | 5 malformed actor shapes | all rejected by the named constraint |
| — permissiveness | 2 valid shapes | both accepted |
| S-7 baseline | `packagingMarkupSum` × 1.0000001 | 5+ located failures, exit 1 |
| Gate 1B units | `FALLBACK_MARKUP` 0.30 → 0.31 | rung-4 test fails |
| Gate 1B units | `customerShipsRaws` ignored | 3 tests fail |

**None of this is part of the harness.** They were one-off mutations I applied
and reverted by hand. Nothing re-runs them, so the *guards* are regression-tested
while the *proof that the guards work* is not. If someone weakens a verifier's
regex next month, no test notices.

This is the clearest structural gap in the inventory. Mutation testing is the
named remedy; it is not proposed here as work.

---

## §8 · Live integration

| Check | Status |
|---|---|
| Playwright e2e — 10 specs, 18 tests, isolated validation DB | **local only**, needs `validation:db` + `validation:app` running |
| Production operator write | **manual** — performed once this session for Gate 1A step 5 |
| NetSuite / HubSpot smokes — 3 scripts | **manual**, hit live sandboxes |

The e2e harness is real (global setup/teardown, network providers, fixtures) and
runs against an isolated database, so it is safe to automate. It currently isn't.

---

## §9 · Coverage by failure class

| Failure class | Covered by | Enforced? |
|---|---|---|
| Wrong commercial value | S-7 baseline; 47 behavioural unit tests | **no** |
| Value silently drifts in a refactor | S-7 zero-drift | **no** |
| Untestable-by-data edge case | Gate 1B synthetic 11 | **no** |
| Import/bundle boundary violation | 3 prebuild verifiers | **yes** |
| Single-writer bypass | 2 prebuild verifiers | **yes** |
| UI invariant (autosave focus) | 1 prebuild verifier | **yes** |
| Structural/design-authority drift | 192 source-shape tests | **no** |
| Audit provenance shape | DB constraints + audit baseline | **DB yes**, baseline no |
| Ordering / idempotency / causality | ~30 unit tests | **no** |
| End-to-end operator workflow | 18 e2e tests | **no** |
| External integration | 3 smokes | **no** |
| **Guards themselves regressing** | manual mutation only | **no** |

**Enforced classes: 3 of 12.** All three are structural containment — the classes
where a syntactic instrument is the right one. Every class concerning *computed
correctness* is unenforced.

---

## §10 · What this means for Gate 1B

The graph work's highest-risk assumption is **S-7: rollups derive from nodes with
no output change.** The instrument for that risk exists, is byte-exact, is
adversarially tested — and **runs only when someone remembers.**

That is a materially different safety posture from Gate 1A, where the
single-writer guard entered `prebuild` and became structural. It is worth
deciding deliberately whether S-7 should follow it, rather than discovering the
difference after a drift ships.

Three options, none of them free, offered without a recommendation because the
trade is Edward's:

1. **Add `gate1b:verify-preserved` to `prebuild`.** It needs `.env.local` and a
   live database, which prebuild steps currently do not — it would make every
   Vercel build depend on database reachability, and a transient pool error
   would fail a deploy that has nothing wrong with it.
2. **Add CI** — a workflow running `test:unit` and the database-free verifiers
   on push, with branch protection requiring it. This is the change that would
   move the most classes from "no" to "yes" in §9.
3. **Leave it manual and make the obligation explicit** in the Gate 1B
   implementation plan, so it is a named step rather than a habit.

**Nothing here blocks Gate 1B implementation.** It is the record Edward asked
for, and it says plainly that the suite's growth to 297 is not by itself an
increase in enforcement — because enforcement, today, is 8 checks at deploy time
and nothing at merge time.

---

## §11 · UPDATE — 2026-08-06: the minimal gate is live

§1's headline finding is resolved for code correctness. Recorded here rather
than by editing §1, so the before/after stays legible.

**`.github/workflows/verify.yml`** runs on every PR to `main` and every push to
`main`:

| Step | What |
|---|---|
| `npm run test:unit` | the **governed** command — 297 tests |
| `npm run prebuild` | 8 structural verifiers |

First run green on the commit that added it (`138adf6`), and the log confirms
both suites executed rather than passing vacuously: `# tests 297 / # pass 297 /
# fail 0`, then every verifier's OK line.

**Branch protection on `main`:**

```
required_checks     ["verify"]
enforce_admins      true
force_pushes        false
deletions           false
required_reviews    false        (solo maintainer)
strict_up_to_date   false        (avoids re-run churn on a single-author repo)
```

### `enforce_admins: true` is a deliberate choice, and it constrains Edward

Set to `false` initially, then corrected. With `false`, an admin can merge past a
failing or pending required check — and in this workflow the admin token **is**
the one merging. A gate that does not bind the only actor using it does not
implement *"cannot merge while that check is failing or pending"*; it recreates
the advisory Vercel status this exercise exists to replace.

Two consequences to know before they are discovered:

- **Direct pushes to `main` are now blocked**, including Edward's. All changes
  go through a PR. That has been the working pattern anyway.
- **A broken CI blocks every merge**, including the fix for the broken CI. The
  escape hatch is one call, and it should be used knowingly rather than
  reflexively:

  ```
  gh api -X DELETE repos/eshin922/nexusv2/branches/main/protection/enforce_admins
  ```

  Re-enable with `-X POST` on the same path.

### What this does and does not change in §9

Enforced failure classes go from **3 of 12 to 8 of 12**: the three structural
containment classes were already enforced at deploy time and are now enforced at
merge time too, joined by wrong-value, untestable-by-data-edge-case,
structural/design-authority drift, ordering/idempotency/causality, and
single-writer.

Still unenforced, deliberately:

| Class | Why not |
|---|---|
| Value drift in a refactor (S-7) | needs the shared live database — a transient pool error would present as a code regression |
| End-to-end operator workflow | needs the validation database and app running |
| External integration | live sandboxes |
| **Guards themselves regressing** | mutation testing is still manual; this remains the clearest structural gap |

**S-7 stays a named mandatory checkpoint** before and after engine changes, and
is revisited for CI only when it can run against deterministic isolated
fixtures. That is a decision about what a red build should mean, not an
oversight.

### Governance boundary — restated because CI invites the wrong inference

| Protects | Mechanism | Does NOT cover |
|---|---|---|
| `main` | this CI gate | anything about the database |
| The shared database | F-2 migration authorization | whether the code is correct |
| Migration generation | OD-012 | either of the above |

A green CI run says nothing about whether a migration was authorized. An
authorized migration says nothing about whether the code is correct. **None
substitutes for the others**, and the shared dev/prod database means a migration
reaches production before CI ever sees the code that reads it.
