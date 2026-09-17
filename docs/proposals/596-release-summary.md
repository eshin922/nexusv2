# PR #596 · release summary

**2026-09-16 · head `43219672` · HELD pending release approval.**
No production migration applied, nothing deployed, no rule seeded.

Eleven commits, 33 files. Two separable bodies of work with **different release
requirements**, and the difference is the point of this document.

| | Needs a migration? | Available on deploy? |
|---|:--:|---|
| **A · Owned production fees** (`project_setup`, `rd_formulation`) | **No** | **Yes, immediately** |
| **B · Charge-defaults Settings** | **Yes — 0131** | Surface yes; suggestions no |

They can ship together or separately. **A has no dependency on B.**

---

## 1 · Migration requirements — exact

### The only migration in the branch

`drizzle/0131_draft_product_type_charge_defaults.sql` — two new tables,
`product_type_charge_profile` and `product_type_charge_defaults`.

**It is currently a recorded DRAFT.** It is absent from
`drizzle/meta/_journal.json` and listed in `DRAFT_EXEMPT` in
`scripts/verify/migration-index-unique.ts`. The migrator reads the journal, so
**as the branch stands, `drizzle-kit migrate` would not execute it.**

**Verified read-only against production, 2026-09-16:**

```
production high-water created_at : 1789806720000
PENDING against production       : NONE
journal entries                  : 129
0131 journaled                   : NO — draft, unjournaled
```

Production is fully current. Nothing else is pending.

### To release B, three things must happen, in this order

1. **Journal 0131** — add its entry to `drizzle/meta/_journal.json` and **remove
   it from `DRAFT_EXEMPT`**. Doing only one of the two fails
   `verify:migration-index`, which is the intent.
2. **Apply it**, confirming the pending set is exactly `0131` and nothing else
   before running the migrator.
3. **Then** merge and deploy.

### Classification

**Additive.** Two new tables, no existing object altered, no backfill, no data
migration. Safe ahead of code by the deployment-order rule, and reversible by
`DROP TABLE` while empty.

### If A ships alone

**No migration at all.** A is code-only: three map entries, a relocated
constant, one guard. Merge and deploy.

---

## 2 · Deployment order

### The one ordering that is load-bearing

**0131 must be applied BEFORE the code deploys** — not because of a tightening
constraint, but because `/admin/charge-defaults` is registered in
`ADMIN_SECTIONS` and therefore appears in the admin nav the moment the code is
live. It queries `product_type_charge_profile`. Deploying ahead of the migration
gives an admin a nav entry that 500s.

That is the whole of the ordering risk, and it disappears if 0131 is applied
first.

### Recommended sequence

| # | Step | Check before moving on |
|---:|---|---|
| 1 | Re-confirm the branch head is `43219672` and the pending set is `NONE` | a different head or a non-empty pending set means stop |
| 2 | Journal 0131 · remove from `DRAFT_EXEMPT` · `npm run verify:ci` | must be green; `verify:migration-index` is what catches a half-done journal |
| 3 | Apply the migration · confirm the pending set was **exactly** 0131 | two tables exist, both empty |
| 4 | Merge #596 | |
| 5 | Confirm the deployment | `/admin/charge-defaults` loads and lists every HubSpot Product Type as **Needs review** |

### Shipping A alone

Steps 1, 4, 5 only — and step 5 becomes "a `Project setup` charge can be added
to a standalone product on Costs". No migration, so no ordering constraint.

### Rollback

- **B:** `DROP TABLE product_type_charge_defaults, product_type_charge_profile;`
  while empty, then de-journal. Nothing reads them but their own Settings page.
- **A:** revert the commit. No schema, no data, and no existing charge changes
  its rate, destination or election — asserted by the double-emission
  falsifications and by the 0-failure walks.

---

## 3 · Available immediately on deploy

### A · Owned production fees — fully available, no further work

An operator can add a **Project setup** or **R&D / formulation** charge to a
standalone product *or* an Item Group member, and it costs, prices, recovers,
freezes and posts.

**The authoring control already exists and is already reachable.** The
standalone-product row passes `onAddCharges` whenever
`commercialKind === "product"`, so the existing Add-charges sheet opens on it
today. **No Costs surface work is required** — an earlier round of mine listed
this as paused work, and that was wrong.

Verified end to end in isolation, nothing sent
(`validation:owned-fee-payload-walk`, 0 failures, 0 indeterminate):

| | `project_setup` | `rd_formulation` |
|---|---|---|
| Cost | $1,000 | $2,500 |
| Destination | `otc_setup` | `otc_formulation` |
| Resolved item | 81001 | 81002 |
| Quantity | 1 | 1 |
| Amount | 140,000c | 350,000c |

Emitted total **490,000c against a frozen OTC subtotal of 490,000c, exactly** —
no duplicate recovery. The unit subtotal (560,000c) is real and excluded.

**Both recovery presentations work:** `included` recovers inside the unit price
and prints no separate line; `separate` prints its own line. And the rate is not
frozen into code — changing `markup_defaults.Production` moves the owned charge
and the Item Group column **together**, demonstrated by changing it.

### B · Charge-defaults Settings — the surface, and nothing it says

Once 0131 is applied, `/admin/charge-defaults` works: an admin can record
**None expected**, add suggested charges, edit preselection, and clear a review.
All four states render distinctly, every write is admin-gated, transactional,
audited in-transaction, and serialized per product type by an advisory lock.

**And it will suggest nothing, because nothing is seeded.** Every product type
reads **Needs review**, which is the truthful state.

---

## 4 · What still requires something else

| | Blocked on | Note |
|---|---|---|
| **A charge default reaching an operator** | **Authoring integration — not built** | The rules are read at one moment only: composing the offer when a component is added. That module does not exist. Contract specified in `charge-defaults-authoring-contract.md`; the import boundary that protects it is enforced by test today |
| **Any suggestion at all** | **Approved rules** | No rule is seeded. Per the applicability matrix, the first rules should come from what a reviewer can attest, not from the 12 observed instances |
| **Suggesting `project_setup` / `rd_formulation`** | **A decision, plus a CHECK replacement** | The Settings surface deliberately offers only the five its draft CHECK permits (`SUGGESTIBLE_CHARGE_KEYS`). Owning them and suggesting them are different questions |
| **`testing_micros` as an owned charge** | **A `destination` discriminator on `quote_other_service_items`** | Per-line destination; the table admits one selection per owner and a component charge freezes none. Its existing paths and per-line selection are untouched |
| **Posting to production NetSuite** | **A separate release concern** | Every resolved mapping is a sandbox record; the table records no environment |

---

## 5 · Evidence, as it stands

| | |
|---|---|
| `verify:ci` | clean, including `verify:charge-defaults-writers` |
| Unit tests | **3,273 pass, 0 fail** |
| `validation:charge-defaults-walk` | 70 checks, 0 failures, repeatable |
| `validation:per-line-destination-walk` | 0 failures, 1 indeterminate (readiness on a snapshot with no lines) |
| `validation:owned-production-fee-walk` | 0 failures, 3 indeterminate — includes the **provisional-tier refusal, kept deliberately** |
| `validation:owned-fee-payload-walk` | **0 failures, 0 indeterminate** |
| Settings UI | exercised in a browser against the isolated database: all four states, the disabled-with-reason control, the stale-screen refusal |

**Not verified:** anything against the production database, and the non-admin
UI redirect (the action-layer refusal is verified for all five entry points).

---

## 6 · Separately tracked, and outside this release

- **`testing_micros`** — §4. Not a defect; a scoped change of its own.
- **Direct Service placement defect** —
  `docs/defects/DEFECT-2026-09-16-unbillable-direct-service-placement.md`.
  $1,727.60 / $3,283.00 / $172.20 / $1,727.60 on quote `4781e4bb`. Detected, not
  repaired, quote untouched.
- **NetSuite account provenance** — the mapping table records no environment and
  posting writes account-scoped internal ids. Four safeguards proposed in the
  coverage decision table §3.
- **The applicability matrix's open questions** — OQ3 (ownership) and OQ4
  (type-and-something), to be resolved from concrete examples before the first
  rule is written.

---

## 7 · What this makes available for the Costs design

Stated because it is what the next piece of work builds on, and because two of
these were open questions until this round closed them:

- **A standalone product is a full commercial citizen.** It carries its own cost
  lines, its own one-time charges — including production fees, as of this
  branch — its own recovery elections, its own customer line and its own Sales
  Order line, under its own SKU. **39 standalone products already carry 73 cost
  rows and 7 one-time charges in production.**
- **Item Groups stay optional.** Nothing in this branch requires one, and the
  ownership rule is that a group owns what is the group's and a product owns
  what is the product's — neither borrows the other's worksheet.
- **A cost line is not a component.** `assembly_leaf_inputs` carries no name, no
  Library reference and no unit of measure. Several costed elements under one
  product is *costing*, not structure; giving elements identity is Library
  membership.
- **Nothing here changes what the cost stack totals.** No existing quote's
  arithmetic moves — the double-emission falsifications cover both new keys, and
  a component charge and its legacy column can never both emit for one fee.

**#596 remains held pending release approval.**
