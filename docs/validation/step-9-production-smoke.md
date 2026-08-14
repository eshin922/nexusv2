# Step 9 · production smoke on the merged artifact

**Operator-run.** Merge commit `76bc952`. Run against **production**
(`nexusv2-nu.vercel.app`), not a Preview.

**Why this exists.** The retired columns `leaves.product_type_id` and
`assemblies.product_type_id` still exist in the database. This smoke proves the
statement the drop depends on:

> **the new deployed code works correctly while the old schema still exists.**

Until that holds, dropping the columns has nothing to fall back on.

---

## What a failure looks like right now

**Not** `42703 column does not exist`. The columns are still there, so that error
is not yet reachable — it is what the drop would cause if this code were *not*
live. At this stage a failure is an ordinary 500, a blank surface, or a wrong
value.

That inversion is the point: this smoke is the baseline that makes a post-drop
regression attributable.

---

## Doubling as deployment-identity proof

Each check below carries at least one **discriminator** — something that cannot
render on the previous production commit. Observing it establishes that the
merged artifact is live, which is what OBS-1 otherwise leaves unprovable.

The strongest is the first: before the cutover, Setup showed **`untyped`** for
almost every product, because it read a Nexus taxonomy that was unset on ~1,051
of 1,077 rows. A real Product Type in that slot is only possible on the new code.

---

## 1 · Setup

- [ ] Loads without error.
- [ ] **DISCRIMINATOR** — a product row's type tag shows a real HubSpot Product
      Type (`Primary Packaging`, `Secondary Packaging`, `Tertiary Packaging`,
      `Freight`, …) where it previously read `untyped`.
- [ ] **DISCRIMINATOR** — open **Create Item Group**: the field reads
      **`Item group category`** and the empty option reads **`— Pick a category —`**.
      Previously `Item group type` / `— Pick a type —`.
- [ ] A readiness chip somewhere reads **`— Specs not applicable`**
      (`Freight`, `Design`, `One Time Charges`, service products). This state did
      not exist before.
- [ ] `⚠ No type set` appears only where HubSpot genuinely has no classification
      — it should now be rare, not near-universal.

## 2 · Product Library

- [ ] Loads without error.
- [ ] Type column shows HubSpot labels; `Unclassified` where genuinely absent.
- [ ] The HubSpot Type filter narrows results correctly.
- [ ] **DISCRIMINATOR** — no second Nexus-taxonomy type filter is present.

## 3 · Spec entry

- [ ] Opens on a **Primary** or **Secondary** product and renders that schema's
      fields.
- [ ] **DISCRIMINATOR** — no `Change type` control, and no type-picker grid.
- [ ] On an unclassified product the panel reads **`No Product Type set`** and
      points at HubSpot.
- [ ] On a `Freight`/service product it reads **`Specifications not applicable`**.

## 4 · Customer PDF / addendum

- [ ] The existing read/render path loads for a quote whose products carry specs.
- [ ] Spec addendum renders under the **pinned** schema.
- [ ] No 500, no blank addendum where content is expected.

> Read-only. Do not send anything.

## 5 · Controlled create

**Fixture only — not an S-7 basket quote, not a certification record.**

- [ ] Create a product via **Create New Product** on a scratch quote.
- [ ] It succeeds and appears in the tree with its HubSpot Product Type.
- [ ] Its spec surface resolves the derived schema.

This is the important writer: `createLeaf` no longer emits
`leaves.product_type_id` at all. Success proves the deployed writer is the new
one.

## 6 · Controlled Copy Quote

**Safe validation fixture only.**

- [ ] Copy a scratch quote.
- [ ] The copy succeeds.
- [ ] Item Groups in the copy retain their category.
- [ ] Products in the copy show the same Product Types as the source.

`copyQuote` no longer emits `assemblies.product_type_id`. Success proves that
writer is the new one too.

---

## Do not

- Mutate any S-7 preservation basket quote, or any `CERT-` record.
- Send a quote, push to HubSpot, or push to NetSuite.
- Delete the `CERT-MIXED-DELETE-ME-2026-08-13…` fixtures — three of them are
  currently in the S-7 basket and removing them fails the gate until the
  baseline is refreshed.

---

## On PASS

0075 is armed and applied, then the post-drop certification runs: both columns
absent · B-3 authority harness · falsifications 7-12 · `tsc` · unit suite ·
S-7 with unchanged digest · Item Group census `67 / 44 / 0`.

## On FAIL

**0075 stays unarmed.** A failure here is a defect in the new code against the
*old* schema, which is the cheapest possible moment to find one — nothing has
been dropped, and the previous commit is still deployable.
