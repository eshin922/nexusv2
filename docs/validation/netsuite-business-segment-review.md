# `cseg_dps_bus_seg` — Business Segment authority review

**2026-08-12 · sandbox `7924416_SB2` · read-only investigation**

Commissioned because Business Segment was fed the same raw HubSpot enum id as
Class and was rejected in the same CREATE. Class being settled establishes
nothing here — they are different dimensions with different authorities.

**It comes out the opposite way from Class, and the contrast is the finding.**

---

## 1 · What the taxonomy is

| | |
|---|---|
| NetSuite record | `CUSTOMRECORD_CSEG_DPS_BUS_SEG` · internal id **987** · **"Business Segment"** |
| Kind | custom **segment** (a real dimension, not a custom body list) |
| Sibling segments in the account | `CUSTOMRECORD_CSEG1` Product Category · `CUSTOMRECORD_CSEG2` Product Type · `CUSTOMRECORD_CSEG_PAACTIVITYCODE` Activity Code |

**The value names are NOT readable through this integration.** Both routes fail:

- SuiteQL — `Record 'customrecord_cseg_dps_bus_seg' was not found`
- REST record API — `Permission Violation: You need a higher permission for
  value management of custom segments`

Same class of limit as SuiteScripts and saved searches (§12). So the review
below establishes the **alignment** empirically and is explicit that it cannot
establish the **semantics**.

## 2 · Valid internal ids, from actual use

| id | legacy SOs | most recent |
|---|---|---|
| **3** | **524** | 2026-07-22 |
| **1** | **139** | 2026-07-28 |
| **7** | 11 | 2026-03-24 |
| *(none)* | 25 | — |

**674 of 699 Sales Orders carry a Business Segment — 96.4%.** This is
load-bearing, current data, not residue. Ids `1` and `3` are both in active use
within the last month.

## 3 · What the HubSpot values mean

`business_segment` is a two-option enum:

| value | label |
|---|---|
| `1` | `Product 360°` |
| `3` | `DPS Packaging` *(trailing tab in the label — data-hygiene item)* |

These are **business units / service lines**, and — the point that sank Class —
they are nothing like the NetSuite `classification` taxonomy. But Business
Segment is a different target, and must be judged on its own evidence.

## 4 · Governed mapping, or another collision? — **governed**

Numbers matching proves nothing, so this was tested against reality: for real
legacy Sales Orders, does **the same deal** carry **the same value** on both
sides? 91 SOs sampled, stratified across all three NetSuite values, with live
HubSpot reads.

| HubSpot | → NetSuite | count |
|---|---|---|
| `3` | `3` | **40 / 40** |
| `1` | `1` | **40 / 40** |
| `1` | `7` | 11 / 11 |

**80 of 91 identical (87.9%), with zero counter-examples inside the `1`→`1` and
`3`→`3` strata.** Two independent id spaces agreeing on the same deal 80 times
with no contradiction is not coincidence. **The ids are genuinely aligned.**

The 11 divergences are not errors and not random: they are the **entire**
NetSuite `7` population, and every one comes from a HubSpot `1` deal. `7` is a
value HubSpot cannot express (the enum has two options), last used 2026-03-24.
That is a **NetSuite-side refinement** — structurally the same phenomenon as the
Class line-level refinements, applied by whoever works the order in NetSuite.

**Contrast with Class, which is the whole reason these needed separate reviews:**

| | Class | Business Segment |
|---|---|---|
| HubSpot `3` | not a valid class → **rejected** | valid id, 524 SOs |
| HubSpot `1` | collides with class `1` *Primary* → **silently wrong** | genuinely means the same thing |
| id spaces | unrelated taxonomies | **empirically aligned** |
| verdict | invalid competing authority | **valid projection** |

## 5 · Does NetSuite default it? — **No.** This is decisive.

`SO2698`, created by Nexus, transmitted neither `class` nor `cseg_dps_bus_seg`
(§11.1: six header keys). What came back:

| field | result |
|---|---|
| line **Class** | **populated correctly** — 10 Secondary / 58 Soft Goods / 1 Primary, from the Item record |
| header **Business Segment** | **blank** |

One order answers both questions and answers them differently. **Class has an
Item-record default; Business Segment has none.** Omitting Class loses nothing.
Omitting Business Segment loses a field 96.4% of legacy orders carry, with
nothing to restore it.

## 6 · Disposition of the four options

| option | verdict |
|---|---|
| **map it** (build a translation layer) | **No** — there is nothing to translate. The ids already correspond; a mapping table would restate `1→1, 3→3` and become a second thing to maintain. |
| **let NetSuite derive/default it** | **No** — proven impossible. SO2698 shows no default exists. |
| **omit it** | **No** — would drop a field on 96.4% of orders with no fallback. |
| **preserve the current projection** | **Yes** — it reproduces exactly what legacy carries for every value HubSpot can express. |

**Recommendation: preserve `business_segment_id → cseg_dps_bus_seg`, unchanged,
at header level** (legacy populates the header on 674 SOs; Nexus already sends
header).

Two residuals to name rather than paper over:

1. **The `7` refinement is unreachable from HubSpot.** Nexus will emit `1` where
   NetSuite practice sometimes refines to `7`. Same shape as the Class line-level
   refinements, and handled the same way — in NetSuite, by the people who make
   that distinction. Value `7` has not been used since 2026-03-24 and may be
   retired.
2. **Semantics are asserted from alignment, not from names**, because the
   taxonomy is permission-blocked. If Accounting can confirm NetSuite Business
   Segment `1` = *Product 360°* and `3` = *DPS Packaging*, this closes fully.
   The 80-order agreement is strong evidence but is not a label.

## 7 · Is `cseg_dps_bus_seg` safe for the next Case B CREATE? — **Yes**

Nemah's `business_segment_id` is **`3`**.

1. `3` is a valid, active Business Segment internal id — **524 legacy SOs**, most
   recent **2026-07-22**.
2. The CREATE rejection named **`class`** specifically. Class `3` is invalid;
   Business Segment `3` demonstrably is not.
3. **A validation rejection does not consume the deal** — proven today, not
   assumed: after the failed CREATE, `58332160883` still carried 0 Sales Orders.

**No non-destructive proof of acceptance exists.** There is no dry-run, the
taxonomy record is permission-blocked, and confirming by writing to a historical
transaction is forbidden. So the only proof is the CREATE itself — and that is an
acceptable risk precisely because its failure mode is non-consuming and already
demonstrated. Either it succeeds and Case B proceeds, or it fails and the deal
remains free for the next attempt.

**Both dimensions are green for the next attempt:** Class no longer emitted;
Business Segment emitting a valid, in-use value. No change is required to
`cseg_dps_bus_seg` before retrying.
