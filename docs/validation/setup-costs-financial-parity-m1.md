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

## Remaining M1 acceptance work

1. Reproduce and address concurrent writes between Pricing's stale read and commit; no concurrency guarantee is claimed here.
2. Decide/enforce the reachable optional-baseline contract after caller inventory. The application caller supplies an authority baseline; economic baseline may intentionally be null for return-to-baseline. This repair does not silently change that behavior.
3. Legacy costing check diagnosis is complete as recorded above. Retain the explicit category in that fixture and the supported resolver invocation.
4. Mounted/browser acceptance for edit/reload, Pricing preview/apply/undo and sent/frozen lifecycles; role/refusal scenarios. All remain required before UI replacement or release.
5. Full merge-gate environment ownership, browser suites and rollback rehearsal. Current source/unit/action evidence is deliberately narrower.

No merge, deployment, migration or production test write is authorized by a passing unit suite. UI implementation remains behind this financial gate.
