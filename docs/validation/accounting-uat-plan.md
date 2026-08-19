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
| 5 | Tooling / Artwork split | two governed destinations, distinct item types; legacy combined charge refused | CERT-302 is a **stub** — carries no tooling or artwork line | `otc_tooling` ⚠ ambiguous · `otc_artwork` ⚠ ambiguous | **blocked on an Accounting choice** |
| 6 | Mixed commercial structure | Direct Product beside an Item Group on one order (P1/SO2713 proved no duplication) | **needs building** | none | ready to build |
| 7 | Freight / logistics | freight legs, duty, tariff, customs reaching the order | **needs building** | `otc_freight_duties_tariffs` ❌ · `otc_customs` ❌ | blocked on mappings |

### Case 5 is the one with a real gap

CERT-302 is named "tooling artwork split" but currently holds one assembly and
one grouped product — no tooling line, no artwork line. It is a placeholder, not
a fixture.

Worse, the destination it is meant to exercise has nowhere to post:

- **`otc_artwork` — CORRECTED 2026-08-19.** An earlier revision of this document
  claimed no OTC-coded artwork item existed and that Accounting would have to
  create one. **That was wrong**, and the error is instructive: the search used
  the single term `ARTWORK`, while the item is named
  **`OTC-0001` "OTC - Art / Prep / Proof"** (id 11012) — 29 transaction lines,
  Dec 2023 through Jul 2026, actively used. A single-term search returning
  nothing is evidence about one word, not evidence of absence (OD-027). The
  multi-term probe in `scripts/gate-1b/accounting-decision-evidence.ts` now runs
  six independent terms behind a control for exactly this reason.

  The real question is therefore a choice, not a creation: `OTC-0001` covers
  art, prep AND proof, while `OTC-0030` "OTC - Hard Proof" (2 lines, last used
  Oct 2025) is a narrower sibling.
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
| `otc_tooling` | OTC-0005 (4077, 23 lines, to Mar 2026), OTC-0046 (54062, 15 lines, to Mar 2026) | **identical names, BOTH current** — usage does not settle it |
| `otc_artwork` | OTC-0001 Art/Prep/Proof (11012, 29 lines), OTC-0030 Hard Proof (35159, 2 lines) | **corrected** — an earlier revision wrongly reported none |
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

## 5.5 · How Accounting's answers get handled

**Standing protocol, set 2026-08-19 before the answers arrived** — deliberately,
so it governs the responses rather than being reconstructed around them.

### Freeze while Case 0 is under review

No fixtures built, no destinations mapped, no production code changed while
Accounting is reviewing. The packet is a question; acting before the answer
would make it a rhetorical one.

### The packet separates three kinds of statement, and so must the answers

| kind | who owns it | example from Case 0 |
|---|---|---|
| **engineering-certified behaviour** | engineering, already proved | the order reconciles to the accepted total exactly |
| **observed NetSuite history** | neither — it is a fact | 1,276 OTC lines carry `CUSTOM` cost |
| **Accounting policy decision** | Accounting | whether fee lines should carry an explicit cost |

An answer that reads as policy but is really a request to change certified
behaviour gets flagged as such rather than absorbed.

### Record each decision verbatim

When a response arrives it is written into this document **word for word**,
attributed and dated, before any interpretation. Paraphrase happens in a
separate line underneath, marked as such. A decision summarised into the shape
the implementer expected is the failure mode this exists to prevent.

### Classify each decision

Every recorded decision carries exactly one classification:

| class | means | example |
|---|---|---|
| **mapping-only** | a row in the destination map; no code, no fixture | confirming `OTC-0012` for freight |
| **fixture-only** | a test order to build; no code change | Direct Product case |
| **production-code change** | Nexus behaviour changes | sending an explicit fee-line cost |
| **NetSuite master-data cleanup** | the item catalog changes | consolidating duplicate Tooling items |

### Reconcile before implementing

**Decisions sharing an architecture are implemented together, never
piecemeal.** A class of change split across slices produces N partial designs
converging on nothing.

Two cases are pre-dispositioned because they are already foreseeable:

**If Accounting chooses per-line selection for Testing / Dies / Samples /
Cartons / Print Plates** — that is **one governed extension of the existing
`otc_other_service` pattern**, not five feature slices. The per-line mechanism
exists and is certified; what changes is which destinations are declared
per-line, plus the Settings surface that stops presenting them as firm-wide
rows. One slice, one design, five destinations.

**If Accounting chooses an explicit fee-line cost basis** — **stop, and design
it separately before touching the Sales Order emitter.** The commercial freeze
is closed. Fee lines carry no unit cost in the quote today, so this is not a
mapping or a payload tweak: it needs a governed input, a decision about whether
that input is frozen at send like every other commercial figure, and an answer
to whether a cost basis is even commercial. Cost-basis governance must not be
smuggled in under an Accounting UAT ticket — that is exactly how a second
authority for a number gets established without anyone deciding to establish
one (Pattern 58).

### Then, and only then

The remaining matrix walks. The full V1 sweep and harness rejuvenation stay
queued behind a **green Accounting matrix** — not behind the decisions, behind
the walked and verified orders.

---

## 5.6 · DECISION RECORD — Case 0 dispositions

**Settled 2026-08-19. Source: Edward, relaying Accounting's dispositions.**

Recorded verbatim first, per §5.5. Interpretation appears only under an
explicit *Paraphrase* or *Reading* heading; anything not so marked is the
decision as given.

---

### Decision 1 — Fee/service cost basis: explicit CUSTOM cost

> Fee/service cost basis — explicit CUSTOM cost.
>
> Nexus should send an explicit cost basis for OTC and Direct Service lines
> rather than relying on ITEMDEFINED / LASTPURCHPRICE.
>
> Before adding any new operator field, trace whether the actual governed
> underlying cost already exists in Nexus and can be carried into the
> frozen/accounting representation. Reuse existing cost authority where
> possible. Only propose a new cost input if the required cost genuinely does
> not exist.
>
> Keep cost basis non-commercial: changing/reporting cost must not alter the
> frozen customer sell amount or REG-4.

**Classification: production-code change.**

**Gate:** implementation impact must be established and returned **before any
code is written** — specifically whether a governed cost authority already
exists in Nexus. A new operator input is a proposal of last resort, not a
starting assumption. See §5.7.

---

### Decision 2 — Tax: leave to NetSuite

> Tax — leave to NetSuite.
>
> Do not add explicit Nexus tax-code logic for V1. Ship-to should flow/default
> consistently with the HubSpot/customer lineage, and NetSuite remains
> responsible for deriving applicable tax.

**Classification: confirmation — no change to tax logic.**

Current behaviour (omit `taxCode`, let NetSuite derive) is ratified as V1
behaviour and needs no work.

**One sub-item is NOT a confirmation and must be verified rather than assumed:**
"Ship-to should flow/default consistently with the HubSpot/customer lineage."
SO2716's ship-to read *"default address on file in NetSuite"* — i.e. it defaulted
from the NetSuite customer record, which may or may not be what "flow from the
HubSpot/customer lineage" means. Verified in §5.7.

---

### Decision 3 — Tooling: use the more-used code

> Tooling — use the more-used code.
>
> Current evidence is:
>
> OTC-0005 — 23 lines
> OTC-0046 — 15 lines
>
> Therefore map Tooling to OTC-0005 unless a final full-history count
> materially contradicts the evidence already gathered. Record the measured
> basis for the selection.

**Classification: mapping-only.**

**Conditional.** The disposition is explicitly contingent on a final
full-history count. Measured basis recorded in §5.7 before the mapping is
written.

---

### Decision 4 — Artwork: OTC-0001 approved

> Artwork — OTC-0001 Art / Prep / Proof is approved.
>
> Use it as the governed Artwork mapping for V1. No additional Art/Prep/Proof
> split is required.

**Classification: mapping-only.** Unconditional; ready to apply.

---

### Decision 5 — Multi-meaning destinations: operator chooses per line

> Multi-meaning destinations — operator chooses per line.
>
> Testing, Dies, Samples, Cartons and Print Plates should use per-line NetSuite
> item selection.
>
> Extend the existing governed Other Service pattern rather than building five
> independent mechanisms:
>
> operator selects the appropriate NetSuite item on the applicable Costs line;
> selection is required before SEND when that line needs separate projection;
> selected item is frozen with the commercial snapshot;
> selection cannot change after SEND;
> readiness refuses an unresolved required selection;
> actual posted netsuite_item_id remains separate provenance.

**Classification: production-code change — ONE governed extension.**

Per §5.5's pre-disposition, this ships as a single slice covering all five
destinations, not five slices. The six clauses above are the acceptance
criteria, and each already has a counterpart in the certified
`otc_other_service` path — which is what makes this an extension rather than a
new mechanism.

**Not authorized for implementation yet.** Edward authorized *mapping and
fixture* work to proceed; this is neither.

---

### Disposition summary

| # | decision | class | status |
|---|---|---|---|
| 1 | explicit CUSTOM cost basis | production-code | **fully dispositioned** — §5.6b · live cost, 0 sent, no schema |
| 2 | tax left to NetSuite | confirmation | no work; ship-to sub-item verified §5.7 |
| 3 | Tooling → `OTC-0005` | mapping-only | **confirmed** — full-history rule; 12-mo tie does not change it |
| 4 | Artwork → `OTC-0001` | mapping-only | ready |
| 5 | per-line selection ×5 | production-code | **authorized** — trace smallest shared mechanism first |

---

## 5.6b · DECISION RECORD — Decision 1 final disposition

**Settled 2026-08-19. Source: Edward, relaying Accounting.** Verbatim.

> **Zero vs NULL**
>
> 0 is a valid explicit CUSTOM cost and must be sent as such.
> NULL means no governed cost is available.
> Do not treat zero as missing and do not substitute an item-master fallback
> when Nexus explicitly knows the cost is zero.
>
> **Cost timing**
>
> Use the live governed cost at SO push for V1, matching the certified product
> unitCost boundary.
>
> Product cost remains live as today.
> Direct Service cost = live contributionCostPerUnit.
> OTC cost = the governed underlying Production/fee cost already used as the
> economic source.
> Send CUSTOM whenever that governed cost is non-NULL, including explicit zero.
> Cost must not affect frozen quantity, sell rate, line amount, accepted total,
> or REG-4.
>
> Record the known boundary: a post-SEND cost change may change the accounting
> margin basis shown on the eventual SO while leaving the accepted commercial
> statement unchanged. Historical quote-time cost-basis reproduction is a
> separate future snapshot capability, not part of this UAT change.
>
> No schema and no new operator cost input are authorized.

**Classification: production-code change.** Option A from the impact analysis,
with the zero/NULL rule resolved against my recommendation to treat zero
cautiously — Accounting is right, and the reason is worth keeping: a governed
zero is a **statement about cost**, and suppressing it would substitute
NetSuite's item-master guess for a fact Nexus holds.

### The known boundary, recorded as instructed

Cost is read **live at push**, so it is not part of the commercial freeze.

> A cost edited after SEND may change the accounting margin basis shown on the
> eventual Sales Order, while the accepted commercial statement — quantity,
> sell rate, line amount, accepted total — remains exactly as the customer
> accepted it.

This is a deliberate, bounded consequence of Option A, not a defect. Draft-lock
means production inputs cannot normally change after send, so the window is
narrow; but it is real and is written down rather than discovered later.

**Historical quote-time cost-basis reproduction is explicitly out of scope** and
remains a separate future snapshot capability. Nothing in this change may be
read as establishing it.

---

---

## 5.7 · Verifications behind the dispositions

**Decision 3 — the conditional count.** Measured 2026-08-19 over full history,
three bases, plus a control confirming both item records are reachable:

| basis | `OTC-0005` (4077) | `OTC-0046` (54062) | leader |
|---|---|---|---|
| A · all transaction lines | **23** | 15 | OTC-0005 |
| B · distinct transactions | **18** | 10 | OTC-0005 |
| C · by record type | 23, all `salesorder` | 15, all `salesorder` | OTC-0005 |
| recency · last 12 months | 5 | 5 | **tied** |

All three full-history bases agree, and basis C establishes the count is not
contaminated by purchase orders or invoices — both items appear only on Sales
Orders. **No material contradiction; the disposition stands.** Tooling maps to
`OTC-0005` (internal id 4077).

Recorded alongside it, because it is true and the disposition did not ask about
it: the lead is **historical, not current**. Over the last twelve months the two
items are used equally (5 and 5). If Accounting's intent was "the one we use
now" rather than "the one we have used most", that is worth one more word from
them — the mapping is trivially changed.

Re-runnable: `scripts/gate-1b/tooling-full-history.ts`.

**Decision 2 — the ship-to sub-item.** Verified rather than assumed. Nexus sends
**no ship-to field at all** — `buildSalesOrderPayload` contains no shipping
address, only `shipDate`. NetSuite defaults the address from the customer
record, and that customer was resolved from the HubSpot company through the
governed customer map. So ship-to does flow from the HubSpot/customer lineage,
indirectly and by omission rather than by transmission. **Consistent with the
disposition; no work.** Worth stating explicitly so nobody later assumes Nexus
transmits an address it does not.

---

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
