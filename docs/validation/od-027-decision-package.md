# OD-027 · Product Library eligibility — decision package

**Not implemented.** Returned for disposition. All Accounting review orders
remain stopped; no master data created, no substitution.

---

## 1 · The fact that reframes State B

`leaves` columns: `id, name, sku, url, image_url, product_type_id, unit_cost,
fsc_claim, fsc_status, supplier_verified, owner_id, archived, created_at,
updated_at, hubspot_product_id`.

**There is no `netsuite_item_id`.**

So the Nexus → NetSuite relationship is **not stored**. It is **re-derived at
every Send** by string-matching `leaves.sku` against `item.itemid`
(case-insensitive, non-Group, active).

This matters more than the deleted HubSpot record, and changes the question:

> The brief asks whether an *established* Nexus SKU → NetSuite Item relationship
> stays valid when HubSpot is deleted. **There is no established relationship.**
> There is a string re-asserted on each transaction.

What HubSpot deletion actually removes is the **only party guarding the SKU
namespace**. While the HubSpot product exists, a SKU has an owner; once deleted,
nothing prevents that string later meaning a different physical product — and
Nexus would silently transact against it, because it re-resolves by string.

**The exposure in State B is not provenance. It is unpinned identity.**

---

## 2 · State model

| | state | HubSpot authority | NetSuite resolution | example |
|---|---|---|---|---|
| **A** | Healthy | exists, agrees | exactly one | 847 leaves |
| **B** | Authority degraded | **deleted**, provenance id retained | exactly one | `DPS-BOTTLE-0001` → 66476 · `10064-GNX-Box` → 1024 |
| **C** | Downstream missing | exists | **none** | `CC-12oz-Filling-1.4` |
| **D** | Downstream ambiguous | (either) | **>1** | `10025-Fill` → 72978 + 59156 |
| **E** | Unproven provenance | **no id stored** | (either) | `LEAF-GLW-FCT`, 14 leaves |

Not collapsed to eligible/ineligible — the consequences differ per state.

---

## 3 · Proposed behaviour per state

| state | visible historically | in Library search | attach to new draft | Send | Complete |
|---|---|---|---|---|---|
| **A** | yes | yes | yes | yes | yes |
| **B** | yes | yes, **badged degraded** | **yes, with visible warning** | yes | yes |
| **C** | yes | yes, badged | **no** | n/a | n/a |
| **D** | yes | yes, badged | **no** | n/a | n/a |
| **E** | yes | yes, badged | **no** — pending investigation | n/a | n/a |

**Nothing is hidden or auto-archived in any state.** Historical visibility is
never withdrawn: a product that priced a sent quote must remain inspectable, and
current ineligibility says nothing about historical validity.

**Send retains a fail-closed recheck in every case**, because eligibility can
change between authoring and Send — that is precisely how a State A product
becomes State B without anyone touching Nexus.

### Operator status + remediation owner

| state | operator sees | owner |
|---|---|---|
| **B** | "Provenance degraded — original HubSpot product deleted. Still resolves to NetSuite item *N*." | Product Master — restore or formally retire |
| **C** | "Not yet in NetSuite — cannot be ordered." | Product Master — sync HubSpot → NetSuite |
| **D** | "Ambiguous SKU — *N* active NetSuite items share this code." | Product Master — de-duplicate namespace |
| **E** | "No governed source recorded." | Nexus + Product Master — investigate provenance |

---

## 4 · Recommendation on State B

**Allow in V1 as visibly degraded — but the mitigation is pinning, not the
badge.**

**For:**

- **Continuity.** Bottle and Box are the two most-used leaves (16 and 8 prior
  attachments). Blocking State B stops core authoring immediately, for a defect
  that is upstream and historical.
- **Provenance survives deletion.** The leaf retains `hubspot_product_id`, and
  `audit_log.leaf_create` records the origin with its `source` discriminator.
  The *evidence* of governed origin is intact; only the live record is gone.
- **Deletion is ambiguous.** A deleted HubSpot product may mean deliberate
  retirement **or** routine CRM cleanup. Nexus cannot tell them apart, and
  treating cleanup as retirement would block real commerce on a filing decision.
- **NetSuite is the transacting authority.** The SO line is a NetSuite item.
  That item is active and unique.

**Against — and not dismissible:**

- **SKU reuse is unguarded, and this is the real risk.** With no
  `netsuite_item_id` pinned, resolution is a string match every time. If the
  code is later reused for a different product, Nexus transacts against the new
  meaning silently. HubSpot deletion removes the party that would have prevented
  the collision.
- **No evidence of shared origin.** Nexus holds *no* record that its leaf and
  the NetSuite item were ever synchronised from the same product. Agreement is
  inferred from an identical string — the same inference that produces State D's
  ambiguity.

**Therefore:** allowing State B is defensible **only** with the identity pinned.

**Recommended V1 shape:** permit State B, badge it degraded, and **store the
resolved `netsuite_item_id` on the leaf at first successful resolution**. From
then on resolve by the pinned id and treat a SKU/id divergence as a hard stop
rather than silently re-pointing. That converts an inferred string relationship
into an established one — which is what the brief assumed already existed.

If pinning is out of V1 scope, State B should still be **allowed and badged**
rather than blocked, with the reuse risk accepted explicitly and recorded —
blocking has immediate certain cost, while reuse is a latent contingent one.

**If State B is instead blocked:** the operational impact must be quantified
first. Bottle and Box alone reach 24 prior attachments, and the dangling-id
population is unmeasured — it is plausibly much larger than the 14 leaves with
no id at all.

---

## 5 · Census correction

**Stop quoting 17.5% as the affected total.** The census measured leaves with
**no stored HubSpot id** (14). It did **not** measure leaves whose stored id is
**dangling** — and Bottle and Box both fall in that unmeasured gap, which is how
the two most-used products escaped the headline.

The dangling population is **not** measured here. Per instruction it becomes
release-critical only if State B is blocking; if State B is degraded-but-usable,
the count changes a badge, not eligibility.

---

## 6 · Accounting review consequence

- **State B allowed** → Bottle and Box may resume for **B/C/D** after the
  corrected preflight re-proves unique resolution. **Order A stays blocked** —
  its Filling candidate is **State C**, not B, and no recommendation here
  unblocks it.
- **State B blocked** → the whole set stays blocked pending Product-master
  remediation.

Either way, no replacement master data is created inside Nexus.

---

## 7 · Instrumentation correction — applied

`acct-review-bcd-preflight.ts` now distinguishes **three** outcomes: `exists`,
`not_found` (authoritative null), and `read_failed` (**INDETERMINATE**, exit 3,
no verdict issued). A read failure can no longer be reported as absence.

The Bottle/Box finding stands because the reads were repeated with errors
surfaced: both returned genuine null without throwing, while the Filling control
`2911930393` returned EXISTS through the same path.
