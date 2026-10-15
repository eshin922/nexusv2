# CERT-ENV-1 — deployed certification runtimes do not suppress HubSpot writes

**Status:** OPEN (environment-scope / control defect)
**Found:** 2026-08-13, during the Accounting Unit Cost certification tail
**Class:** certification-environment control. **NOT** a defect in any Nexus
feature, and specifically **not** a defect in the Accounting Unit Cost repair
(`20da735`), which this finding neither implicates nor depends on.

---

## The finding

`NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC=1` exists **only in `.env.local`**. It has
never been set in any Vercel environment. Both deployed runtimes were
interrogated from inside the serving process and both report suppression OFF:

| Runtime | URL | `hubspotAcceptSync` | `flagSuppressed` | `providerSuppressed` |
|---|---|---|---|---|
| Preview (`5ede143`) | `nexusv2-f7ugm7pk7-…` | `ENABLED` | `false` | `false` |
| Production (`e97011c`) | `nexusv2-nu.vercel.app` | `ENABLED` | `false` | `false` |

**Therefore every prior suppression proof applies to a LOCAL certification
runtime only, and must not be generalized to preview or production.** Prior
certification records asserting suppression were true of the process that ran
them and false of every deployed one. Any future claim of suppression must name
the runtime it was measured on.

The fail-safe default did its job exactly as designed — absent env degrades
toward production-correct behaviour, never toward a silently disabled
integration. Nothing malfunctioned. The gap is that the flag was never carried
into the deployed scopes, and local-only runs never had cause to notice.

## Why it was caught

`/api/certification-status` exists precisely because "intended deployment
configuration" is an inference about a process, not a measurement of it. Its own
header predicted this failure mode: *"a deploy that never picked up the env."*
The endpoint was queried as a gate before a Complete, and it answered.

The check was cheap and it was load-bearing. It should stay a mandatory gate
before **any** certification action on **any** runtime — not an optional
confirmation once things "look right".

## The exposure this blocked

`markComplete` STEP 10 (`runAmountPatchIfNeeded`) is the **second** production
HubSpot write in the certification path — its in-code comment says so. Against
the preserved fixture `fa74cbe5`, unsuppressed, it computes:

| | |
|---|---|
| prior — latest `quote_accepted` audit row | **15,778.50** |
| current — expected total revenue | **22,878.825** |
| delta | **7,100.325**, far past the `0.01` gate |

→ `hubspot.updateDealAmount("63198467934", …)` against the **real production
deal**, via `HUBSPOT_WRITE_ACCESS_TOKEN`. Deal `63198467934` sits at
*Won - In production*, the enrolling stage for the workflow that creates a
**production** NetSuite Sales Order.

So the exposure was **live and computable, not latent** — and it was equally
live on production. Choosing the preview runtime did not create the risk and
would not have avoided it.

## Disposition

Authorized 2026-08-13: set `NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC=1` for the Vercel
**Preview environment only**.

> **SUPERSEDED 2026-08-25 — the asymmetry below no longer holds.** Business
> disposition: `NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC=1` is set on **Production,
> Preview and Development**, and **remains enabled throughout beta**. During
> beta, Nexus Acceptance must not change the production HubSpot deal stage or
> trigger the downstream workflow. Removing the flag is **not** a beta launch
> requirement; it is a later production-integration decision, taken when Edward
> explicitly authorizes Nexus Acceptance to control HubSpot stage progression.
> Development carries it so `vercel env pull` cannot silently re-arm local
> Acceptance against the production deal.

The original disposition read: *"Production must NOT carry this flag… The two
scopes are deliberately not symmetric: Preview suppressed, Production enabled."*
It is retained as the record of what was decided on 2026-08-13.

Configuring Preview closes the immediate block. **It does not close this
finding.** CERT-ENV-1 stays open as a release/certification-environment record
because the false generalization already happened once, and the corrected
configuration is invisible in any artifact produced before it.

## Companion gate — provider target on the deployed runtime (OPEN)

Same class, same runtime, not yet answered: **which NetSuite account does the
Preview runtime authenticate against?**

`.env.local` holds sandbox `7924416_SB2`, but that is one machine's value and
generalizing it to a deployed runtime is the exact error above. **No runtime
probe can answer it** — no endpoint exposes the account, and
`loadSalesOrderPreflight` is DB-only ("2 indexed DB reads"), so no UI path makes
a NetSuite call without also writing. The value must be read from the Vercel
Preview environment scope:

- `NETSUITE_ACCOUNT_ID` — expected to end `_SB2`
- `NETSUITE_ENV` — whether set, and to what

**Partial structural protection exists.** `assertWriteAuthorized`
(`src/lib/netsuite/client.ts`) refuses every non-GET when the account resolves
to production, and `allowProduction` is never populated from env — so a
production account **alone** fails closed. This is a genuinely better posture
than the HubSpot flag had, whose fail-safe pointed toward production writes.

**It has one hole.** `env` is `process.env.NETSUITE_ENV ?? inferEnv(accountId)`.
An explicit `NETSUITE_ENV=sandbox` on a production account overrides the
inference and re-opens the write. Since setting `NETSUITE_ENV=sandbox`
everywhere is a natural thing to have done, the guard cannot be assumed to hold
without reading both values.

**No NetSuite write may occur on any deployed runtime until both are recorded
here.**

## Standing rules this establishes

1. **Suppression is a property of a process, never of a repository or a
   dashboard.** Prove it from the runtime that will perform the action,
   immediately before the action.
2. **A certification record must name its runtime.** "Suppression was on" is not
   a claim about the system; it is a claim about one process.
3. **Preview and Production env scopes are independent.** A variable set in one
   is absent in the other. Neither implies the other.
4. **A local-only guard is not a deployed guard.** `.env.local` protects exactly
   one machine.

## Cross-references

- `src/lib/config/certification-mode.ts` — the contract, its narrow scope, and
  the fail-safe default that behaved correctly here.
- `src/app/api/certification-status/route.ts` — the runtime probe.
- `src/lib/netsuite/mark-complete.ts` STEP 10 — the second production write.
- Pattern 56 ("latency margins hide missing ordering contracts") — same family:
  a guarantee that appeared to hold because nothing had yet been in a position
  to test it.
- "Exact reconciliation is necessary but not sufficient" — same discipline:
  a green signal measured with an instrument that cannot express the failure.
