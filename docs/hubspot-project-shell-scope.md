# HubSpot project shells — implementation scope

**Status:** scope for approval. Not implemented.
Predecessor: [`hubspot-project-shell-trace.md`](hubspot-project-shell-trace.md).

No new scheduler. No bidirectional sync. Both explicitly out.

---

## 1 · The shell lifecycle predicate

> **`hasGovernedNexusWork(project)`** — true when Nexus owns something about this
> project that HubSpot has no authority to remove.

```sql
EXISTS (SELECT 1 FROM quotes q WHERE q.project_id = p.id)
OR EXISTS (
  SELECT 1 FROM audit_log a
   WHERE a.entity_type = 'project'
     AND a.entity_id   = p.id::text
     AND a.action NOT IN ('created', 'refreshed', 'archived', 'unarchived_db_fix')
)
OR EXISTS (SELECT 1 FROM user_pinned_projects pin WHERE pin.project_id = p.id)
```

**Why a quote is the primary clause, and why it is durable.** Nothing in the
tree deletes a quote — `delete(quotes)` has zero call sites. So a quote row, once
created, is permanent evidence that a scenario existed, and every governed
artefact (costing, pricing, approvals, specs, attachments, NetSuite pushes)
hangs off it. `EXISTS (quote)` therefore also covers everything beneath it
without enumerating it.

**Why the audit clause exists anyway.** Project-scoped audit already carries
events that are not quote rows — live actions include `scenario_dropped`,
`scenario_recommended_changed`, `sample_order_seeded` and `hubspot_pull_batch`.
The four EXCLUDED actions are exactly the shell's own lifecycle: materialisation,
CRM propagation, and archive/unarchive. Everything else counts as somebody having
worked here.

**Why pins count.** Pinning is a deliberate operator act. Archiving a pinned deal
out from under someone is the kind of small betrayal that teaches people not to
trust the surface. Cheap to check, and it fails the safe way.

**The predicate is deliberately generous, and the asymmetry is the point.**
A false positive costs one row on a filtered view. A false negative archives real
work because a CRM record moved. Those are not comparable, so the predicate errs
toward preservation — including `hubspot_pull_batch`, which is arguably library
work rather than project work and is counted anyway.

**Live shape today:** 21 real projects, 20 with quotes. The one exception —
`Kirby Beauty PO_ Reconstructing Treatment Mask ReOrder` — has zero work-audit
rows, so it is the genuine archivable case and the natural fixture.

### The lifecycle rules

| HubSpot state | `hasGovernedNexusWork` | result |
|---|---|---|
| in `ACTIVE_STAGE_IDS` | either | shell `status = 'active'` |
| left the active pipeline | **false** | shell → `status = 'archived'` |
| left the active pipeline | **true** | **preserved, untouched** |
| deleted in HubSpot | false | archived (cache row disappears; deal id no longer returned) |
| deleted in HubSpot | true | preserved; stage snapshot freezes, and that is correct |

Archive is **reversible** and never deletes. A deal returning to the active
pipeline re-activates its shell through the same idempotent path.

---

## 2 · `project_category` — do not stamp, and here is why it cannot be mapped

`importDeal` hardcodes `projectCategory: "packaging"`. Reusing it as-is would
stamp Packaging on 56 deals nobody classified.

**The two vocabularies do not align.** Nexus's enum is
`packaging | turnkey | soft_goods | secondary | other`. HubSpot's cached
`project_category` across the live 76:

    Primary 37 · (null) 11 · Secondary 8 · Co-Packing 6 · Formulation 6
    Filling 3 · Ingestible 2 · Soft Goods and Accessories 2 · Topical 1

`Secondary` and `Soft Goods and Accessories` map. `Primary` plausibly means
packaging. **`Co-Packing`, `Formulation`, `Filling`, `Ingestible` and `Topical`
have no Nexus equivalent**, and 11 are null. Any mapping for those 18 is an
invented business classification — the thing BV-011 exists to stop.

**Load-bearing discovery: `projects.project_category` is NOT what NetSuite
uses.** `mark-complete.ts:1122` sends `dealCache.projectCategory` and
`dealCache.projectServiceS` — the HubSpot cache strings — to
`custbody_dps_project_category`. The Nexus enum is read only by the project
page's picker. So a wrong stamp does not corrupt NetSuite; it puts a false claim
on 56 project pages, which is reason enough not to do it.

**Recommendation — add `unclassified` to the enum and materialise shells into
it.** An explicit "nobody has classified this" state is visibly not a claim, and
`updateProjectCategory` already exists for an operator to set it.

*Migration caveat:* `ALTER TYPE … ADD VALUE` cannot be used in the same
transaction that then uses the new value. The migration must add the value, and
a separate later statement may use it.

*Alternative:* make the column nullable and materialise shells as NULL. Cleaner
semantically, but every reader must handle null, including the picker. The enum
addition touches fewer consumers.

**Either way, `importDeal`'s hardcode is replaced by an explicit argument** so
the manual path keeps today's behaviour and the sync path does not inherit it by
accident.

---

## 3 · Cache-refresh integration point

`refreshDealsCache()` — `src/app/import/actions.ts:10`, the only caller of the
active-stage search, invoked from the Import page's refresh header.

After the cache upsert completes, one reconciliation pass:

```
materialiseShells(cacheRows):
  for each cached deal at an ACTIVE stage:
      upsert project by hubspot_deal_id          ← existing find-or-create
      if newly created: audit 'created', diff_json.source = 'hubspot_sync'
      else:             refresh CRM-owned fields from cache
  for each ACTIVE project whose deal is NOT at an active stage:
      if hasGovernedNexusWork(project): leave alone
      else:                            status = 'archived', audit 'archived'
```

**Why this point and not a scheduler.** It is already the moment Nexus decides
what the active pipeline is. Materialisation becomes a consequence of the
refresh rather than a second concept with its own cadence. A scheduler is a
separable decision and is out of scope.

**Stage/owner/company stop being frozen snapshots.** The same pass refreshes
`deal_name`, `client_name`, `deal_stage`, `hubspot_owner_id`, `sales_rep_user_id`
for every shell — the fields `refreshFromHubspot` already writes, extracted so
both paths share one projection. The per-project Refresh button remains for
on-demand use.

**Audit.** Materialisation keeps the existing `created` action and carries
`diff_json.source = 'hubspot_sync'` — a transition, not a mechanism, per the
audit-naming rule, with origin disambiguated by source per the Slice 9.2
convention. `imported_by_user_id` stays NULL for synced shells, and its meaning
narrows honestly to "who imported this by hand, if anyone". The project page's
one display site must handle null.

---

## 4 · Organizer filtering

**`projects.status` becomes a real filter — this must land first.** It is
currently written by `archiveProject` and read by nothing, so archiving hides a
project from no surface. Without this, an archived shell never leaves the
Organizer and the whole lifecycle is inert.

Default view stays work-oriented:

```
WHERE projects.is_test = false
  AND projects.status  = 'active'
  AND EXISTS (a non-dropped quote)        ← new
```

Two explicit ways to see the rest, as filter chips beside the existing ones:

| chip | shows |
|---|---|
| **No quote yet** | active shells with no quote |
| **All HubSpot deals** | every active project, shells included |

**Quote-less shells raise no tasks.** The task model already guarantees this
structurally: every one of the four kinds derives from a quote row, so a shell
with no quote produces an empty array. Nothing new is required, and a test pins
it.

**Counts.** The footer already reports hidden test records; it gains the hidden
shell count on the same line, so the default view states what it is excluding
rather than quietly showing 21 of 77.

---

## 5 · Migration / backfill

No backfill migration is needed for the existing 21 — they already have exactly
the shape a materialised shell has.

The 56 arrive as a **consequence of the first refresh**, not as a data
migration. That is deliberate: it is the same code path that will run forever
after, so the first run is also the proof it works.

Migrations required:

1. `unclassified` added to `project_category` (or the column made nullable).
2. Nothing else. `projects.status` and the unique index already exist.

Sequencing:

1. `projects.status` filter in the Organizer + the two chips — **ships alone
   first**, so archiving means something before anything can be archived.
2. Category migration.
3. Shared CRM-projection extracted from `refreshFromHubspot`; `importDeal`'s
   hardcode replaced by an argument.
4. `materialiseShells` wired into `refreshDealsCache`.
5. First run: 21 → ~77, with the default view still showing 20.

Reversibility: steps 1-3 are independently revertible. Step 4 reverts by
removing the call; shells already created remain as ordinary projects, which is
exactly what they would be if someone had imported them by hand.

---

## 6 · Tests

**Idempotency**
- materialising the same cache set twice produces no second project and no
  second `created` audit row;
- a deal already imported by hand is adopted, not duplicated — the unique index
  is asserted, not assumed;
- re-running after an archive re-activates rather than inserting.

**Archive behaviour**
- a shell with no quote, no work-audit and no pin, whose deal has left
  `ACTIVE_STAGE_IDS`, is archived;
- archiving sets `status` and writes an audit row; it does **not** delete;
- an archived shell is absent from the default Organizer and present under
  **All HubSpot deals** — the assertion that proves step 1 actually took effect.

**Preservation of governed history** — each clause independently, because a
predicate is only as good as its weakest arm:
- project with a quote → preserved;
- project with **no** quote but a work-audit row → preserved;
- project with neither but a pin → preserved;
- project whose only audit rows are `created` / `refreshed` / `archived` /
  `unarchived_db_fix` → **not** preserved (the exclusion list is load-bearing and
  must be asserted from both sides).

**Category**
- materialisation never writes `packaging`;
- the manual `importDeal` path is unchanged;
- no HubSpot category string is mapped onto a Nexus enum value — asserted as a
  source sweep, since the failure mode is a well-meaning mapping added later.

**Organizer**
- a quote-less shell produces zero tasks;
- default view excludes shells; both chips reveal them;
- the footer count reports what is hidden.

---

## Open, and worth settling before step 4

1. **`Delivered` (195274343) is not in `ACTIVE_STAGE_IDS`**, yet a live project
   sits there. Under these rules its shell would archive if it had no work — it
   has a quote, so it is preserved. Confirm `ACTIVE_STAGE_IDS` is the right
   relevance set, or amend it deliberately rather than inheriting it.
2. **Should the first run be dry-run-able?** A pass that reports what it *would*
   create and archive, before doing it, costs little and makes the 21 → 77
   moment inspectable. Recommended.

---

# Addendum · deleted / unresolvable HubSpot deals

Added 2026-08-22 as a governed lifecycle requirement. Traced before scoping.

## A · Deletion detection — the mechanism, and the trap in it

**`syncDeals()` prunes by re-writing the active slice:**

```sql
DELETE FROM hubspot_deals_cache WHERE deal_stage IN (ACTIVE_STAGE_IDS);
INSERT <every row the active-stage search returned>;
```

So cache rows for deals no longer returned by that search **do disappear**.

**But absence from the cache is ambiguous, and acting on it directly would be a
defect.** Two entirely different events produce an identical cache state:

| what happened | returned by the active search? | cache row after refresh |
|---|---|---|
| deal deleted in HubSpot | no | **gone** |
| deal moved to a non-active stage | no | **gone** |

A third case is silently different again: the whole refresh failing leaves every
row untouched, so nothing is missing and nothing is detected — the safe
direction, but only by luck.

This is the measurement trap the codebase has already been bitten by: a lookup
that reports "missing" for two different reasons cannot establish nonexistence.
**Cache absence is a candidate signal, never a verdict.**

**The adjudicator already exists and is already correct.** `syncDealById`
distinguishes all three states:

```ts
if (code === 404) return null;                                  // authoritative not-found
throw new HubspotError(`Failed to fetch deal ${dealId}`, err);  // INDETERMINATE
```

404 is HubSpot stating the deal is gone. Any other failure propagates rather than
being folded into "missing". No change is needed to this function; the scope is
to *use* it correctly.

### The detection procedure

Runs in the same reconciliation pass, only over the delta:

```
for each ACTIVE project whose hubspot_deal_id has no cache row:
    row = syncDealById(dealId)          <- authoritative, one call

    row exists    -> the deal LEFT THE PIPELINE, it was not deleted.
                     Apply the pipeline-exit rule. Clear any prior
                     missing-flag: this deal demonstrably exists.

    row is null   -> HubSpot 404. The deal is GONE.
                     Set hubspot_deal_missing_since = now().
                     No governed work -> archive.
                     Governed work    -> PRESERVE, CRM relationship inactive.

    throws        -> INDETERMINATE. Do nothing at all. Log and retry next
                     refresh. A failed read must never mark a deal deleted.
```

Bounded cost: one call per project in the delta, not per project.

**Reversible by construction.** A deal that reappears clears
`hubspot_deal_missing_since` and re-activates through the same path. HubSpot
deletion is never treated as permanent, because it is not.

## B · Schema

```sql
ALTER TABLE projects
  ADD COLUMN hubspot_deal_missing_since timestamptz;   -- NULL = CRM link healthy
```

A timestamp rather than a boolean, because the operator message needs to say
*when*, and "since 14 Aug" is a fact while "deleted: true" is an assertion with
no provenance. NULL is the healthy state, so every existing row is correct
without backfill and the migration is purely additive.

Audit: `crm_link_lost` / `crm_link_restored` on `entity_type = 'project'`,
carrying `{ hubspot_deal_id, detected_at, had_governed_work }`. Transitions, not
mechanisms.

## C · Mutation boundaries — exactly what fails closed

The rule: **a CRM-deleted project may be read completely, corrected inwardly,
and committed nowhere.**

### Tier 1 — MUST fail closed

Forward-moving commercial commitment. Each creates new governed state or an
external obligation against a customer relationship that no longer exists.

| action | file |
|---|---|
| `createQuote` | `actions/quotes.ts:288` |
| `createScenario` | `actions/quotes.ts:351` |
| `reviseQuote` | `actions/quotes.ts:2156` |
| `copyScenarioWithinProject` | `actions/quotes.ts:3974` |
| `copyQuoteFromProject` — **as the TARGET only** | `actions/quotes.ts:4129` |
| `sendQuote` | `actions/quotes.ts:1434` |
| `markAccepted` | `actions/quotes.ts:2375` |
| `recordCustomerAcceptance` | `actions/quotes.ts:3066` |
| `markComplete` (NetSuite SO push) | `actions/quotes.ts:4499` |
| `requestBelowFloorApproval` | `actions/below-floor-approval-request.ts:71` |
| `importDeal` for that deal id | `actions/projects.ts:62` |

`copyQuoteFromProject`'s asymmetry is deliberate and load-bearing: copying **out
of** a dead project into a live one is reading history, which is exactly what
must stay possible. Only the target is guarded.

### Tier 2 — MUST remain available

Blocking these would strand governed state in a condition nobody can resolve —
a worse failure than the one being prevented.

| action | why |
|---|---|
| `unmarkAccepted`, `clearCustomerAcceptance` | reversals; blocking traps a quote in a state with no exit |
| `decideBelowFloorApproval` | an approver resolving an ALREADY-RAISED request; blocking strands the requester |
| `dropScenario`, `renameScenarioLabel` | housekeeping on existing rows |
| `archiveProject` | the operator's own tidy-up |
| every read path — quotes, PDFs, snapshots, specs, approvals, NetSuite records, audit | **history stays fully readable** |

### Tier 3 — needs your disposition

In-place editing of an existing draft's economics: `assembly-leaf-inputs`,
`assembly-production-inputs`, `freight`, `freight-worksheet`, `pricing-lifts`,
`pricing-apply`, `costing` overrides, `client-targets`.

- **Block:** this is literally "continuing work on a deal that no longer exists".
- **Allow:** a draft caught mid-flight is frozen by a CRM event its author had no
  part in, and cannot even be corrected before being abandoned.

**Recommendation: allow editing, block committing.** Every Tier 1 gate sits
between a draft and anything a customer or NetSuite ever sees, so an edited draft
on a dead deal reaches nobody. The deal's existence is what `sendQuote` and
`markComplete` genuinely depend on; a cost cell is not.

## D · The guard, and the message

`assertCrmLinkActive(project)` in the guard family beside `assertDraft` and
`assertNotFrozen`, throwing `ActionGuardError` so it surfaces through the
existing `ActionResult` path as structured, displayable text.

**Naming caution:** `requireRevisable` in `quote-guards.ts` already carries
inverted semantics relative to its name. The new guard is named for the
condition it requires, not the failure it detects.

**The operator-facing reason must name cause, consequence and remedy** — not a
greyed control (Pattern 47(f): every disabled control must communicate why):

> **This deal no longer exists in HubSpot.** Nexus stopped finding it on 14 Aug.
> Everything already quoted stays readable, and nothing has been deleted. New
> quotes, sends and NetSuite pushes are blocked until the deal is restored in
> HubSpot — or start again from a current deal.

Surfaced in three places, so it is never discovered by clicking:

1. a persistent banner on the project and its quotes;
2. a `CRM LINK LOST` chip on the Organizer row;
3. the refusal itself, if an action is attempted anyway.

## E · Additional tests

- cache absence alone **never** marks a deal deleted — a project whose deal moved
  to a non-active stage is not flagged, asserted against the 404 path
  specifically;
- a `syncDealById` **throw** leaves the project completely untouched — the
  indeterminate case, asserted as "no write occurred", not merely "no flag set";
- 404 with governed work → preserved, flagged, still readable;
- 404 without governed work → archived;
- reappearance clears the flag and re-activates;
- every Tier 1 action refuses with the explicit reason; every Tier 2 action still
  succeeds — both directions, since a guard that blocks too much is the failure
  mode Tier 2 exists to prevent;
- `copyQuoteFromProject` succeeds **from** a flagged project and refuses **into**
  one.

---

# Addendum 2 · dry-run result and the lifecycle schema / guard scope

Run 2026-08-22 by `scripts/hubspot-shells/dry-run.ts`. **No writes** — every
statement is a SELECT, and the HubSpot adjudication is a direct read-only GET
rather than `syncDealById`, which would upsert the cache.

## The finding that outranks the count

Nine real projects have **no cache row**, and every one of their Nexus stage
snapshots is **wrong**:

| deal | Nexus says | HubSpot says |
|---|---|---|
| Afore - 30ml DermaReverse Serum | Development & Quoting | **Closed lost** |
| Root - Powder Container | Quote Request | **Closed lost** |
| Root - Powder Pouch w/ Seal | Quote Request | **Closed lost** |
| SPRAE - 500ml Stove-Top Cleaner | Development & Quoting | **Closed lost** |
| Kirby Beauty - Restoring Shampoo | Development & Quoting | **Won - In production** |
| Kirby Beauty PO_ Reconstructing Mask | New (Acquiring Info) | **Won - In production** |
| Nemah - 30ml Nipple and Lip Balm Jar | Quote Request | **Won - In production** |
| SWW PO1033 Alkalized Greens | Development & Quoting | **Won - In production** |
| SOL - Gen Z '68 Bag | Development & Quoting | **Delivered** |

Operators are looking at nine deals labelled as live quoting work that are
actually **closed-lost or already won**. Manual per-project refresh was the only
thing that would have corrected this, and nobody pressed it.

That is the real argument for the slice. Removing the Import step is
convenience; ending silent stage drift is correctness.

**This side of the report was missing from the first version.** The archive and
deletion arms are decided by PROJECT-side absence, so a loop over cache rows
could only ever print "archived: 0". The instrument could not express the
answer. Both directions are now covered.

## Dry-run result

    cache rows examined                            76
    already have a Nexus project                   20
    WOULD CREATE (new shells)                      56

    archived — cache side                           0
    archived — absent-from-cache side               1   Kirby PO_ Reconstructing
    preserved with governed history                 8
    re-activated (stale cache)                      0
    INDETERMINATE — untouched                       0

    real projects before                           21
    real projects after                            77

**Zero deletions.** No deal returned 404; all nine absent deals exist and have
simply moved on. **Zero indeterminate** — every HubSpot read succeeded, so
nothing was skipped for safety, which means the safety path is untested against
live data and a fixture must cover it.

The single archive is exactly the project the predicate predicted: no quote, no
work-audit, no pin.

## Open question the numbers raise

The 8 preserved projects keep `status = 'active'` and **have quotes**, so under
the filter as scoped they would appear in the DEFAULT work-oriented Organizer —
alongside genuinely active work, while their deals are Closed lost or Won.

That satisfies "do not hide history" and strains "default view is
work-oriented". **Proposal:** preserved-inactive projects stay visible but carry
a `CRM INACTIVE · <stage>` chip, and the default view excludes them the way it
excludes shells, with an explicit chip to bring them back. They are history, not
queue. **Needs disposition** — it is the one place the two stated goals pull
apart.

## Lifecycle schema

```sql
-- 1 · CRM relationship state. NULL = healthy. Additive; no backfill.
ALTER TABLE projects ADD COLUMN hubspot_deal_missing_since timestamptz;

-- 2 · CRM-inactive (deal exists, outside the relevant pipeline). Distinct from
--     missing: one is "moved on", the other is "gone". Conflating them loses
--     the difference between a won deal and a deleted one.
ALTER TABLE projects ADD COLUMN crm_inactive_since timestamptz;

-- 3 · The unclassified category (see the ALTER TYPE transaction caveat above).
ALTER TYPE project_category ADD VALUE 'unclassified';
```

**Enum-tolerance check, as requested — three consumers, none derived from the DB
enum, and one is a silent-failure risk:**

| consumer | effect |
|---|---|
| `VALID_CATEGORIES` (`actions/projects.ts:13`) | hand-maintained array; must gain the value or operators cannot set it |
| `CATEGORIES` (`category-select.tsx:6`) | hand-maintained options. **A project set to `unclassified` renders with NO matching option, so the browser displays the first — "Packaging".** The exact false claim this section exists to avoid. Must be updated in the same change. |
| NetSuite (`mark-complete.ts:1122`) | unaffected — reads `dealCache.projectCategory`, not the enum |

Tolerable, not free.

## Guard scope

`assertCrmLinkActive(project)` — `src/lib/action-result.ts`, beside
`assertDraft` and `assertNotFrozen`. Throws `ActionGuardError`, so it surfaces
through the existing `ActionResult` path as displayable text.

Refuses when `hubspot_deal_missing_since IS NOT NULL` **or**
`crm_inactive_since IS NOT NULL`, with a message naming which — the operator
needs to know whether the deal was deleted or merely closed, because the
remedies differ.

**Applied to Tier 1 only** (create quote/scenario, revise, copy-into, send,
acceptance, complete, below-floor request, import/materialisation). Tier 2
recovery and read paths untouched. **Tier 3 draft editing is explicitly NOT
guarded**, per direction: the boundary is commitment and progression, not draft
manipulation.

An affected draft carries a persistent banner stating it cannot progress —
shown on the quote surface, never discovered by pressing a disabled button
(Pattern 47(f)).

## Not yet done, deliberately

The 56 shells are **not materialised**. This is the dry run; nothing was
written.

---

# Addendum 3 · dispositions recorded 2026-08-22

Decisions taken on the trace and dry-run. **Recorded only — no shell
materialisation has occurred.**

## D1 · Terminal preserved projects stay out of the default active-work view

**Approved.** The open question in Addendum 2 is settled.

A project whose HubSpot deal has left the active pipeline but which carries
governed Nexus history is **preserved, stored and truthful** — and it does
**not** belong in the Organizer's default active-work surface. *Closed lost* and
*Won — In production* records are history, not queue.

"Don't hide history" means they remain stored, discoverable and accurate. It
does not mean a terminal deal sits alongside live quoting work.

**Express this through the existing stage/status filtering model. Do NOT
introduce a second archive mechanism.** The distinction the Organizer already
needs — `projects.status` becoming a real filter, plus the shell/quote-less
chips — is the same machinery; terminal-but-preserved is another band within it,
not a new concept.

Concretely, for the shell implementation:

- preserved-terminal projects keep their rows, their quotes and their audit;
- they are excluded from the default view by the same filtering layer that
  excludes quote-less shells;
- they remain reachable through an explicit filter, and carry a chip naming the
  terminal stage so the reason is visible rather than inferred;
- **no new archive column, table or lifecycle verb.** `status` plus the deal's
  own stage already carry it.

**Current shape, from the dry run:** 8 projects would land in this band —
4 *Closed lost*, 4 *Won*, 1 *Delivered* (Epicuren, found later, makes the
terminal population larger than the original nine).

## D2 · The `unclassified` enum and its rendering are atomic — SHIPPED (fix half)

**Merge blocker for any commit introducing the enum value.**

The rendering half landed ahead of the enum in PR #362. A `<select>` whose
`defaultValue` matches no `<option>` silently selects the FIRST one, so an
unrecognised category rendered as **"Packaging"** — a false claim about the
project on the page an operator reads to learn what it is. Fifty-six shells
would each have asserted it on sight.

The picker now derives membership from its own option list and renders an
explicit **disabled** `Unclassified — not set` for anything it does not
recognise. Disabled is what makes it safe to land first: the state displays
truthfully without offering a value the database would reject.

`tests/unit/category-select-no-fallthrough.test.ts` asserts the pairing **from
both sides**, so it cannot be half-shipped in either direction:

- enum has `unclassified` → the picker and `VALID_CATEGORIES` must too;
- enum does not → the picker must not offer it.

When the shell slice adds the enum value, that test fails until the option list
and the write validator are updated in the same commit. The atomicity is
enforced, not remembered.

## D3 · Stage-snapshot drift repaired — SHIPPED

Ten projects repaired in production (PR #362), not nine: adjudicating every
project rather than only cache-absent ones surfaced `Epicuren - Pro Masks`
(New → Won), invisible to the narrower predicate because it *is* cached, at a
non-active stage.

**This changes the standing argument for the shell slice.** The drift is
repaired, but nothing prevents its recurrence: `refreshFromHubspot` still has
zero callers, so there is still no control an operator can press. The next
snapshot to drift will drift silently, exactly as these ten did.

Materialisation is what makes propagation continuous. Until it ships, the
repair script is the only remedy and it has to be run by hand.

## Still open

- **Tier 3 draft editing** — settled: allowed. The governed boundary is
  commitment and progression, not draft manipulation.
- **`ACTIVE_STAGE_IDS`** — confirmed unchanged; `Delivered` is deliberately not
  added merely because a project sits there. Active-pipeline relevance and
  preservation of Nexus history are separate concerns.
- **Nothing materialised.** The 56 shells remain un-created.
