# V1 → beta remaining-work ledger

**Established 2026-08-14.** This is the single remaining-work ledger for the
V1/beta cutover. It replaces reconstructing the plan from conversation history.

Reconciled against: `main` and current branch code · open PRs · `OPEN_DECISIONS.md`
· validation/certification records · go-live documentation · known deferred items.

---

## 0 · S-7 — RESOLVED 2026-08-14 (kept for the record)

**Current state: green on `84890653…6150a6df`, five consecutive stable runs,
both branches identical, no data mutated to satisfy the verifier.** The second
refresh to `4361217b…` was withdrawn as a torn read — see §0b (S7-1) and OW-11.
Do not refresh to `4361217b…` again.

The original entry follows, because the reasoning that produced the first
authorized refresh is still the reasoning that governs the next one.

## 0a · Blocking then — read first

**S-7 is RED, and it blocks every Preview build.** `prebuild` runs
`verify:s7-preserved`, so #265 and #266 both fail to deploy until this is
dispositioned. This is a prerequisite for all of §1, not a side issue.

```
FAIL 2f29af72 · Smart Pressed Juice — Juice Cleanse Reorder 2026 / Primary
     skuRollups[1].canonicalQuoteLeafId: null -> "fd4adddd-..."
expected 8d4ab825...88577763
current  84890653...6150a6df
```

**No commercial number moved.** The single differing field is a canonical
identity binding. Turnkey, margin and every priced quantity are unchanged — had
one moved, the verifier would list it.

**Cause, from the audit log rather than inference.** Four
`product_membership_moved` events at 16:58–16:59 today, three of them on
`fd4adddd`, which belongs to `2f29af72`. Those are drag/drop moves performed
during the #265 operator walk — on an S-7 basket quote that had been explicitly
retired from mutation, rather than on the provisioned validation fixture.

**Why a reorder moves the digest at all.** `skuRollups` is an INDEXED array and
the baseline is keyed by position. Reordering products changes which leaf sits
at index 1, so the entry at that index differs even though no value did. Same
shape as OW-5. This is now a standing property: **the S-7 digest is
order-sensitive**, and structural reordering of any basket quote will move it
without any money moving.

**Disposition is yours — two clean options, and I have not taken either.**

| | Action | Cost |
|---|---|---|
| A | Refresh the baseline to accept the new order | Accepts a structure change to a retired quote as the new truth |
| B | Restore `2f29af72`'s product order to the baseline | Further mutation of a retired quote, but returns it to evidence state |

Standing rule observed: intent is not inferred from the value, and no baseline
refresh happens without your confirmation.

**Process fix, independent of A/B.** The mutable fixture already exists and was
provisioned for exactly this walk — `ZZ-VALIDATION-drag-drop`,
`ff90d502-28a1-4a11-bbd5-75e1b5b916e8`, non-basket, asserted absent from the
baseline. Pointing drag/drop walks at it prevents recurrence.

---

## 0b · S7-1 — S-7 costing capture is not snapshot-consistent

**Bounded V1 item. Verifier/release-gate reliability, NOT a quote-calculation
defect.** Nothing about how a quote is costed is in question.

`getCostingBundle` composes one logical result from 8+ INDEPENDENT queries with
no shared snapshot. During concurrent writes the verifier can therefore compose
a state that never existed atomically, and report preservation drift that is an
artifact of its own read pattern.

**Demonstrated, not theorised** (2026-08-14): the 18:05 capture produced
`4361217b…` while an operator drag session ran against a different quote in the
shared database. `2f29af72` had no write after 16:59:50; captures before and
after — five runs — all return `84890653…`. The outlier carried large real
inconsistencies (`cost 10000 -> 14000`), not floating-point noise, so it was a
torn read across the bundle rather than a rounding artifact.

**Repair, before the final V1 certification/beta checkpoint:** make S-7's
capture path read through a consistent snapshot — a single transaction at
REPEATABLE READ, or an equivalent proof that every read forming one digest
observes one logical state. **Do not redesign costing**, and do not let this
expand into a broad slice; the capture path is the surface.

**Until S7-1 is repaired — operating rules, in force now:**

1. Do not run baseline captures while active mutation testing is occurring.
2. Characterize any unexpected digest BEFORE refreshing —
   `scripts/gate-1b/confirm-s7-delta.ts`, which now separates float-noise from
   real movement and prints a sample `before -> after` per moved path.
3. Never treat the verifier's first reported difference as an exhaustive
   description of the delta. It reports the first divergence in its walk order,
   which on 2026-08-14 was a 1-ULP difference sitting in front of ~1.4×
   movements.

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| S7-1 | Diagnosed, operating rules in force | Snapshot-consistent capture path | None — scheduled, not blocking | V1, before final checkpoint |

## 1 · Quote-surface closeout

| Item | Current state | Remaining action | Blocker / dependency | Scope |
|---|---|---|---|---|
| #265 drag/drop | Implemented; proxy + persisted-position insertion line shipped; unit 1235/1235, DB ordering 8/8 falsified | Operator acceptance, merge | **§0 S-7** blocks the Preview | V1 |
| #266 Client Send | Implemented; readiness notice replaces the 500 | Read-only presentation check on `2f29af72`, merge | **§0 S-7** blocks the Preview | V1 |
| B-11 pagination | Not started | Library control bar + pagination | — | V1 |
| B-13 Setup guidance | Not started | Guidance copy | — | V1 |
| B-15 physical Type icons | Not started | Selective icons | — | **beta-optional** |
| B-16 Pricing compliance grid | LOGGED (`product-library-operator-walk-findings.md`) | Implement amber/red cell states | Pattern 50 — must read the SAME basis as Next Move | V1 |
| B-17 dark-mode contrast | LOGGED | Investigate shared tokens, fix at token level | Token-level fix reaches unaudited surfaces | V1 |
| Recommended Tier → Pricing | Not started | Move out of Setup | — | V1 |
| Type/status/font consistency | Partial | Sweep | Folds into B-16/B-17 slice | V1 |

## 2 · Step 5 end-to-end operator walk

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| Setup → Costs → Pricing → Send | Not run as one pass | Full lifecycle walk | §1 settled; needs a mutable non-basket quote | V1 |

Walk quotes must be validation quotes. See §0 — this boundary has already been
crossed once and cost a red gate.

## 3 · Accounting / NetSuite category mapping

Contract recorded: `docs/validation/netsuite-accounting-category-mapping.md`.

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| Resolved OTC mappings (13) | Authorized, not started | Governed deterministic projection | None — proceed | V1 |
| Stable internal Item IDs | Not resolved | Resolve, pin projection to ID not display name | In-slice work, not an Accounting handoff | V1 |
| 3 finished-good categories | Explicitly unresolved | Model as unresolved; fail closed on push | Accounting, days | V1 |
| Cartons OTC confirmation | Open | Confirm | Non-blocking | V1 |
| Repeated-category consolidation | Open | Confirm | **May be load-bearing** — decides per-charge map vs per-category aggregation | V1 |
| NetSuite certification | Not started | Certify resulting SO lines against NetSuite | Mapping implemented | V1 |

## 4 · Microsoft OAuth

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| Entra/Clerk production config | Partial; tenant admin-consent granted (§0.5 catch #75) | Finish config | — | V1 |
| DPS employee login | Not proven | Prove | Config | V1 |
| Actor resolution | Not proven | Prove audit actor is the real user | Login | V1 |
| Approver/non-approver authority | Below-floor lifecycle shipped | Prove both roles | Login | V1 |
| Remove temporary auth/bypass | **Not inventoried** | Enumerate and remove | Feeds §5 | V1 |

## 5 · Beta go-live controls

**Not started. No inventory exists.** Required shape:
`control | current state | required beta state | cutover action | verification | rollback`

Known controls to enumerate: HubSpot write token vs read token split · provider
write guards · NetSuite sandbox account/endpoints · feature flags · Slack/email
test destinations · send suppression · bypass credentials · Preview URLs ·
`NEXUS_ISOLATED_TEST` and validation identity paths · `--admin` style bypasses.

## 6 · Beta Day 0 — final development-evidence retirement

**MODEL CORRECTED 2026-08-14.** This is not a "production reset with test data
removed". Dev and prod are ONE Supabase project, so there is no test data that
is separable from working data. The purge is a **final development-evidence
retirement event**, and it intentionally destroys:

- development/test quotes;
- the validation fixtures, including `ZZ-VALIDATION-drag-drop`;
- the current S-7 basket;
- certification-evidence quote records;
- other quote-owned transactional evidence.

Everything V1 has been proving things with goes. That is the point, and it is
why sequencing is the whole design.

### Sequence — no step may precede the one above it

1. Complete ALL V1 engineering and certification. Nothing that still needs an
   S-7 basket or a validation fixture may be outstanding.
2. Archive/export any evidence to retain OUTSIDE the live database — baselines,
   certification records, the walk findings that cite quote ids.
3. Recoverable database backup.
4. Dry-run purge census + explicit purge/preserve inventory.
5. Explicit destructive authorization from Edward. Not implied by this plan.
6. Purge quote/project transactional test state.
7. Verify preserved master/reference/configuration data — Library leaves,
   product types, firm settings, markup defaults, users, NetSuite mappings.
8. Establish the clean Beta Day 0 baseline.
9. Create the MINIMAL beta-safe validation mechanism needed from then on.

**Do not purge while active engineering still depends on validation fixtures or
S-7 evidence.** Step 1 is a gate, not a preamble.

### Standing dependency this creates

OD-023's freeze model (section 11) will need evidence quotes to reason about. If
that work is still open at purge time, it loses its subjects. **Sequence the
purge after OD-023 closes, not merely after "V1 engineering" in the abstract.**

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| Retirement event | Modelled, not scheduled | Steps 1-9 | Section 11 OD-023 must close first | beta |

## 7 · Training / presentation package

Not started: rollout deck · PM/Sales quick guide · Accounting handoff guide ·
approver guide · end-to-end demo · exception guide · beta rules of engagement ·
feedback/issue intake. **beta.**

## 8 · Final pre-beta certification

One broad checkpoint after implementation settles. Not started. **beta.**

## 9 · Two-week production beta

Real orders staged in both processes · commercial reconciliation · NetSuite
reconciliation · defects separated from training issues · critical fixes during
beta. **beta.**

## 10 · Final production cutover

Beta exit criteria satisfied → Nexus becomes the normal quoting workflow. **beta.**

---

## Flags

### Missing from the baseline

1. **OD-023 · Send does not freeze the governed Product Structure — marked
   V1 BLOCKER in `OPEN_DECISIONS.md`, absent from the baseline.** Pattern 52
   freezes 30 columns at send; the product STRUCTURE is not among them. A beta
   that stages real orders and then edits structure post-send would invalidate
   the sent artifact. This belongs in §1 or §2, not the backlog.
2. **OD-021 · Send finalizes but does not deliver.** Nexus assigns a number,
   generates and stores the PDF, and transitions state — it does not send
   anything to the customer. Beta rules of engagement (§7) must state who
   delivers and how, or operators will assume the customer received it.
3. **OD-027 · Product Library authority not enforced downstream — V1.**
4. **Four stale open PRs**, none referenced by the baseline: #182 (titled
   *release blocker* — Setup → Costs inheritance), #180, #94, #63. Each needs
   merge, rebase, or explicit closure; #182's title contradicts its dormancy.
5. **Beta rollback story.** §5 asks for per-control rollback but there is no
   program-level rollback: if beta fails after cutover, what happens to quotes
   authored only in Nexus?
6. **Migration deployment order** for anything shipping during beta — tightening
   migrations need a deployed-writer proof. The 0066 outage is the precedent.

### Already complete — remove from remaining work

- **CI-1** — CLOSED 2026-08-14. Required check now runs `verify:ci`, no shared
  DB secret added.
- **Step 9** — Product Type authority migration closed; 0075 applied.
- **B-14** — canonical Attached state shipped (#264).
- **B-12** — grip shipped; the row register it broke is repaired in #265.
- **Client Send repair** — implemented in #266; only acceptance remains.

### Contradictions between documents

- **§6 "production DB reset" vs the single-database architecture** (above). The
  go-live plan assumes two environments; `CLAUDE.md` documents one.
- **§3 "do not implement from display-name inference" vs a mapping supplied as
  display names.** Not a real conflict — resolving IDs is in-slice work — but
  worth stating so nobody treats the names as the contract.
- **`2f29af72` "retired from mutation" vs its use as the #265 walk quote.**
  Resolved by pointing walks at the validation fixture.

### Should not block beta

- B-15 selective Type icons — presentation refinement.
- CS-1 unresolved-cost category enrichment — the readiness notice already names
  the products; category naming is an improvement on a working surface.
- OBS-1 production artifact identity.
- `leaf_specs.product_type_id` provenance/drop.
- Historical HubSpot spec import, historical deal ingestion, Tertiary catalogue
  cleanup, certification-fixture polish.

**B-17 is the one I would NOT drop from beta** despite being presentation: if
operators run dark mode, unreadable structure on the Setup and Tier tables costs
real time on every quote for two weeks, and it is a token change.


---

# Reconciliation pass — 2026-08-14

Reconciled against `main` after #265 merged, against open PRs,
`OPEN_DECISIONS.md`, and the validation records.

## 11 · OD-023 — Send does not freeze the governed Product Structure

**V1 BLOCKER.** Absent from the original baseline; carried here now.

### Post-Send mutation inventory — MEASURED, not assumed

Guard counts per writer module (`assertDraft` / `assertNotFrozen` /
`requireRevisable`):

| Writer | Guards | Post-Send mutable? |
|---|---|---|
| `actions/assemblies.ts` | `assertDraft` x8 | **No** — create/delete/attach/detach/reorder/move all gated |
| `actions/quote-products.ts` | `assertDraft` x2 | **No** — attach/detach gated |
| `actions/leaf-specs.ts` | **none** | **YES** |
| `actions/assembly-leaf-inputs.ts` | **none** | **YES** |
| `actions/assembly-production-inputs.ts` | **none** | **YES** |
| `actions/costing.ts` | **none** | **YES** |
| `actions/pricing-lifts.ts` | **none** | **YES** |

**This refines OD-023's framing rather than confirming it.** The entry says a
Setup edit between Send and Complete silently changes structure. Structure
itself is in fact gated — every structural action calls `assertDraft`. What is
NOT gated is everything a structural element *contains*: specs, packaging and
production cost inputs, and pricing lifts. So the reachable defect today is not
"the tree changes shape" but "the same tree means something different".

Two live paths to a changed sent quote:

1. **Direct.** Edit specs / cost inputs / lifts on a sent quote. No guard
   refuses it. Complete then re-derives from live values.
2. **Via Revise.** `requireRevisable` returns a sent/accepted quote to draft;
   the structural guards then permit edits; Complete re-derives from live
   structure. This is OD-023's stated mechanism and it is real — but it needs
   the Revise step, which the entry does not mention.

### Smallest coherent freeze/edit-after-send model — PROPOSAL, not built

Consistent with existing versioning/supersession rather than new machinery:

- **Send freezes by SNAPSHOT, not by lock.** Extend `quote_snapshots` to carry
  the governed leaf set and its structure — which leaves, Direct or member, the
  grouping boundary, and the identity downstream projection needs. Complete and
  the customer artifact read the SNAPSHOT. This is the one change OD-023
  actually requires.
- **Editing a sent quote remains possible and produces a VERSION.** That is
  already the supersession model; it needs no invention.
- **`assertNotFrozen` on the five unguarded writers**, so a sent quote cannot be
  edited in place at all — the operator is routed to Revise, which is the
  existing, audited, reversible path.

**Do not begin implementation until lifecycle/version semantics are
reconciled.** Specifically: does Revise supersede (new version row) or reopen in
place, and which does Complete read? That is a business-state decision, and it
decides whether the snapshot is per-version or per-quote.

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| OD-023 | **ARCHITECTURE DISPOSITIONED 2026-08-14** — see §11a | Implement per the plan in §11a | None — decided | **V1 blocker** |

## 11a · OD-023 — architecture dispositioned (2026-08-14)

### Version semantics — SETTLED

> **The live quote row is the mutable working copy. The immutable historical
> version is the sent snapshot.**

Revise keeps the existing supersede + `version_number` bump **on the same quote
row**. No new quote row per revision, and no second revision identity system.

The invariant:

- while a quote is `sent`, that version cannot change;
- the sent snapshot must contain enough governed state to reconstruct exactly
  what the customer saw;
- Revise supersedes that snapshot and returns the working quote to `draft` as
  the next version;
- subsequent edits affect the new working version, never the historical
  snapshot.

**Guard is `assertDraft`, not `assertNotFrozen`.** `assertNotFrozen` passes on
`sent` and therefore cannot express sent-version immutability. `assertDraft` is
already what every structural writer uses, so this adds no new concept.

### Writer inventory — SEMANTIC, per function

Rule applied: *every mutation that can change customer-visible content or
commercial meaning must require draft.* Not inferred from module names.

**Requires `assertDraft` (currently unguarded):**

| Module | Fns | Note |
|---|---|---|
| `leaf-specs.ts` | 2 | spec values reach the addendum |
| `assembly-leaf-inputs.ts` | 3 | packaging cost + per-cell overrides |
| `assembly-production-inputs.ts` | 2 | production cost + policy |
| `costing.ts` | 9 | includes GPA, per-cell overrides, client targets |
| `pricing-lifts.ts` | 1 | lift persistence |
| `pricing-apply.ts` | 3 | applies lifts/prices |
| `bulk-raw.ts` | 1 | raw cost |
| `freight.ts` | 15 | component/tier freight costs |
| `freight-worksheet.ts` | 12 | **per-function sweep done** — 11 of 12 have no guard at all; the twelfth (`updateFreightTracking` region, line ~502) uses `assertNotFrozen`, which permits `sent` and so does not satisfy the invariant either. All twelve need `assertDraft`. |

**Total: 48 write paths across 9 modules.**

**Outside the freeze, with rationale rather than by assumption:**

- `quote-attachments.ts` (3 fns) — **internal PM metadata.** Verified: no
  reference to attachments anywhere in `src/components/pdf/` or
  `customer-view-resolver.ts`. They are not part of the sent artifact and cannot
  alter it. If a future feature attaches a document TO the customer artifact,
  this classification must be revisited — that is the trigger, not the passage
  of time.
- `below-floor-approval-request.ts` / `below-floor-authorization.ts` (4 fns) —
  approval/audit workflow state. It records who authorized a below-floor price;
  it cannot change the price or any customer-visible content. Recording the
  rationale rather than broadening the freeze automatically.
- `firm-settings.ts`, `markup-defaults.ts`, `users.ts` — admin-scoped, already
  `requireAdminAction`, and not quote-scoped. Their values are **pinned into the
  snapshot at Send** (commercial settings pin), so a later admin edit cannot
  reach a sent quote.
- `hubspot-pull.ts`, `leaves.ts`, `projects.ts`, `workspace.ts`,
  `surface-visits.ts`, `pricing-provenance.ts`, `pricing-events.ts`,
  `warnings.ts`, `quote-review-events.ts` — library/master data, navigation
  telemetry, derived reads, or review-log appends. None mutates quote-scoped
  commercial content.

### Snapshot completeness — the actual gap, in one line

`customer-view-resolver.ts` reads `firmSettings`, `quotes`, `quoteTiers`,
`users` — and **`getCostingBundle`**, which is the entire live product,
structure, cost and pricing graph.

`quote_snapshots` today carries commercial terms (`tcs`, `payment_terms`,
`lead_time`, `incoterms`, `days_valid`), prepared-by identity, the three PDF
axes, `pdf_url`, and `accepted_snapshot_json`. It carries **no product content
whatsoever**.

So every customer-visible product fact — which leaves, Direct or member, group
membership and order, quantities, tiers, spec values, computed prices — is
re-derived live on every historical read.

**To capture (extending `quote_snapshots`, not a parallel store):**

- leaf/product set with canonical `quote_leaves.id` identity;
- Direct vs Item Group structure, membership and ordering;
- tiers and quantities;
- spec state the artifact renders;
- computed commercial output the artifact prints (per-tier prices, totals);
- commercial/pricing state already governed by the snapshot (unchanged).

**NOT to capture:** runtime/cache/provider state, realtime subscriptions,
warnings/derived advisory output, navigation telemetry, provenance indices.
These are not part of the customer version.

### Historical readers

Once sent, historical/versioned customer output reads the **snapshot**. It must
not silently recompute an old version from today's working tables. `pdf_url`
already pins the exact file the customer received; the snapshot must make the
same version reconstructible in queryable form.

### Proof obligations — all seven, before this closes

1. Send captures a complete snapshot.
2. All customer/commercial writers refuse while status is `sent`.
3. Historical sent output is semantically stable across a Revise.
4. Revise supersedes the old snapshot and bumps the working version.
5. New edits affect only the new draft version.
6. Re-sending creates the next immutable snapshot.
7. Acceptance/Complete semantics continue to point at the correct sent version.

## 12 · OD-021 — what `Send` actually means

**Measured from `sendQuote`:** it assigns the customer-facing quote number,
snapshots commercial defaults and the prepared-by contact, generates the
customer PDF and persists it to storage, transitions `status='sent'`, and logs a
Client Review entry.

**It delivers nothing to the customer.** No email, no portal, no external
transmission of any kind.

For beta this is **acceptable but must be stated**, because the button's name
implies otherwise and an operator who assumes transmission will not follow up:

- **Who sends it:** the PM, outside Nexus, using the generated PDF.
- **By what channel:** existing email/CRM practice — unchanged by Nexus.
- **What Nexus records:** finalization, not delivery. `sent_at` means "the
  artifact was generated and frozen", not "the customer received it".
- **How the operator knows:** the Send confirmation copy and the beta rules of
  engagement must say delivery remains theirs.

**Do not build email delivery merely because the button is named Send.** If V1
genuinely requires Nexus-managed delivery, that is a separate scoped decision —
not an inference from a label.

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| OD-021 | Behaviour established | Confirmation copy + training/demo/beta materials state delivery ownership | None | V1 (copy) / beta (materials) |

## 13 · OD-027 — Product Library authority not enforced downstream

Open, V1-scoped, and **partially addressed by work already merged**: B-3
established quote-owned specification authority, and B-14 made Attached state
read from canonical `quote_leaves`. What remains is the downstream enforcement
the entry names.

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| OD-027 | Partially addressed by B-3/B-14 | Re-scope against current code, then close or carve | Needs a re-read post-#265 | V1 |

## 14 · Dormant PRs

`original claim | current code state | still reproducible? | V1 blocker? |
disposition`. **A "release blocker" title from 2026-08-05 is not current
authority** — none of these was reproduced before this pass, and none is
dispositioned on its title.

| PR | Original claim | Current code state | Reproducible? | Blocker? | Disposition |
|---|---|---|---|---|---|
| **#182** `fix/setup-costs-inheritance` +917/-40, idle 9 days | Setup to Costs inheritance broken; titled *release blocker* | Costs has since taken the Gate-1B node-graph work, the OD-017 re-key and the 11.5.1 migration. The branch predates all of it. | **UNKNOWN — must be reproduced on current `main` before any merge** | Undetermined | **Reproduce first.** If it reproduces, re-implement against current Costs rather than merging a 917-line branch built on a superseded model. If not, close with the finding recorded. |
| **#180** `release/pr-f-freight-realtime` +489/-8, idle 9 days | Worksheet Freight realtime + store architecture, publication 0036 | `drizzle/manual/0002` already carries `freight_leg_groups` / `freight_legs` in the realtime publication | Publication membership appears already landed; the store-architecture half does not | No | **Split.** Confirm what is already on `main`, carve any genuinely missing store work into the Costs closeout, close the branch. |
| **#94** `hotfix/p0-suggestion-infeasible-copy-and-seed` +15/-6, idle ~7 weeks | `suggestion_infeasible` sublabel copy + sample order T1 bump | `action-zone.tsx` handles `suggestion_infeasible`, and Pattern 50 later introduced `suggestion_manual_only` for the intersection state | Superseded by the Pattern 50 work | No | **Close as superseded.** Re-check the sublabel copy inside the B-16 Pricing slice, which touches that surface anyway. |
| **#63** `docs/slice-11-5-brief-v1` +675/-0, idle ~8 weeks | Slice 11.5 brief v1 | Slice 11.5 and 11.5.1 both shipped; `docs/` carries the 11.5.1 briefs and amendments | Historical | No | **Close.** The slice it briefs is complete; merging a superseded brief would add a document that contradicts what shipped. |

**None is a V1 blocker on current evidence. #182 is the only one that could
become one**, and only if its defect reproduces.

## 15 · Program-level beta rollback

Lightweight by design — this is a two-week beta with real orders staged in BOTH
processes, so the fallback already exists.

**Pause conditions** (any one, for the affected workflow only):

- a commercial number in Nexus disagrees with the existing process and the cause
  is not identified same-day;
- a NetSuite push produces an order Accounting will not accept;
- a quote reaches a customer with wrong content;
- Nexus is unavailable for more than half a working day.

**Fallback:** the existing production process continues throughout — nothing is
switched off during beta, which is what makes the rollback cheap. Pausing means
"stop staging new orders in Nexus for that workflow", not "recover data".

**Partially-created records:** a Nexus quote with no NetSuite SO is abandoned in
place (draft, no external effect). A quote WITH a pushed SO is reconciled
manually in NetSuite and the Nexus quote annotated — never silently deleted,
because the SO is real.

**Who calls it:** Edward pauses and resumes. Not a per-operator judgement, so one
workflow's trouble does not quietly become a general stop.

**Resuming:** re-run the commercial and NetSuite reconciliation for the paused
workflow before staging new orders in it.

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| Rollback | Defined here | Fold into the beta rules of engagement (section 7) | None | beta |

## 16 · Classification updates — applied

**Already complete, removed from remaining work:** CI-1 · Step 9 · B-12 · B-14 ·
Client Send engineering repair (#266 — operator acceptance still outstanding) ·
**#265 drag/drop (MERGED 2026-08-14)**.

**Not blocking beta:** B-15 Product Type icons · CS-1 · OBS-1 ·
`leaf_specs.product_type_id` provenance · historical imports.

**B-17 STAYS in the V1 presentation closeout** — dark-mode structural
readability affects normal operator use and is low-cost.

### Presentation closeout — consolidated contents

One slice, no standalone deploys:

- **B-11** pagination / control bar
- **B-13** Setup guidance
- **B-16** Pricing grid floor/target visualization (Pattern 50 — same basis as
  Next Move)
- **B-17** dark-mode structural contrast (token-level, then sweep representative
  surfaces for over-contrast)
- **Recommended Tier** — move out of Setup to Pricing
- **Remove per-Item-Group `+ Add products`** — SUPERSEDES the earlier
  "keep for V1" disposition. Top-level `+ Add Product` remains the
  discovery/attach entry point, its destination selector already supports
  attaching straight into an Item Group, and drag/drop now restructures
  already-attached products. The per-group action is duplicate chrome.
- remaining Type/status/font/presentation consistency

**Drag/drop is DONE for V1.** No further polish before beta unless a new blocker
appears.
