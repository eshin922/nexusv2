# V1 → beta remaining-work ledger

**Established 2026-08-14.** This is the single remaining-work ledger for the
V1/beta cutover. It replaces reconstructing the plan from conversation history.

Reconciled against: `main` and current branch code · open PRs · `OPEN_DECISIONS.md`
· validation/certification records · go-live documentation · known deferred items.

---

## 0 · Blocking now — read first

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

## 6 · Production DB reset

| Item | Current state | Remaining action | Blocker | Scope |
|---|---|---|---|---|
| Purge transactional test data | Not started | Backup → dry-run census → explicit destructive authorization → execute | **See the flag below** | beta |
| Preserve master/reference/config | — | Define the preserve set explicitly | — | beta |
| S-7 basket disposition | Open | Retire or re-baseline at Day 0 | §0 | beta |
| Beta Day 0 baseline | Not established | Capture after purge | Purge | beta |

**⚠ HIDDEN PREREQUISITE — dev and prod are ONE Supabase database.** There is no
separate dev instance. "Purge production transactional test data" therefore
purges the data development is currently working against, including every
validation fixture, the S-7 basket, and the certification-evidence quotes. This
needs an explicit decision before the purge is designed: either stand up a
second Supabase project first, or accept that development loses its working data
at Day 0 and sequence the purge after all §1–§4 work is certified.

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
