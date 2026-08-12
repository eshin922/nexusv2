# HubSpot stage transition triggers production automation — V1 BLOCKER

> ## STANDING RULE
>
> **Nexus testing/certification must not mutate the stage of a real deal in
> production HubSpot, even temporarily.**
>
> **Restoration of stage/amount is not an isolation mechanism.**

**All Accept operations against real HubSpot deals: STOPPED.** No mutation
performed in this investigation. Nothing deleted, nothing repaired.

---

## 1 · Environment isolation — the root finding

| system | environment | isolated? |
|---|---|---|
| **NetSuite** | `7924416_SB2` — sandbox | **YES** |
| **HubSpot** | production portal `21497798` | **NO** |

`HUBSPOT_ACCESS_TOKEN` (read) and `HUBSPOT_WRITE_ACCESS_TOKEN` (write) are both
set, and both address the **production** portal — the same portal the app's own
"View deal in HubSpot" links point at
(`app.hubspot.com/contacts/21497798/deal/…`).

**Nexus certification runs against a sandboxed NetSuite and a production CRM.**
Everything downstream of HubSpot is therefore outside the sandbox boundary,
and a stage write is a production event no matter which NetSuite account Nexus
itself targets.

The two-token split (`HUBSPOT_ACCESS_TOKEN` read-only, `HUBSPOT_WRITE_ACCESS_TOKEN`
write) was designed to make accidental writes structurally impossible. It does
that. It does **not** make an *intended* write safe, because it never contemplated
the write itself being a production trigger.

---

## 2 · Why capture/restore does not cover this

The certification model was:

```
capture stage+amount → Accept (writes stage) → restore stage+amount → verify
```

That restores **field state**. A stage transition that fires downstream
automation has already fired by the time restoration runs. Restoring the field
afterwards makes the CRM record look untouched while leaving every triggered
artifact in place — which is worse than an obvious failure, because the evidence
of the trigger is erased from the record that would show it.

**The Order A and Order B recovery harnesses are hereby marked
assumption-superseded.** They correctly protect CRM field restoration and remain
valid evidence/tooling for that. They are **not** authorization to Accept a real
deal, and their guarantees must not be read as covering stage-triggered side
effects.

---

## 3 · Real-deal transition inventory

Every `quote_accepted` / `quote_completed` audit row, joined to its deal.
**Nexus wrote the accept-stage to the production portal in every case.**

### Real commercial deals — production trigger exposure

| deal | name | accepted (UTC) | sandbox SO |
|---|---|---|---|
| `58332160883` | Nemah — 30ml Nipple and Lip Balm Jar | 2026-08-12 00:45, 01:31, 01:44 · completed 01:48 | SO2701 |
| `55307858178` | Ro — GLP-1 Epson Proofs | 2026-08-12 04:57 | SO2703 |
| `39286873728` | Pattern Beauty — All Over Body Balm | 2026-08-12 05:46 · completed 05:47 | SO2704 |
| `61113554855` | MISTR — Sachet Rollstock Test Roll | 2026-08-11 20:58 | none |

**Nemah was accepted three times**; Ro once; Pattern Beauty once. Each accept is
a separate stage write and therefore a separate potential trigger.

### Synthetic SMOKE-* deals (still real HubSpot records in the production portal)

`63198467934` (×4 · 2026-07-28 → 2026-08-11), `63235924086`, `63252890041`
(×3 · completed, SO2698).

These are labelled `DELETE-ME` / `SMOKE`, but they are **real deals in the
production portal**, so their stage transitions carry the same trigger exposure
as commercial ones.

Seven `quote_accepted` rows could not be joined to a quote (deleted fixture
rows). Their deals are unresolved from the audit trail alone.

**`captured_from_stage` is NULL on every row** — `pending_hubspot_from_stage_id`
was not populated for these, so Nexus's own durable record of the pre-write
stage is unavailable. **The pre-certification stage for these transitions cannot
be recovered from Nexus.** HubSpot's own property history is the only remaining
source.

---

## 4 · SO2655 causal trace

```
SuiteQL, sandbox 7924416_SB2:
  SELECT … WHERE type='SalesOrd' AND tranid='SO2655'   →  NO ROWS
```

**SO2655 does not exist in the NetSuite sandbox.**

Sandbox SOs on the certification deals are exactly one each, all Nexus-created:

```
55307858178 → SO2703 (B) 8/11/2026
58332160883 → SO2701 (B) 8/11/2026
39286873728 → SO2704 (B) 8/11/2026
63252890041 → SO2698 (B) 7/29/2026
```

So SO2655, if it exists, is **not in the environment Nexus writes to** — which
means Nexus's SO push cannot have created it. That is consistent with, and
supporting evidence for, the hypothesis that it was created by **production
automation triggered by the HubSpot stage change**, and it explains the
`$0.00 / OTC-0001` shape: that is not a Nexus payload, and Nexus never emits it.

**Causality is NOT established here, and must not be asserted yet.** What is
established:

- Nexus did not create SO2655 in the sandbox (no such record).
- No `netsuite_so_pushes` row claims SO2655.
- Nexus wrote a production HubSpot stage change on deal `55307858178` at
  **2026-08-12 04:57:38 UTC**.

**Required to close the trace, and outside my authority:** production NetSuite
inspection of SO2655's creation timestamp, `createdby`, and source, compared
against that transition time — plus the HubSpot workflow definition that fires
on the stage. I have no production NetSuite access and deliberately did not seek
any.

---

## 5 · Proposal for safe Accounting review deals

Ordered by isolation strength. **None created — the exclusion mechanism must be
proven first.**

1. **HubSpot sandbox/test portal.** True environment isolation, matching the
   NetSuite sandbox already in use. Requires a separate write token and
   confirmation the integration works against it. Strongest, and the only option
   where a mistake cannot reach production automation.
2. **Dedicated validation pipeline whose stages fire no production workflow.**
   Deals live in the production portal but transition within stages excluded
   from automation. Requires enumerating every workflow keyed on stage and
   proving the validation stages appear in none. Weaker: relies on configuration
   discipline that can drift.
3. **Per-deal workflow exclusion.** Validation deals flagged and excluded by
   enrollment criteria. Weakest: exclusion is per-workflow, so a new workflow
   defaults to *including* them.

**Prerequisite for all three:** enumerate which HubSpot stages trigger which
downstream automations. That inventory does not exist in the repo and is the
gating unknown.

**Nexus-side complement, independent of which is chosen:** Nexus cannot currently
distinguish a validation scenario from a commercial one before mutating HubSpot.
A governed validation marker checked *before* the push would give defence in
depth — but it is a complement to environment isolation, never a substitute.

**Required invariant:** *sandbox/certification activity must not be able to
trigger production downstream automation* — enforced by isolation, not by
restoring fields after the trigger.

---

## 6 · State

- All Accept operations against real deals: **stopped**.
- Draft scenarios untouched: Order A shell `7f831413…`; no Order B scenario.
- No HubSpot mutation, no NetSuite mutation, nothing deleted or repaired.
- Order A blocked (State C Filling); Order B held; C and D not started.

---

## 7 · Trigger inventory — a HubSpot administrator task, not a Nexus one

**Do not attempt to infer the production workflow inventory from Nexus code or
from an API token lacking Automation scope.** Nexus knows which stage it writes;
it has no knowledge of what listens to that stage.

- The repo contains **no workflow inventory**, and cannot: the listening side
  lives entirely in HubSpot configuration.
- Enumerating workflows requires the HubSpot **Automation API** and `automation`
  scopes. Nexus's tokens are provisioned for deals/companies/products.

**A failed or forbidden workflow query is not evidence that no workflow
exists.** Nor is a workflow toggle showing "off" proof that production side
effects are impossible. Both are instruments that cannot represent the failure
they would be used to exclude — the same trap that produced a false "missing"
verdict during the OD-027 preflight, and a false "zero monetary movement"
census during OD-025.

**What Nexus can supply read-only:** the stage id it writes, from
`firm_settings.hubspot_deal_stage_on_accept`, applied at
`src/app/actions/quotes.ts` via
`hubspot.updateDealStage(project.hubspotDealId, firm.hubspotDealStageOnAccept, { amount })`.

### Required from the HubSpot administrator, before any real-deal Accept window

1. Every workflow/automation that **enrolls or reacts** when a deal enters the
   Nexus Accept target stage.
2. The **downstream action(s)** each performs.
3. Whether turning the workflow **OFF prevents new enrollments**.
4. What happens to **already-enrolled / in-flight** records when it is turned off.
5. Whether events are **queued while off**.
6. Whether turning it **back on can replay** or enroll deals based on changes
   that occurred during the disabled window.
7. **Any other automation outside HubSpot workflows** listening to the same
   stage or property change.

Assume more than one workflow until the inventory proves otherwise.

### Required safety confirmation

An explicit administrator answer establishing:

> During the controlled disabled window, changing the selected real test deals
> into the Accept stage **cannot trigger a production downstream action**,
> either immediately or when the workflow is re-enabled.

**If that cannot be established, real production HubSpot deals must not be used
for the Accounting review.**

A deliberately controlled window with the trigger **proven** disabled is an
explicit exception mechanism — not a reversal of the standing rule at the top of
this document. Accounting review planning resumes **from the supplied inventory
and disable semantics**, not from an attempt to discover the workflow topology
from Nexus.
