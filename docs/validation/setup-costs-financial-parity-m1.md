# Setup → Costs → Pricing: M1 financial input repair

Status: **implemented locally; held, not release-ready**. September 18, 2026.

Edward approved the staged plan and instructed continuation. This is its first bounded repair, based on main `5599548999c7b5cbfe61709069fac2669254e71b`. It changes no UI, schema, persisted prices, production data, charge vocabulary or suggestion rules. #596 and #597 are not dependencies of this repair.

## Problem and resulting behavior

A server bundle could correctly include an owned charge in its computed cost while omitting that charge from the inputs sent to the browser. Both client adapters then supplied an empty charge array. An optimistic edit or Pricing preview could therefore drop the charge's cost. The economic fingerprint separately ignored owned charges, recovery elections and Item Group production, so relevant edits could escape stale detection.

The snapshot now carries the exact charge economics and quote freight markup consumed by the server. Initialization, hydrate, reconcile and both adapters retain them. Warnings use the same snapshot adapter rather than a third hand-built input. The existing calculation engine and rates are unchanged.

The shared fingerprint now includes charge identity/owner/tier/cost, elections, group production, legacy testing fees and canonical owner identity. Null/inherited values remain distinct from explicit zero (particularly markup overrides). Pricing's own levers and external client targets remain excluded as before. Collection ordering remains irrelevant.

## Trace and authority

Existing Setup identity → `quote_charge_instances` → Costs tier writer → `quote_charge_instance_tiers` → existing server charge loader → snapshot `componentCharges` → store/adapters → existing engine → stack/preview and economic fingerprint → existing Pricing refusal.

This repairs propagation of operator-entered supplier costs; it does not originate a cost or reclassify a product. Authorities: approved staged audit plan; `NEXUS_IMPLEMENTATION_STANDARD.md` §§1–4; existing charge cost-recognition and Pricing stale-guard contracts. All changed values are commercial inputs. Persistence, copy/revise and frozen records are untouched; full lifecycle/browser acceptance remains part of M1/M7, not certified here. No visual change or deviation from the design bundle is introduced.

## Evidence

- Full unit suite: **3,252 passed, zero failed/skipped** (baseline 3,243 + nine new regression cases).
- `verify:ci`: passed, including application and Gate 1B types, boundaries, governed writers, pricing classifier, NetSuite adapter/isolation and migration index.
- New nine-case suite fails **9/9 against the old adapter/fingerprint**, then passes against the repair. Old source was restored only temporarily in this isolated worktree and replaced with the repaired bytes in `finally`.
- New tests cover four unequal tier amounts; standalone and group-member ownership; unelected, included and separate recovery; optimistic cost and global-adjustment edits; new/old snapshot ordering; charge removal on hydrate; fingerprint sensitivity and order invariance.
- `npm run validation:financial-parity-walk`: passed twice in a dedicated loopback-only database. Real Setup core creates a print-plate charge; real Costs core saves two unequal amounts; real `getCostingBundle` matches both adapters' engine results; editing a fee makes real `applyPricingAdjustments` return `COSTS_STALE`; saved global pricing is unchanged.
- Runtime isolation assertion: all five providers isolated, real credentials absent, loopback database required. Walk deletes its created charge and verifies removal. Audit records remain only in the disposable local clone. Cache revalidation is stubbed by the existing script loader; this is not browser-refresh or notification evidence.

The walk is under `tests/integration` so root TypeScript checks it, but the database-free unit glob does not run it accidentally. The package command explicitly requires `.env.validation.local`.

## Additional gate failure found and diagnosed

`scripts/test-costing.ts` cannot resolve extensionless imports under the merge gate's plain Node command. With the existing loader it runs and reports six assertion failures. The **same six exact results occur on unchanged main application code**:

- required sell 1.104 vs expected 1.134;
- required sell 1.4843 vs expected 1.5143 (two assertions);
- revenue 74,215 vs expected 75,715;
- blended margin 0.2155898403 vs expected 0.23113;
- suggested adjustment 0.21 vs expected 0.19.

Diagnosis: the fixture expected a 30% production markup but configured only Manufacturing and Other. The current governed engine requires the Production category explicitly and correctly refuses that fallback. Adding `Production: 0.3` to this synthetic fixture restores **every original expected value**, with no change to engine arithmetic or any stored rate. `npm run test:costing` now uses the existing TypeScript resolver; the merge-gate invocation and script header point to it. The repaired check passes. Expected values were not changed to obtain green.

## Concurrent Pricing apply: second bounded repair

A controlled real-action test reproduced a second defect: Pricing read the
stale-check basis before opening its write transaction. Holding its eventual
quote update, committing an owned-fee change from 100 to 800, then releasing
the update allowed stale pricing to commit. The original probe recorded
`staleApplyAccepted: true`; the repaired action returns `COSTS_STALE` and
leaves the saved adjustment unchanged.

`lockPricingBasis` now protects the input rows through the read/check/write
transaction. Parent locks also block newly inserted children through existing
foreign keys; existing input rows protect updates and deletes. Shared locks
on the two Settings authorities protect category/rate insertions as well as
updates. Shared Library locks allow different quotes using the same product
to proceed. No schema change or cooperation from an advisory-lock protocol
in existing cost writers is required.

The explicitly scoped database transaction makes existing readers use the
same connection through AsyncLocalStorage. Outside that scope the exported
database uses its existing pool. This prevents three simultaneous applies
from occupying all three connections while waiting for their own readers.
Nested transactions remain savepoints; rollback and connection isolation are
exercised against PostgreSQL. Cache revalidation occurs after commit.

Both intents require the previously saved pricing basis. Apply also requires
the cost fingerprint; Return to baseline intentionally does not. Unsupported
intents are refused. Busy locks time out rather than replaying the operator's
decision, with a readable stale-data refusal. Shared Settings edits may wait
briefly while a Pricing transaction is active; this is an explicit tradeoff.

`npm run validation:pricing-concurrency-walk` passes in the dedicated local
clone, including nine blocked mutations (updates, deletes and inserts), the
original race, two competing applies (one success, one stale refusal), missing
bases, successful return to baseline, busy-quote refusal, nested rollback,
and four other quote scopes draining through a three-connection pool while
the original quote is held. All temporary charges and pricing edits are
restored in `finally`; audit evidence stays in the disposable clone.

The identity inventory gate detected the new lock helper. It is classified
as a canonical input locker, with assembly identity used only for the
existing group worksheet. No check was disabled. Full unit suite after that
classification: **3,252 pass, zero fail/skipped**; `verify:ci` passes.

## Remaining M1 acceptance work

### September 18 follow-up: navigation and mounted Pricing

The blocker descriptions below are the earlier checkpoint, superseded for
VAL-103 and VAL-209 by this follow-up. The rapid-save failure reproduced on
unchanged main as well as this candidate. Opening a Costs drawer rebuilt its
URL with only `section`, dropping `tier`. The tier synchronizer then launched
a competing navigation; both edit handlers reached their Server Action call
but the browser never sent the saves. Opening the complete deep link directly
made the same unchanged save scenario pass.

`CostBuildAccordion` now changes only the section parameter, preserving the
selected tier and other URL state. It still uses shallow history replacement.
With normal drawer clicks restored, VAL-103 passes: both receipts, exact
125/75 database values, two field-specific audits, and reload persistence.
VAL-101 also passes alongside it. No amount, save gesture, or calculation was
changed. The harness checks that opening the module retains the active tier.

The current Pricing shell deliberately removed the old ActionCard targeted
by VAL-209. Its replacement test drives the actual ComplianceGrid floor offer
and proves staging without a write, repeat-click idempotence, discard, one
Apply audit, preservation of unrelated direct prices/tier adjustments, and
reload. Extended mounted acceptance also passes: a persisted cost change
refuses the old page's Apply; a competing lift refuses the old pricing basis;
both leave the competing state and audit count intact. Return to computed
baseline removes pricing levers without touching source costs. The two
competing writes are isolated SQL fixtures, not claims of a second browser
operator journey; real writer/concurrency paths remain covered by the action
walk. All fixture changes are restored in `finally`.

Investigation and validation logs:
`C:/Code/nexus-validation-runs/financial-parity-diagnosis-20260918`.
Final combined browser run: **9 passed**, retries disabled, one worker, hard
outer timeout. It includes all five quote-state deep links, Preview → Send →
Client Review, VAL-101, VAL-103, and the extended VAL-209. `verify:ci` passes;
the full unit suite remains **3,252 passed, zero failed or skipped**.
The retained local clone/server are still a diagnostic environment, not a
claim that the full fresh-environment merge checklist has been completed.

Browser diagnostic run `financial-browser-20260918-0955` uses the dedicated
local clone on port 3101 (3100 belongs to an unrelated process). All five
quote-state deep links pass with strict diagnostics. The real Preview → Send
→ Client Review lifecycle also passes. This is partial acceptance, not a
completed merge gate.

Two existing Costs harness cases are stale: VAL-101 fills a cell but never
blurs/presses Enter before awaiting a save; VAL-103 still expects the removed
debounce and leaves its second cell focused. The production component
explicitly commits on blur/Enter. The first trace shows the typed value still
focused with no POST; the second expects two receipts but gets zero. VAL-101
also targets the retired combined Tooling/artwork input; the current UI has
separate Tooling and Artwork fields. Proposed separate harness-only repair:
exercise the real commit gesture, use the existing separate fields while
preserving their aggregate amount, and retain DB read-back, reload, refusal,
audit and network assertions. Do not change save behavior to satisfy an old
test. Durable traces and logs are under
`C:/Code/nexus-validation-runs/financial-browser-20260918-0955`.

The separate harness-only correction was then exercised. **VAL-101 passes**:
seven current Production fields (including Tooling 5 + Artwork 5 in place of
the same aggregate 10), exact database read-back, reload persistence, negative
input refusal with rollback and no extra audit, and strict browser/network
diagnostics. The legacy combined field remains null.

**VAL-103 remains a blocker.** Explicit Enter on both cells and waiting for
the drawer navigation to settle do not repair it: the two expected save
receipts are absent. Running it alone after reseeding also fails. Therefore
the initial debounce-only explanation was incomplete. Do not classify this
remaining result as a harmless selector issue or claim concurrent browser
editing is certified. Establish the cause on unchanged main and the candidate
before changing the application. The failing test retains both database and
audit assertions; none were relaxed.

**VAL-209 remains a browser acceptance gap.** Its fixture renders the current
Pricing page with an above-floor tier summary and per-tier "Lift all ... to
floor" controls, but not the `.psr-action-card` recommendation CTA the test
expects. It fails before staging/applying. No conclusion about the repaired
Apply action follows from that missing precondition. Reconcile fixture and
current interaction authority, then prove staging, discard, apply-once,
reload, return-to-baseline and old-tab refusal on the mounted surface.

The owned port-3101 server and descendants were stopped after checking process
identity. Run-scoped fixtures were reset; traces/reports were copied outside
the worktree. Automatic approval review rejected generated-directory cleanup
without a specific reason, so the owned generated paths and safe browser env
file remain. Port 3100 and the pre-existing shared validation container were
not touched. The dedicated local database is retained for investigation.
This is diagnostic acceptance evidence, **not a full clean-tree merge-gate
certification**.

1. Concurrent Pricing apply and required-basis checks are covered by the second repair above. This is not a claim that every independent writer elsewhere has received a concurrency audit.
2. Complete mounted/browser acceptance of the existing Pricing caller with the stricter contract, including old-tab refusal and return to baseline.
3. Legacy costing check diagnosis is complete as recorded above. Retain the explicit category in that fixture and the supported resolver invocation.
4. Mounted/browser acceptance for edit/reload, Pricing preview/apply/undo and sent/frozen lifecycles; role/refusal scenarios. All remain required before UI replacement or release.
5. Full merge-gate environment ownership, browser suites and rollback rehearsal. Current source/unit/action evidence is deliberately narrower.

No merge, deployment, migration or production test write is authorized by a passing unit suite. UI implementation remains behind this financial gate.
