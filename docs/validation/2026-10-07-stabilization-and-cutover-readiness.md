# Stabilization and cutover readiness — 7 October 2026

This is a current decision record for the next work package. It does not
authorize a production HubSpot or NetSuite change, a Nexus data reset, or a
customer order. Edward is already running the operator workflow review.
Production NetSuite changes remain held until he signals cutover.

## 1. Release baseline and open work

PR #628 is merged and deployed: Preview finalizes directly into Client Review;
the redundant Send to Client phase is gone. PR #621 is merged, but the
ordered-spec production export is designed to remain off pending production
NetSuite customization and comparison. These are separate facts: deployed code
does not prove a production integration is enabled.

GitHub listed **50 open PRs** on 7 October. This is not a releasable queue.
The immediate candidates are:

| PR | Current disposition | Evidence required before changing disposition |
|---|---|---|
| #616 — quote Products in Item Groups | **Hold for current operator review** | Verify the live picker and Costs do not create or count a second product attachment. Rebase, rerun current checks and perform one grouped/standalone comparison before merge. |
| #618 — associated services under owner | **Hold for current operator review** | On MISTR, distinguish linked services from truly standalone ones; verify Setup placement and separate NetSuite service-line accounting. Rebase and test against current main. |
| #620 — scoped Price build | **Hold for current operator review** | Compare all-quote and selected group/SKU contributions at both tiers, including Packaging, Production and Raw lanes; verify total conservation and no group double count. Rebase and test against current main. |
| #625 — invoice template | **Keep draft and sandbox-only** | It records source/candidate, not an approved production invoice. Verify real invoice rendering, form binding, line amounts, terms and specification disclosure before ready-for-review. |

The code in #616, #618 and #620 is **not on current `main`**, so those three
behaviors must not be represented as live production functionality. They are
previously requested fixes/refinements, not a mandate to merge during the
operator stabilization review. The review must first establish whether each
still reproduces on the current baseline; then rebase and validate any
needed change.

The other 46 PRs span old design, certification, fixes and evidence. Do not
bulk-merge or bulk-close them by age. Assign each an owner and one outcome:
**still needed**, **superseded by a named commit/PR**, or **archive as evidence**.
If the code or decision is already present on main, record the specific proof
before closing. Release work should not depend on an open branch silently.

## 2. One cutover decision record

The detailed execution source remains
[`production-hubspot-netsuite-cutover-plan.md`](production-hubspot-netsuite-cutover-plan.md).
Before the cutover window, reconcile it with the older
[`production-go-live-checklist.md`](production-go-live-checklist.md) and
[`GO_LIVE_READINESS_CHECKLIST.md`](../slice-13/GO_LIVE_READINESS_CHECKLIST.md).
These documents were written at different phases; their unchecked items must
not be interpreted as proof of today's deployed configuration. In particular,
the older checklist says Accept suppression must be removed, whereas the beta
disposition in PR #432 deliberately keeps it enabled. The current deployed
setting and the one-Sales-Order ownership decision must govern the final rule.

The release chair needs a single signed answer and measured evidence for:

1. **One SO creator per deal.** Document whether Nexus or the active HubSpot
   workflow creates the production SO, and prove the other path cannot create
   a duplicate. Do not use stage reversal as a substitute for this proof.
2. **Environment identity.** Read the actual deployed Nexus account, token
   role, suppression and ordered-spec-export states. Compare production
   NetSuite script IDs, roles, fields, items, customer mappings and terms to
   sandbox; never carry over sandbox internal IDs by assumption.
3. **PO line identity.** Prove SO `lineUniqueKey` ↔ PO line matching for
   repeated SKUs, group members and multiple vendors before propagating
   ordered specs. Verify late-arriving spec links and printed redacted text.
4. **Disclosure.** Resolve whether `fm_actives` can appear on the customer
   PDF; keep it withheld from NetSuite and vendor PO meanwhile. Decide invoice
   disclosure independently.
5. **Pilot, rollback and owners.** Name the controlled deal, Accounting/Ops
   reviewers, stop criteria, monitoring owner and restore authority. Keep
   production NetSuite untouched until Edward signals this cutover.

## 3. Nexus blank-slate rehearsal, preparation only

Edward confirmed on 7 October that **all Nexus quotes entered so far are test
cases**. The reset removes all current Nexus project, quote, order and related
working data, including quote PDFs/attachments, while retaining Product
Library defaults, settings, users and valid reference data. A permanent quote
archive or historical ordered-spec backfill is unnecessary. The reset does not
delete HubSpot deals or NetSuite orders; an existing deal with a NetSuite SO
must not be treated as a fresh order after its Nexus push row is removed.

The first executable artifact is
[`scripts/cutover/reset-inventory.mjs`](../../scripts/cutover/reset-inventory.mjs).
It reads the public schema, FK graph, soft ID-like columns and exact candidate
row counts **inside a read-only transaction**. It marks every table for review;
it makes no delete decision and performs no mutation. Run it only against a
restored copy, for example:

```powershell
node --env-file=.env.restored.local scripts/cutover/reset-inventory.mjs > reset-inventory.json
```

Edward confirmed that no isolated restore is available yet. No rehearsal or
row-level manifest has been run. The next gate is to create an isolated
database and quote-file restore, then:

- Classify each candidate as transactional, retained reference, or mixed;
  examine JSON/soft references as well as FKs. `leaf_specs`, `audit_log`,
  idempotency rows and NetSuite mapping caches require row-level treatment.
- Inventory PDF/attachment object keys, quote/deal/SO lineage, statuses and
  row counts. Take and restore-test a temporary rollback backup before any
  deletion; retain it only through the agreed reset verification window.
- Build a reviewed allowlist reset on the restored copy, verify before/after
  counts and preserved Library/settings checksums, and test a new project and
  quote. No broad `TRUNCATE ... CASCADE` and no external-system writes.
- Only after Edward approves a cutover window: pause writers, take a final
  temporary backup, execute the rehearsed reset once, and reconcile the active
  blank slate against the manifest and external order ledger. Remove the
  rollback copy after the verification window.

**Exit condition for this work package:** the operator review has a defect
disposition; priority PRs are either merged with current evidence or explicitly
deferred; the cutover decisions have named owners; and the reset has a
restored-copy manifest and successful restore/rehearsal. None of these is
inferred from passing code checks alone.
