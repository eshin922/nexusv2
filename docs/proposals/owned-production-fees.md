# Owned production fees · `project_setup` and `rd_formulation`

**2026-09-16 · release candidate. No migration, no seeding, no production change
until approved.**

Separated from the held charge-defaults work (#596). **This branch has no
dependency on it**, and vice versa: the Settings feature and its migration 0131
stay held, and nothing here needs them.

---

## 1 · What it does

A **standalone quoted product** can now carry a set-up or development fee it
caused, as its own one-time charge — and so can an Item Group member.

Before this, those two fees existed only as columns on
`assembly_production_inputs`, which migration `0082` restricts to assemblies and
Direct Services. A standalone product had nowhere to record one, so the fee was
being forced through an Item Group it did not belong to.

**No new mechanism.** `quote_charge_instances` already carried these keys in its
`recovery_charge` enum and already accepted any `quote_leaves` row as owner.
Three application maps refused them; this widens those maps.

---

## 2 · The change, in full

| File | Change |
|---|---|
| `commercial-recovery/registry.ts` | `PRODUCTION_MARKUP_CATEGORY` **relocated here**; two keys added to `COMPONENT_CHARGE_KEYS`, `COMPONENT_CHARGE_LABELS` and `COMPONENT_CHARGE_MARKUP_AUTHORITY` |
| `costing.ts` | imports the relocated constant and **re-exports it**, so every existing import site is unchanged |
| `netsuite/component-charge-destination.ts` | `project_setup → otc_setup`, `rd_formulation → otc_formulation` |
| `component-charges/create.ts` | the duplicate guard |
| `assembly-tree/add-component-charges-sheet.tsx` | two operator hints |
| 4 test files | dispositions updated, overlap falsifications extended |
| 2 walks + `package.json` | the isolated-environment evidence |

**No schema. No migration. No data.**

### One binding, not a second copy

The constant had to move: the component authority table binds both keys to the
same value `chargeEconomicsFor` applies to the production columns, and
`registry.ts` cannot import `costing.ts` — costing already imports registry, so
the reverse is a cycle.

**No rate is introduced.** The percentage lives in `markup_defaults.Production`,
is admin-editable, and resolves at compute time. Writing `"Production"` in the
authority table would compile, price correctly today, and be a second copy free
to drift.

### The duplicate guard

It refuses where a Direct Service leaf's **own governed input already occupies
the key being added**:

```
identity → DIRECT_SERVICE_PRODUCTION_INPUT → column → OTC_COLUMN_TO_CHARGE → key
```

Composed exactly, **no amounts compared** — a $900 column beside a $500 charge
is the same duplication, mis-stated. Exactly three identities can collide;
`filling_blending` and `packout_assembly` map to recurring columns in no charge
map, and the guard does not invent a collision for them.

**It reaches no further.** Two charges of one type on one component, and a
component's fee beside an Item Group's, are separately incurred obligations and
are preserved. Differing labels do not *prove* distinctness; they only make the
distinction recorded. The refusal names the surface:

> …is already this Testing / Micros line's governed fee, so adding it here would
> record the same fee twice. Enter the amount on the Testing / Micros line's
> Production input instead. A DIFFERENT fee this line separately incurred can
> still be added under another charge type.

### `testing_micros` is excluded, and the exclusion is checked

`otc_testing` is a **per-line** destination; `quote_other_service_items` admits
one selection per owner with no destination discriminator, and a component
charge freezes `selectedNetsuiteItem: null` unconditionally. Adding it would
produce a charge that is authorable, costable and **unsendable**. Its existing
paths and per-line selection are untouched.

---

## 3 · Evidence

Run against the separated candidate, not inherited:

| | |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run verify:ci` | **clean** |
| `npm run test:unit` | **3,255 pass, 0 fail** |
| `npm run validation:owned-production-fee-walk` | **0 failures**, 3 indeterminate |
| `npm run validation:owned-fee-payload-walk` | **0 failures, 0 indeterminate** |

### The payload, generated and not sent

| | `project_setup` | `rd_formulation` |
|---|---|---|
| Cost | $1,000 | $2,500 |
| Destination | `otc_setup` | `otc_formulation` |
| Resolved item | 81001 | 81002 |
| Quantity | 1 | 1 |
| Amount | 140,000c | 350,000c |

Emitted total **490,000c against a frozen OTC subtotal of 490,000c, exactly** —
no duplicate recovery. The unit subtotal (560,000c) is real and excluded; it
posts by its own path.

### Rate consistency, demonstrated rather than asserted

Changing `markup_defaults.Production` 0.40 → 0.77 moves **both** the standalone
product's owned charge and the Item Group's `setup_fee_total` column, both
resolving category `Production`; restoring returns both. A second copy of the
string would pass every structural check and fail exactly this.

### Existing arithmetic is unchanged

`legacy-otc-owner-boundary`'s OVERLAP fixture now carries both new keys, so its
double-emission falsifications run for them: **a component charge and its legacy
column can never both emit for one fee.**

### The three indeterminates, stated

Two are the isolated database carrying no NetSuite destination mappings — an
environment fact. The third is `provisional_tier` on an existing quote whose
total was printed as a floor; **that quote is deliberately untouched and is the
evidence that posting is correctly refused.** The payload walk builds its own
fully costed quote rather than altering it.

---

## 4 · Available on deploy — nothing further required

An operator can add **Project setup** or **R&D / formulation** to a standalone
product or an Item Group member immediately, and it costs, prices, recovers,
freezes and posts.

**The control already exists and is already reachable.**
`assembly-tree-body.tsx` passes `onAddCharges` for any row whose
`commercialKind === "product"`, so the existing Add-charges sheet opens on a
standalone product today. **No Costs surface work is required.**

Both recovery presentations work: `included` recovers inside the unit price and
prints no separate line; `separate` prints its own.

---

## 5 · Deliberately NOT in this branch

- **Charge-defaults Settings and migration 0131** — held.
- **Suggesting these two keys.** Owning a charge and having a Product Type
  suggest it are different questions. See the held work's gap note.
- **`testing_micros`** — §2.
- **The Direct Service placement defect** and **NetSuite account provenance** —
  separately tracked.

---

## 6 · Rollback

Revert the commit. No schema, no data, no migration, and no existing charge
changes its rate, destination or election.
