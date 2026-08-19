# Accounting UAT — NetSuite Sales Order review

Opened 2026-08-19, immediately after F1/F4 merged (`9de0692`, PR #303).

**First review order: SO2716** in sandbox `7924416-SB2`. It is the terminal
engineering certification witness and the starting point for Accounting's own
review — engineering has proved the projection is faithful to the accepted
quote; Accounting decides whether the resulting order is *operationally and
accounting-correct*, which is a different question and not one engineering can
answer.

---

## 1 · What Accounting is being asked to validate

Per order, across the matrix in §3:

| dimension | the question |
|---|---|
| item codes | is each line on the NetSuite item Accounting would have chosen? |
| item types | Inventory / Non-inventory / Other Charge / Service — correct for what the line *means*? |
| grouping | does the Item Group structure match how this should invoice? |
| quantities | do the transaction quantities read correctly for fulfilment and billing? |
| rates | is the per-unit rate the right commercial figure in the right place? |
| cost basis | is `costestimaterate` / `custcol_dps_unit_cost` a usable margin basis? |
| totals | does the order total reconcile to what the customer agreed? |
| terms & tax | are payment terms and NetSuite-derived tax right for this customer? |
| operational fit | can Ops actually fulfil, invoice and report against this order? |

**Engineering has already proved**, for SO2716, that the frozen accepted column
governs every commercial figure and that the order reconciles to
`tier_commercial_total` exactly. That is *not* what this UAT re-checks. See
`docs/validation/f1-f4-certification-walk.md` for that evidence.

---

## 2 · Case 0 — SO2716, ready for review now

| | |
|---|---|
| order | **SO2716** · internal `362441` · Pending Fulfillment |
| quote | DPS-1054 v2 · CERT-300 · Tier 2, 5,000 units |
| customer | `388800` ZZ-VALIDATION Nexus Certification Customer |
| commercial total | **$17,175.00** |
| tax (NetSuite-derived) | $1,030.50 |
| transaction total | **$18,205.50** |

| addr | item | type | qty | rate | amount |
|---|---|---|---|---|---|
| 1 | `76054` ZZ-CERT-KIT-G | Group | 5000 | — | — |
| 2 | `66476` DPS-BOTTLE-0001 | InvtPart | 5000 | 2.175 | 10,875 |
| 3 | — | EndGroup | — | — | 10,875 |
| 4 | `59157` OTC-0050 | NonInvtPart | 1 | 5,600 | 5,600 |
| 5 | `26348` OTC-0024 | NonInvtPart | 1 | 700 | 700 |

It already covers three matrix rows — turnkey Item Group, Direct Service, and
Item Group with separately billed OTC. Reviewing it first may settle questions
that change how the remaining fixtures should be built, which is why it goes
first rather than in sequence.

**Two specific questions for this order:**

1. The Direct Service line carries `costestimatetype = LASTPURCHPRICE`,
   `costestimaterate = 2500` against a $5,600 sell. Nexus sends no `unitCost`
   for a fee line — a zero would assert the fee is free — so NetSuite falls back
   to the item master. Is that the basis Accounting wants, or should Nexus send
   something, or should the item master change? (Carry-forward item A.)
2. Tax appears as a system line Nexus neither sends nor reconciles. Confirm 6%
   is right for this customer and ship-to, and that deriving it rather than
   sending a `taxCode` is the behaviour Accounting wants in production.

---

## 3 · The test-order matrix

Status reflects what actually exists today, verified by
`scripts/gate-1b/uat-readiness.ts`.

| # | case | exercises | fixture | mappings needed | status |
|---|---|---|---|---|---|
| 1 | Direct Product | flat line, no group, itemized presentation | **needs building** | none | ready to build |
| 2 | Turnkey Item Group | Group header, NetSuite expansion, member-rate PATCH | ✅ SO2716 | none | **covered** |
| 3 | Direct Service | quantity-1 top-level accounting line | ✅ SO2716 | `otc_formulation` ✅ | **covered** |
| 4 | Item Group + separately billed OTC | OD-006 — fee inside the group's SO structure, still quantity 1 | ✅ SO2716 | `otc_setup` ✅ | **covered** |
| 5 | Tooling / Artwork split | two governed destinations, distinct item types; legacy combined charge refused | CERT-302 is a **stub** — carries no tooling or artwork line | `otc_tooling` ❌ ambiguous · `otc_artwork` ❌ **no candidate** | **blocked** |
| 6 | Mixed commercial structure | Direct Product beside an Item Group on one order (P1/SO2713 proved no duplication) | **needs building** | none | ready to build |
| 7 | Freight / logistics | freight legs, duty, tariff, customs reaching the order | **needs building** | `otc_freight_duties_tariffs` ❌ · `otc_customs` ❌ | blocked on mappings |

### Case 5 is the one with a real gap

CERT-302 is named "tooling artwork split" but currently holds one assembly and
one grouped product — no tooling line, no artwork line. It is a placeholder, not
a fixture.

Worse, the destination it is meant to exercise has nowhere to post:

- **`otc_artwork` has no OTC-coded item in the sandbox at all.** The only match
  for "ARTWORK" is an unrelated inventory product. Accounting must either name
  an existing item or create one.
- **`otc_tooling` is ambiguous** — `OTC-0005` and `OTC-0046` are *both* named
  literally "OTC - Tooling". Their names cannot discriminate; usage history can,
  the way `OTC-0050` was chosen over `OTC-0018` for Formulation.

Until both are settled, case 5 cannot be walked, and a legacy combined
Tooling+Artwork charge will keep refusing with `legacy_combined_otc` — which is
correct behaviour, not a defect.

---

## 4 · Mapping state — 3 of 16 destinations mapped

| destination | item | id |
|---|---|---|
| `otc_filling` | BLD-FILL | 14525 |
| `otc_setup` | OTC-0024 OTC - Setup Charge | 26348 |
| `otc_formulation` | OTC-0050 OTC - Formulation Services | 59157 |

`otc_other_service` is per-line by design and is never mapped firm-wide.

The remaining twelve are unmapped. Candidates per destination:
`node … scripts/gate-1b/ns-destination-candidates.ts`. Summary of what it finds:

| destination | candidates | note |
|---|---|---|
| `otc_tooling` | OTC-0005 (4077), OTC-0046 (54062) | **identical names** — settle by usage |
| `otc_artwork` | none | **must be named or created** |
| `otc_freight_duties_tariffs` | OTC-0012 (21447) | single clean match |
| `otc_customs` | OTC-0036 (19840) | single clean match |
| `otc_testing` | OTC-0010, OTC-0016, OTC-0031, OTC-0055 … | 13 OTC-coded; needs a rule, not a pick |
| `otc_dies` | OTC-0002, OTC-0007, OTC-0008, OTC-0009, OTC-0019 | die *type* per item — may need per-line handling |
| `otc_print_plates` | OTC-0004 (4078), OTC-0032 (38450) | two |
| `otc_samples` | OTC-0013, OTC-0017, OTC-0022, OTC-0023, OTC-0039 | five |
| `otc_processing_fee` | OTC-0003 (4079) | single clean match |
| `otc_cartons` | OTC-0053 Master, OTC-0054 Inner | two, and they mean different things |
| `otc_packout` | none OTC-coded | search returns customer filling items |
| `otc_raws` | none OTC-coded | the "OTC - Ink Drawdowns" hit is a substring accident (D-`raw`-downs) |

**Where a destination has several fee items that genuinely differ** — dies,
samples, testing, cartons — a single firm-wide mapping may be the wrong shape,
and the per-line pattern already built for `otc_other_service` may be the right
answer. That is an Accounting judgement about what the fee *means*, and it is
worth settling before mapping rather than after.

---

## 5 · Carry-forward items

Non-blocking, brought forward from the F1/F4 walk.

**A · Cost basis on fee and service items.** Nexus sends no `unitCost` for an
OTC or Direct Service line, so NetSuite supplies its own default — on SO2716,
`LASTPURCHPRICE 2500` on the Direct Service and `ITEMDEFINED 0` on Setup.
Sending zero would assert the fee is free, which is worse. Accounting to confirm
what the margin basis on fee lines should be. *Owner: Accounting, during UAT.*

**B · Retire the legacy Direct Service mapping path.** Two maps are live
consumers today: `evaluateDirectServiceGate` reads
`netsuite_service_item_map` (keyed by service identity), while
`assessProjectionReadiness` reads `netsuite_destination_item_map` (keyed by
BV-011 destination). They were set to the same internal id during the walk so
they could not disagree — but two answers to "which item is this" is the shape
Pattern 58 exists to remove. Make the destination map the sole authority and
delete the legacy table and its Settings section. *Owner: engineering, cleanup.*

**C · Certification rollback-dialog copy.** The acceptance-rollback dialog says
the rollback is "a live CRM write Sales will see". Under certification mode it
is not — `unmarkAccepted` branches to `getDealStage`, a read. The copy does not
know about the mode. *Owner: engineering, cosmetic.*

**D · Review-screen Direct Service line shape.** The Sales Order review screen
renders a Direct Service in its *frozen* shape (`5,000 × $1.12`) while the order
posts it in its *emitted* shape (`1 × $5,600`). Same money, different line; the
operator reviews something other than what posts. Align the review to the
emitted representation. *Owner: engineering, UI.*

---

## 6 · Sequence

1. **Accounting reviews SO2716** against §1 and answers the two questions in §2.
2. **Accounting settles the mapping decisions** in §4 — at minimum `otc_tooling`
   and `otc_artwork`, which block case 5, and the freight/customs pair for
   case 7. The per-line-vs-firm-wide question for dies/samples/testing/cartons
   can follow.
3. **Engineering builds fixtures** for cases 1, 6 and 7, and turns CERT-302 from
   a stub into a real Tooling/Artwork fixture once (2) settles.
4. **Walk the remaining cases**, one SO each, on the ZZ-VALIDATION lineage.
5. **Carry-forward items** B, C and D land as cleanup alongside.
6. **Then**: full V1 sweep and harness rejuvenation.

---

## 7 · Standing constraints for every UAT walk

- **ZZ-VALIDATION lineage only.** Never a real customer deal.
- **Certification mode must be ON.** Verify at `/api/certification-status`
  before touching Mark Accepted — it must report `hubspotAcceptSync:
  SUPPRESSED` with both flag and provider suppressed. It is a release blocker to
  leave on at go-live; see `production-go-live-checklist.md`.
- **NetSuite writes go to sandbox `7924416-SB2`.** Confirm
  `netsuiteAccountIsSandbox: true` from the same endpoint.
- **A refusal is a result.** Where a case is expected to refuse — a provisional
  tier, a legacy combined charge, an unmapped destination — record the refusal
  message and verify nothing was posted, rather than working around it.
