# NetSuite Class — legacy mapping review

**2026-08-12 · sandbox `7924416_SB2` · investigation only, nothing implemented**

Commissioned after the Case B walk halted on
`Invalid Field Value 3 for the following field: class`. Class is **retained as a
V1 requirement**. The defect is reclassified as instructed:

> Nexus is currently sourcing Class from the wrong authority and emitting it at
> the wrong level.

**The review's central finding changes what the repair is.** The expected shape
was `governed Nexus line type/category → NetSuite line class`. The evidence says
the mapping Nexus needs to build **already exists inside NetSuite**, on the item
record, maintained by Accounting — and NetSuite already applies it correctly to
Nexus-created Sales Orders **when Nexus sends nothing**.

---

## 1 · The decisive evidence — SO2698

`SO2698` was created by Nexus. Per §11.1's inspection of its frozen
`payload_snapshot`, it carried **six header keys and no `class` field anywhere**.
Its lines came back:

| SKU | item type | **line class** | item-record class |
|---|---|---|---|
| `10064-GNX-Box` | InvtPart | **10 · Secondary** | 10 · Secondary |
| `BA146400` | InvtPart | **58 · Soft Goods and Accessories** | 58 · Soft Goods and Accessories |
| `DPS-BOTTLE-0001` | InvtPart | **1 · Primary** | 1 · Primary |

**Nexus has already produced a correctly class-attributed Sales Order — by not
sending Class.** NetSuite defaults each line's class from the item record.

This is not inference from numeric ids. It is a real order, created by this
system, whose classification is correct today.

## 2 · Class is an item-record property

| | |
|---|---|
| Items carrying a class | **1,296 of 1,358 — 95.4%** |
| SO lines where line class **=** item class | **2,523 — 92.4%** |
| SO lines where line class **≠** item class | **208 — 7.6%** |
| SO lines with item classed but line class null | 33 |

Item-record class verified against representative SKUs — every one matches the
class its lines carry:

| SKU | item class |
|---|---|
| `OTC-0012` | 60 · Freight |
| `OTC-0003`, `OTC-0004` | 61 · One Time Charges |
| `OTC-0018` | 62 · Formulation |
| `OTC-0020` | 6 · Design |
| `10018` | 42 · Filling and Packout Services |
| `RBRJ-04OZ` | 1 · Primary |
| `BA020800` | 58 · Soft Goods and Accessories |
| `Label_Tincture_Sea_v01` | 64 · Secondary - Labels |
| `IC129400` | 276 · Cards, Booklets |

**The 7.6% of mismatches are deliberate refinements, not noise.** They move
within a family, toward a more specific class for the commercial context:

- item `42 Filling and Packout Services` → line `59 Co-Packing`
- item `276 Cards, Booklets` → line `66 Secondary - Cards, Booklets`

So the operative rule in this account is: **the item record is the default and
governing authority; Accounting occasionally refines a line by hand.** Nexus is
not the party performing those refinements today, and nothing in V1 gives it the
information to.

## 3 · The authoritative table — every Class on legacy SO lines

19 classes in use across **2,926** classed lines. Item-type and SKU columns are
from a 1,000-line sample (SuiteQL page cap); counts are full-population.

| id | Class name | lines | item types | representative legacy SKUs | what the line is | Nexus datum describing the same thing | V1-reliable? |
|---|---|---|---|---|---|---|---|
| 61 | **One Time Charges** | 805 | NonInvtPart | `OTC-0003`, `OTC-0004`, `OTC-0016`, `OTC-0005` | NRE, setup, tooling, misc one-time fees | service-fee rows (`setup`, `tooling`, `other`) | on item |
| 60 | **Freight** | 559 | NonInvtPart | `OTC-0012` (41 of 43) | freight billed as its own line | freight legs | on item |
| 10 | **Secondary** | 491 | InvtPart | `Carton_*`, `LemmeGiftBags`, `C20011` | cartons, outer packaging | category `Secondary` | on item |
| 1 | **Primary** | 277 | InvtPart | `RBRJ-04OZ`, `MAMH-ONSZ-V2`, `RARC-04OZ` | bottles, jars, primary containers | category `Primary` | on item |
| 58 | **Soft Goods and Accessories** | 251 | InvtPart | `BA020800`, `BA033201` | bags, accessories | category `Soft Goods` | on item |
| 42 | **Filling and Packout Services** | 143 | NonInvtPart (+4 InvtPart) | `10018`, `10014.V2`, `10015` | filling / packout service | production service fees | on item |
| 64 | **Secondary - Labels** | 142 | InvtPart | `Label_*` | labels | — (no Nexus subdivision) | on item |
| 66 | **Secondary - Cards, Booklets** | 89 | InvtPart | `IC027200`, `10PK-01-DC03` | inserts, booklets | — | on item |
| 276 | **Cards, Booklets** | 68 | InvtPart | `IC129400`, `IC065600` | inserts (parallel to 66) | — | on item |
| 173 | **Raw ingredients** | 31 | InvtPart + NonInvtPart | `Organic Greens V1`, `DPS-CFM-*` | bulk raw / formulation input | bulk raw (`RAW_MARKUP_CATEGORY`) | on item |
| 59 | **Co-Packing** | 13 | mixed | `10041`, `10042.V2` | co-pack service (refinement of 42) | production | line refinement |
| 275 | **Passthrough** | 12 | NonInvtPart | `DPS-SPJ-*`, `DPS-SWW-*` | pass-through charges | passthrough treatment | on item |
| 65 | **Secondary - Corrugated** | 11 | InvtPart | `C20011` | corrugated | — | on item |
| 168 | **Logistics** | 11 | — | — | logistics services | — | on item |
| 62 | **Formulation** | 8 | NonInvtPart | `OTC-0018` | formulation work | — | on item |
| 10291 | **R&D / Testing** | 6 | NonInvtPart | `Ro-TEST-06` | R&D / testing | service fee `rd` | on item |
| 6 | **Design** | 4 | NonInvtPart | `OTC-0020`, `DS-0005` | design work | — | on item |
| 1790 | **Turnkey** | 3 | **Assembly** | `BrainMD 355 Hydration 20ct Pouch(Assembly)` | turnkey assembly line | turnkey presentation | **line-level only** |
| 57 | **Creative** | 2 | — | — | creative services | — | on item |

Present in the account but unused on SO lines: `63 Development`,
`277 Labels` *(inactive)*, `376 Third Party Logistics` *(inactive)*.

**Non-product lines are classified exactly like product lines — by their item.**
Freight is not special-cased: it is item `OTC-0012`, whose record says Freight.
One-time charges are the `OTC-000x` family, whose records say One Time Charges.
Filling/co-pack are the numeric service items. **No duty or tariff class exists**
— those are not separately represented on legacy Sales Order lines.

## 4 · Item Groups and Assemblies

| observation | |
|---|---|
| `Group` items | **unclassed on the item record** — `10025 Fill & Assy Silk Rinse (G)`, `Cecred Silk Rinse Pouch Assembly(Group)`, `TCS-BAR-01`, `G-PK0000163` |
| `Group` lines | class predominantly **blank**; a few Group items do carry one (`PK0000310-EU` → 58, `PK0000648` → 10) |
| `Assembly` items | **unclassed** — `BrainMD 355…`, `Berry Hanks…`, `BrainMD-351…` |
| `Assembly` lines | some carry `1790 Turnkey` as a **line-level** application |

**Answer: Class belongs on the member lines, not on the Item Group line.** The
group header is a presentation wrapper and is normally unclassed. Since members
are ordinary items carrying their own classes, a grouped SO stays correctly
classified with no group-level class at all — which is also what B4's manual wrap
will produce, because the administrator wraps existing lines.

`1790 Turnkey` is a real but rare line-level convention (3 lines) applied to
Assembly items. It is **not** required for the Item Group path and should not be
adopted without Accounting saying so.

## 5 · Is the Nexus category a viable Class authority? — **No, not for V1**

`markup_defaults` holds **7** categories, against 19 classes in use:

```
Freight · Manufacturing · Other · Primary · Secondary · Soft Goods · Tooling
```

Coverage on actual cost lines (`assembly_leaf_inputs`):

| category | rows |
|---|---|
| **NULL** | **126** |
| Primary | 73 |
| Secondary | 72 |
| Soft Goods | 15 |
| `primary_packaging` | 6 ← dirty value, wrong convention |

Four independent disqualifiers:

1. **43% unpopulated** (126 of 292 rows carry no category).
2. **Too coarse** — 7 categories cannot express Secondary-Labels vs
   Secondary-Corrugated vs Cards/Booklets, which are 310 legacy lines.
3. **Packaging only.** `assembly_leaf_inputs.category` describes packaging lines.
   Nothing analogous governs production, freight, or one-time-charge lines.
4. **Already dirty** — `primary_packaging` alongside `Primary`.

And the structural objection outranks all four: adopting it would create a
**second authority for a value NetSuite already governs correctly** — Pattern 50's
compliance-basis problem, installed deliberately. When the two disagree, the
Nexus value would silently overwrite Accounting's own curated classification.

## 6 · Answers to the commissioned questions

| question | answer |
|---|---|
| Is `cost_category` / component category the correct governed source for **Packaging** line Class? | **No.** The NetSuite item record is, and it is already correct. The Nexus category is 43% null, 7-valued against 19 classes, packaging-only, and would become a competing authority. |
| What governs Class for **Production / Filling** lines? | The item record of the service item (`10018` → 42 Filling and Packout Services). `59 Co-Packing` appears as an Accounting line-level refinement. |
| What governs Class for **Freight** lines? | The item record — freight is item `OTC-0012`, class 60 Freight. Not a special case. |
| What governs Class for separately projected **one-time-charge** lines? | The item record of the `OTC-000x` item — 61 One Time Charges, or the more specific 62 Formulation / 6 Design / 10291 R&D where the fee has its own item. |
| Does a **turnkey/grouped** SO need Class on members, the Item Group line, or both? | **Members only.** Group/Assembly items are unclassed; members carry their own class. No group-level class required. |

## 7 · The repair this implies — for Edward's confirmation, not yet implemented

**Stop sending `class`. Let NetSuite apply the item-record class it already
holds.**

This **retains Class as a V1 requirement** and satisfies it from the correct
authority. It is not the removal that was held: that proposal would have left
lines unclassified. This leaves them classified — correctly, by Accounting's own
data, as SO2698 already demonstrates.

Scope, if confirmed:

- remove `body.class = { id: input.businessSegmentId }` from `sales-orders.ts`;
- **`cseg_dps_bus_seg` is a separate question and is untouched by this** — it is
  the Business Segment dimension. Note only that it is currently fed the same raw
  enum id and rejected alongside `class`; whether Business Segment should be
  projected at all, and from what, is its own disposition;
- correct the false type comment at `sales-orders.ts:70`;
- unblocks all 67 deals, and removes the misattribution affecting the 17
  currently passing by numeric collision.

**Residual gap to name honestly:** 62 items carry no class, including every
`Group` and `Assembly` item. Lines for those items would be unclassed — which is
exactly what legacy does today. If Accounting wants classes on those, the fix is
on the item records in NetSuite, where the rest of this data already lives.

**Held pending Edward's confirmation.** No payload change made. The historical
Nexus-SO correction review also remains held — though note that SO2698, the one
Nexus SO created without a class, is already correct.
