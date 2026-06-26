# CC Comm — §0.5 Catch-Shape Milestone (75 catches)

**Trigger:** §0.5 ledger reached 75 catches at 2026-06-25 with the MS
OAuth tenant-consent catch (#75). Pattern 22 milestone marker
protocol fires; this comm formalizes the dominant catch-shape
analysis + proposes a brief-template bias correction.

**Status:** Analytical deliverable preceding Slice 11 audit
pre-brief inventory. CA + Edward review the dominant-class framing
+ bias-correction proposal before the inventory work shapes its
platform-constraint sweep accordingly.

---

## TL;DR

| | |
|---|---|
| **Dominant class** | Class A — silently-failing platform constraint discovery |
| **Reference catches** | #69 pooler dual-budget · #72 Realtime channel cap · #75 MS Entra admin-consent policy |
| **Proposed bias correction** | New `§0.5.5 — Platform constraint enumeration` step in slice brief template |
| **Banked into CLAUDE.md** | 75-catch milestone subsection (alongside §0.5 ledger) |

---

## Three classes account for the recent ledger

The Pattern 22 extension framing (DB schema + module boundaries +
CSS namespace + API contracts + token coverage) catalogues
verification *targets*. The dominant failure mode across those
targets clusters into a different taxonomy when you read the recent
ledger end-to-end.

### Class A — Infrastructure constraint discovery

Catches: **#69 · #72 · #75** (3 of the last 7)

| # | Catch | Discovery shape |
|---|---|---|
| 69 | Supabase pooler dual-budget (pool_size vs PG max_connections) | Surfaced via EMAXCONNSESSION the day after session-mode switch. Both budgets are independent; the audit only measured one. |
| 72 | Supabase Realtime 10-binding-per-channel cap (undocumented) | Surfaced via MIG-8 walk failure. Channel silently failed past the threshold; no error log, no metric. |
| 75 | Microsoft Entra single-tenant admin-consent policy | User-level sign-in blocked silently until admin consent grant landed. Standard OAuth scope grant succeeded at app config time. |

**Common shape:** an external platform constraint that ISN'T visible
in standard observability. No error log, no metric alert, no
explicit rejection at config time. The failure materializes only
when expected behavior breaks at runtime.

Standard tooling misses it: `pg_stat_activity` doesn't show pgbouncer
queue saturation; Supabase docs don't enumerate channel binding
caps; OAuth scope grants succeed at app config but block silently
at sign-in.

### Class B — Process discipline (audit-coverage gaps)

Catches: **#70 · #71 · #73** (+2 carryover from earlier slices) = 5 of recent

| # | Catch | Audit-gap shape |
|---|---|---|
| 70 | Cross-consumer migration audit gap | Slice 11.5 audit covered queries + writes; missed realtime + publication membership |
| 71 | Brief function categorization vs reality | Preserve-listed functions had OLD-table fan-out hidden in their bodies; categorization was by name, not by body |
| 73 | Pattern 70 cross-consumer audit gap #2 | Raw SQL in `src/lib/nav/home-queries.ts` + `workspace-queries.ts` was outside the migration audit's sweep |

**Common shape:** a verification step exists but its scope DOESN'T
cover the actual fail surface. The bias is "we already have an
audit pattern for this concern" → false confidence → the actual
fail surface escapes.

### Class C — Code architecture / hydration discipline

Catches: **#74** (1 of recent)

| # | Catch | Architectural shape |
|---|---|---|
| 74 | RSC snapshot prop vs Zustand store derivation | Client component rendered from frozen prop while sibling code paths rendered from live store; diverged silently in cross-tab scenarios |

**Common shape:** subtle architectural drift between two
data-source paths in the same component tree. Both work in
isolation; diverge only under specific conditions (cross-tab
edits, race timing, snapshot vs stream). Surfaces via end-to-end
walk, not unit-level verification.

### Background — the remaining ~67 catches

The full §0.5 cohort (notation errors, missing columns, FK shape
mismatches, etc.) still dominates by absolute count but is decreasing
in relative frequency as briefs get more architecturally explicit.
Class A + B + C are the recent cluster surfacing fastest.

---

## Why Class A dominates the recent cluster

Three observations:

1. **Slices 11.5 / 11.5.1 hit unusually many platform layers.**
   Schema migration → publication membership → realtime subscriptions
   → pgbouncer pooling → OAuth identity. Each layer has its own
   constraint surface. Slice 11.5.1 was uniquely "infrastructure
   adjacent" relative to feature-focused slices.

2. **Brief §0.5 verification targets code, not platform.** The
   current §0.5 gate verifies DB schema, code architecture, CSS
   namespace, API contracts, token coverage. All five live in
   nexus's own code. Platform constraints live OUTSIDE the
   repo — in Supabase config, Vercel function settings, OAuth
   provider policies. The current §0.5 sweep cannot discover them.

3. **Platform constraints aren't catchable by static analysis or
   typecheck.** Even a thorough brief audit doesn't catch an
   undocumented Supabase Realtime cap or a tenant-admin OAuth
   consent policy. Discovery requires either prior experience
   ("we hit this in a past slice") or active investigation
   ("what's the rate limit on this API?").

The combination produces a structural blind spot: the brief gate
catches what it's designed to catch (code architecture), and
platform constraints sneak through.

---

## Proposed bias correction — `§0.5.5 — Platform constraint enumeration`

**New brief gate to add to the template, after §0.5 code
architecture verification, before §1 scope:**

```markdown
## §0.5.5 — Platform constraint enumeration

For every external platform this slice touches, enumerate:

- **Platform name** (Supabase, Vercel, OAuth provider, etc.)
- **Surface touched** (which configuration, API, or quota
  the slice exercises)
- **KNOWN constraints** (from CLAUDE.md banked entries +
  prior experience; cite the specific section)
- **UNKNOWN constraints to investigate pre-build** (specific
  questions to answer; one line per question)

Investigation artifacts can be brief — a one-line answer per
question is sufficient. The enumeration forces the discovery
to be pre-build, not mid-build.

If a question turns out to require an actual experiment (run
a probe, hit the API, walk a fail mode), bank as a §0.5.5
spike before §0 migration work begins.
```

**Example application (Slice 11.5.1 retroactive):**

| Platform | Surface | KNOWN constraints | UNKNOWN to investigate |
|---|---|---|---|
| Supabase pooler | session-mode `:5432` | PG `max_connections=60` (Pro+Small); session-mode default `pool_size=15` (CLAUDE.md "Supabase pooler dual-budget gotcha") | Confirmed v1 warm-instance count × postgres-js max fits under `pool_size`? Required dashboard read. |
| Supabase Realtime | `postgres_changes` subscription | 10 bindings per channel (CLAUDE.md "Supabase Realtime — 10 postgres_changes bindings"). Multi-channel pattern for higher counts. | Slice 11.5.1's binding count → 13 (NEW model + bonus catches). Split into 2 channels per quote? |
| Supabase Realtime | publication membership | Drop on dropped tables before `DROP TABLE` (Postgres rejects DROP while in publication) | Sequencing: publication DROP OLD → archive snapshot → schema DROP. |

If this enumeration had been in Slice 11.5.1's §0.5.5, two of the
three Class A catches (#72 channel cap discovery + #75 admin-
consent policy if MS OAuth was in scope) would have surfaced
pre-build instead of mid-build.

**The third catch (#69 pooler dual-budget)** wouldn't have been
caught by enumeration alone — that one's discovery shape is
"a constraint we didn't know existed AT ALL." Class A's bias
correction won't eliminate every catch, but it materially shifts
the discovery to pre-build for catches where the constraint is
*knowable* via investigation.

---

## Adoption recommendation

**Adopt `§0.5.5` in Slice 11 audit brief.** This is the next
substantive slice; it's also the largest-surface slice remaining
(per CA's pre-brief inventory comm), so it's the highest-value
candidate for the bias correction's first run.

Inventory work begins immediately after this milestone analysis.
The platform-constraint enumeration for Slice 11 audit's
surfaces will be one of the inventory tracks (PDF generation
library memory/time limits, email-send rate limits, snapshot
storage, etc.).

If §0.5.5 catches one or more constraints during the inventory
+ brief authoring cycle, the bias correction is paying
dividends from day one.

---

## Banked into CLAUDE.md

The 75-catch milestone subsection lands in CLAUDE.md alongside
the §0.5 ledger (this PR). It captures:

1. The MS OAuth #75 catch entry
2. The three-class framing (A infrastructure / B audit-coverage /
   C architecture-drift)
3. The Class A dominant-pattern observation
4. The proposed §0.5.5 enumeration step
5. Next milestone: 100 catches; re-run distribution analysis

---

## Standing by

CC:
- Slice 11 audit pre-brief inventory work (next)
- Apply §0.5.5 platform-constraint enumeration to the inventory
  surface-by-surface

CA:
- Review the dominant-class framing
- Sign off on `§0.5.5` brief template addition for Slice 11
  audit brief authoring

Edward:
- Confirm `§0.5.5` adoption for Slice 11 audit brief

§0.5 ledger at **75 / 15 slices**. Next milestone: 100.
