# Accounting Review Set — execution runbook

Targets approved. **Execution NOT started.** Preparation below is complete and
read-only; the mutation sequence is deliberately not begun in this session — see
§5.

---

## 1 · Preflight, re-run at approval time

B, C and D re-confirmed **SO-FREE**, status deliberately not filtered. All three
replacement-A candidates in §1b are also SO-free:

```
A · flat control       WITHDRAWN — replacement pending approval (§1b)
B · single Group       59153706532   SO-FREE ✓
C · multi-Group        59184980904   SO-FREE ✓
D · Group + freight    59815074352   SO-FREE ✓
```

**Re-run this per deal immediately before each CREATE.** It is cheap and the
window between now and execution is not zero.

---

## 1b · Order A target WITHDRAWN — replacement candidates

**HANKS `54020672837` is withdrawn.** Its live amount is **$1,800,000** and the
review order would temporarily overwrite it to ~$4,500. That is unnecessary
commercial exposure for a fixture. B / C / D remain approved and staged.

Read-only discovery, ranked by the stated preference order. Note that
preference **6** (zero quotes / empty drafts only) outranks **7** (lower
amount) — an initial scoring pass let amount dominate and surfaced two
unusable candidates:

- **Epicuren `40473295522`** — $5,000 with deposit Terms, but **14 quotes, 45
  leaves, 18 assemblies, 1 non-draft**. A live working project. **Disqualified
  on 6.**
- **Smart Pressed Juice `58222880425`** — **disqualified**: carries the S-7
  preservation population and a `ZZ-VALIDATION` scenario.

**No remaining candidate satisfies both preference 5 (existing Nexus project)
and 6 (clean).** Every clean candidate needs a project import first. Since 5 is
*preferred* and 6 is close to mandatory for a fixture, all three below trade 5
for 6.

### A1 — HANKS · Sample Shipping Charges · deal `45429836294` — **recommended**

| | |
|---|---|
| Amount | **$685.92** — ~2,600× less exposure than the withdrawn target |
| Customer | 329665 HANKS · **ACTIVE** · subsidiary 2 |
| Terms | **50% Deposit/balance at shipment** ✓ (pref 8) |
| Business Segment | **1** ✓ (pref 9) |
| Nexus content | **0 quotes — CLEAN** ✓ |
| Nexus project | none — requires project import |
| Live | stage `195274339` · amount `685.92` · closedate 2025-10-09 |

**Why this one.** Same HANKS customer as the withdrawn target, so the deliberate
Terms/Segment diversity of the original set is preserved exactly — deposit-style
Terms and Segment 1 against B/C/D — while the exposed amount drops from $1.8M to
$685.92. It satisfies every preference except 5.

### A2 — MISTR · Pouch · deal `41604195598`

| | |
|---|---|
| Amount | **$1** — lowest non-zero exposure |
| Customer | 321443 heymistr.com · ACTIVE · subsidiary 2 |
| Terms | 50% Deposit/balance at shipment ✓ |
| Business Segment | **3** (not 1) |
| Nexus content | 0 quotes — CLEAN ✓ |

A **fourth distinct customer** across the set, which is the strongest lineage
diversity available. Costs Business Segment 1.

### A3 — Kirby Beauty · Cécred Silk Rinse · deal `61961680180`

| | |
|---|---|
| Amount | **$0** — zero exposure |
| Customer | 167468 Kirby Beauty LLC · ACTIVE · subsidiary 2 |
| Terms | Net 30 (not deposit) |
| Business Segment | 1 ✓ |
| Nexus content | 0 quotes — CLEAN ✓ |

Lowest possible exposure, but **shares customer 167468 with Order C**, so A and C
would carry identical Terms and customer — weakening the control contrast and
collapsing two of the four lineages into one.

All three confirmed **SO-free**, active, subsidiary 2, governed Terms present.
**None mutated.**

---

## 2 · What restoration actually has to cover — corrected

`updateDealStage` writes **`dealstage` AND `amount` in one `basicApi.update`
call**. It does **not** write `closedate`.

So:

| property | Nexus writes it? | obligation |
|---|---|---|
| `dealstage` | yes | **restore to captured value** |
| `amount` | yes — set to the accepted tier's turnkey total | **restore to captured value** |
| `closedate` | **no** | capture, then **verify unchanged** |
| `hs_lastmodifieddate` | derived | capture only, as evidence of the write window |

Restoring `closedate` would be describing a write Nexus never makes. Verifying it
unchanged is the honest check, and it also catches an unexpected write if one
ever appears.

Both restorable properties go back through the same governed/narrow repair path:
`updateDealStage(dealId, capturedStageId, { amount: capturedAmount })`.

### Rules, binding

1. **Restore by exact stage id, never by label.** `updateDealStage` accepts
   either, and label-matching is case-insensitive text against a pipeline that
   can be renamed. The captured id is the only stable handle. B already sits at
   `195274340`, a different stage from the rest — a label assumption would be
   wrong for it first.
2. **Do not proactively write `closedate`.** Nexus does not send it. Writing it
   "to be safe" would manufacture a modification that never happened and make
   the deal's audit trail lie about what Nexus touched.
3. **If `closedate` changes despite Nexus not sending it — STOP.** Do not repair
   it. Classify it first as **HubSpot stage-transition behaviour**: some
   pipelines set or clear `closedate` on entering a closed stage. That is a
   provider behaviour finding with implications well beyond this review set, and
   silently patching the value would erase the only evidence of it.
4. **Verify live by re-reading.** Restoration is confirmed by a fresh
   `getById`, never by the write call's return value. A write that reports
   success and a field that actually holds the right value are different claims.

### Captured baseline — 2026-08-12, read-only

Re-capture immediately before each Accept per the brief. These are recorded as a
**cross-check**: if the pre-run capture disagrees with the row below, something
moved the deal in between and that must be understood before proceeding.

| | Deal | `dealstage` | `amount` | `closedate` | `hs_lastmodifieddate` |
|---|---|---|---|---|---|
| ~~A~~ | ~~54020672837 Hanks~~ | — | — | — | **WITHDRAWN — $1.8M exposure (§1b)** |
| **B** | 59153706532 Root | `195274340` | 10000 | 2026-06-02T00:16:34.596Z | 2026-07-23T18:56:09.124Z |
| **C** | 59184980904 Kirby | `195274339` | 30000 | 2026-09-30T16:35:04.876Z | 2026-08-06T05:09:49.787Z |
| **D** | 59815074352 Nemah | `195274339` | 10000 | 2026-06-01T19:29:13.908Z | 2026-07-16T17:50:19.703Z |

> A is WITHDRAWN (§1b) precisely because it carried a live amount of 1,800,000
> against a ~4,500 fixture. Its replacement is pending approval; capture its
> baseline at execution time. B is already at `195274340`, a different stage from
> the other two here — restore by **id**, never by label.

---

## 3 · Per-order sequence (atomic — each ends restored)

Run A → B → C → D, **one order at a time as an atomic unit**:

```
zero-SO preflight → HubSpot capture → fixture → Send/Accept → NetSuite CREATE
  → provider verification → HubSpot restore → live restoration verification
  → Accounting matrix
```

**Do not begin the next order until the prior deal is fully restored and
verified live.** This is the property that matters: an interruption between
orders can then never leave more than zero real CRM deals mutated.

1. Re-run zero-SO preflight for **this** deal.
2. Capture `dealstage`, `amount`, `closedate`, `hs_lastmodifieddate` live.
   Compare to §2; investigate any drift before continuing.
3. Build the scenario in Nexus, labelled `NEXUS V1 ACCOUNTING REVIEW — SANDBOX`.
4. Send → Accept → Complete (NetSuite SO push via the certified path).
5. Capture the resulting SO: tranid, internal id, line structure, group masters.
6. **Restore** `dealstage` + `amount` to captured values.
7. **Verify live**: all three of stage, amount, closedate re-read from HubSpot
   and compared. Do not report restoration from the write's return value —
   re-read.
8. Record the expected-vs-observed matrix.

**If an order exposes a parity or correctness defect:** stop that order, classify
it, and do not start the next one if the defect could affect subsequent review
artifacts.

---

## 4 · Structures (approved)

| | detail_level | Structure | Expected |
|---|---|---|---|
| **A** | `itemized` | Bottle 1,000 @ 2.50 · Box 1,000 @ 1.25 · Filling 1,000 @ 0.75 | **4,500.00** |
| **B** | `turnkey_only` | 1 Group qty 1,000 · Box @1.10 + Bottle @2.40, qtyPerParent 1 | **3,500.00** |
| **C** | `turnkey_only` | Group A (Box+Bottle) qty 1,000 = 3,500 · Group B (Bottle @2.05) qty 500 = 1,025 | **4,525.00** |
| **D** | `turnkey_only` | 1 Group qty 1,000 = 3,500 + Freight 500 / Duty 100 / Tariff 50 | 3,500 + 650 |

Master member quantities are **`qtyPerParent`**, never tier-expanded. No
`1,000,000` member quantity may appear. All multiplicities in D are **1**.

Members: `DPS-BOTTLE-0001`, `10064-GNX-Box`, `CC-12oz-Filling-1.4` — all with
proven HubSpot lineage and prior successful item resolution.

---

## 5 · Why execution has not started

The mutation sequence is four irreversible NetSuite sandbox creates plus eight
HubSpot writes on **real commercial deals**, one of which carries an amount of
1,800,000.

The specific failure this avoids: mutating a deal's stage and amount, then
running out of session capacity before the restore step. That would leave a real
deal misstated with no one aware of it. The capture/restore contract is only
worth anything if the restore reliably happens, and starting a sequence I cannot
guarantee to finish would trade a governed process for an ungoverned one.

Everything that could be prepared safely has been: preflight green, capture
mechanism exercised end-to-end against live HubSpot, baselines recorded,
restoration obligation corrected from stage-only to stage + amount, structures
fixed, sequence written to be atomic per order.

A fresh session executes §3 four times.

---

## 6 · Evidence retention

- **Do not delete** the four Sales Orders or their deterministic Item Groups.
- Specification fields (PP / SP / SGA / COP) are **left unpopulated** and marked
  *Pending OD-024 — Nexus Product Specifications mapping*, so Accounting reads
  them as intentionally absent rather than accidentally omitted.
- Mixed / Direct Component order **E** remains held until `OD-023 → OD-022`
  close (OD-026 also gates OD-022).

## 7 · Evidence qualification — A vs B

Recorded per instruction: the current runtime still uses **`detail_level`** to
select flat versus grouped Sales Order projection. OD-022 has dispositioned that
this coupling will be removed — `detail_level` becomes customer-presentation-only
and **Product Structure becomes the ERP grouping authority**.

A and B are therefore valid Accounting review artifacts for the **resulting
NetSuite structures**. Accounting is **not** being asked to approve
`detail_level` as the permanent grouping authority, and their review must not be
treated as governance evidence against the OD-022 disposition.
