# Production go-live checklist — RELEASE BLOCKERS

Items here are **release-readiness gates, not deferred recommendations.** Each
must be proven with evidence before production go-live.

---

## BLOCKER 1 · Re-enable Nexus HubSpot Accept synchronization

**Status: ACTIVE — suppression is in place for certification.**

During certification, Nexus's Accept-side production HubSpot write is suppressed
at source. This must be reversed before go-live, or **Accept will silently stop
synchronizing to HubSpot in production** and the production HubSpot → NetSuite
workflow will never fire.

### Why the suppression exists

The production HubSpot workflow
**`NETSUITE: Auto create NetSuite sales order from won deal`** is ACTIVE.
Enrollment includes `Deal stage = Won - In production (Sales)` (stage id
`195607084`, pipeline `Sales` / `108896657`). Its first downstream action is
**Create a NetSuite sales order** — in **production** NetSuite.

Nexus certification targets the NetSuite **sandbox** (`7924416_SB2`), while
HubSpot is the **production** portal (`21497798`). A certification Accept that
moved a real deal into that stage would therefore create a **production** sales
order from a sandbox certification run. Restoring the stage afterwards does not
undo it — the workflow has already enrolled and acted. **The trigger must never
fire**, which is why the write is suppressed rather than reversed.

### The mechanism

| | |
|---|---|
| **Flag** | `NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC` |
| **Default** | **unset ⟹ synchronization ENABLED** (fail-safe) |
| **Suppresses** | `updateDealStage`, `updateDealAmount` — deal-property mutation |
| **Preserves** | every read; all Nexus-internal acceptance; sandbox NetSuite; HubSpot product creation |
| **Contract** | `src/lib/config/certification-mode.ts` |
| **Hard boundary** | `src/lib/integrations/hubspot-certification-suppression.ts` |
| **Regressions** | `tests/unit/certification-hubspot-suppression.test.ts` |

### When this gate applies — NOT at beta launch

**Business disposition, 2026-08-25.** `NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC=1` is
set on **Production, Preview and Development** and **remains enabled throughout
beta**. The beta requirement is the opposite of this checklist: Nexus Acceptance
must NOT change the production HubSpot deal stage or trigger the downstream
workflow.

So the evidence below is the **production-handoff** gate, not a beta launch
blocker. It becomes live only when Edward explicitly authorizes Nexus Acceptance
to control HubSpot stage progression. Do not run it against a beta deployment
and read a throw as a release defect — with the flag set, it throws by design.

**Stage and amount are enabled together.** They are inseparable at the API
layer — `hubspot.ts:updateDealStage` puts `dealstage` and `amount` into one
`properties` object for a single `basicApi.update` PATCH — and inseparable by
disposition: no independent stage/amount control is required, and no separate
feature flag or synchronization path is to be created for it. Removing
suppression enables both writes at once.

### Go-live evidence required

- [ ] **1 · Synchronization is enabled.** `NEXUS_SUPPRESS_HUBSPOT_ACCEPT_SYNC`
      is unset (or falsy) in the production environment.
      Programmatic form: `assertHubspotAcceptSyncEnabledForGoLive()` **does not
      throw** against the production env. Evidence must come from the deployed
      environment, not from a local shell.
- [ ] **2 · Accept writes the governed production stage.** A verification Accept
      moves the deal to `firm_settings.hubspot_deal_stage_on_accept`, and the
      `quote_accepted` audit row carries `from_stage_id ≠ to_stage_id` **and no
      `suppressed` key**.
- [ ] **3 · Amount synchronization behaves per the existing contract.** Accept
      writes the tier turnkey amount rounded to 2dp in the same PATCH as the
      stage; Complete's drift patch (`runAmountPatchIfNeeded`) is reachable and
      reports `patched` / `skipped` on its own merits rather than on the flag.
- [ ] **4 · The production HubSpot → NetSuite workflow is expected and
      enabled.** Administrator confirmation that the workflow above is ON and
      that Nexus Accept firing it is the **intended** production behaviour.
- [ ] **5 · Certification-only suppression cannot remain active accidentally.**
      Evidence 1 is asserted in the deployed environment, and no build/deploy
      configuration sets the flag. Because the default is fail-safe, absence of
      the variable is sufficient — but it must be **verified**, not assumed.

### Non-substitutes

Do **not** accept as evidence for item 1: a local `.env` inspection, a code
reading, or "we never set it." The flag is environment-scoped; only the
deployed environment can answer.

---

## BLOCKER 2 - Dispose of `/api/certification-status` before release

**Status: ACTIVE - the endpoint is public and unauthenticated.**

`GET /api/certification-status` was built for the certification proof: it is the
only way to establish suppression state from the runtime serving the UI, which
is why it is public (auth-gating it makes the check unanswerable from the
runtime - the exact failure mode it rules out).

**A certification observability endpoint must not become a permanent production
surface merely because it was useful during validation.** Before release,
explicitly choose ONE and record the choice here:

- [ ] **(a) Remove it.** Delete the route and its middleware public-matcher
      entry. Cleanest if no production need exists.
- [ ] **(b) Restrict it.** Require admin auth, or bind it to a non-public path.
      Note this REMOVES its value as a pre-session runtime probe.
- [ ] **(c) Prove public exposure is intentionally safe.** Document that the
      response contains only a boolean, a fixed banner, a fixed reason, a
      contract path, an env-var NAME (never its value), a pid, and a timestamp
      - no secrets, no configuration values, no customer or deal data. If
      chosen, state explicitly that the pid disclosure is accepted.

Default if undecided at release time: **(a) remove**. Absence is the safe state.

---

## Cross-references

- `docs/validation/hubspot-stage-trigger-finding.md` — the production workflow
  evidence and the standing rule on production deal-stage mutation.
- `docs/validation/netsuite-accounting-review-runbook.md` — the Accounting
  review, which resumes under suppression.
