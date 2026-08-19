# F1/F4 — certification walk against a real NetSuite Sales Order

Run 2026-08-19 on branch `feat/f1-f4-so-projection` (PR #303), Preview
deployment at commit `05a8c06`. Authorized by Edward; permanent ZZ-VALIDATION
lineage only.

**Result: SO2716 (internal `362441`) created in NetSuite sandbox `7924416-SB2`.
All eight proof points pass.**

---

## 1 · What was walked

| | |
|---|---|
| quote | DPS-1054 · `97d25286-2c42-4a72-8979-89f1a5c2cf26` · CERT-300 frozen line set |
| project | `d9dc519a-9965-4dd2-8b4a-f48cf2bf5a7a` — ZZ-VALIDATION Nexus Certification Lineage |
| customer | NetSuite `388800` · HubSpot deal `64142757296` |
| accepted tier | Tier 2 — 5,000 units · frozen `tier_commercial_total` **$17,175.00** |
| snapshot | `c77ce198-4c71-4e7f-a772-4e65b47a4645` · `detail_level = turnkey_only` |
| Sales Order | **SO2716** · internal `362441` · Pending Fulfillment |

The pre-cutover v1 snapshot is **retained superseded**, not patched. It carries
the pre-`b84ff34` quantity semantics and stays as historical evidence; the walk
re-sent so the corrected matrix became the current artifact.

---

## 2 · Preparation

**Mappings** (Settings → NetSuite). Both destinations were unmapped; both were
chosen from the sandbox catalog by evidence rather than by preference.

| destination | item | internal id | why this one |
|---|---|---|---|
| `otc_setup` | `OTC-0024` OTC - Setup Charge | 26348 | only candidate; Non-inventory, matching BV-011 |
| `otc_formulation` | `OTC-0050` OTC - Formulation Services | 59157 | supersedes `OTC-0018`; usage runs Jun 2025 → Jul 2026 where 0018 stops Feb 2025 |
| Direct Service *Formulation* (legacy map) | `OTC-0050` | 59157 | same item, so the gate and readiness cannot disagree |

The legacy Direct Service map and the BV-011 destination map are **both** live
consumers today — the gate reads the first, readiness the second. They were set
to the same internal id deliberately. Retiring the legacy map is the clean fix.

**Suppression, verified three ways before anything was touched:**
`/api/certification-status` on the Preview reported `hubspotAcceptSync:
SUPPRESSED` with both flag and provider suppressed; the Acceptance tab rendered
"HubSpot Accept synchronization is disabled for certification"; and the
recorded acceptance returned "HubSpot deal not modified (certification)".

---

## 3 · Post-send pre-flight (the gate that could have stopped the walk)

Re-run immediately after SEND, against the new snapshot. All four required
conditions held:

- **corrected quantities** — Setup now `quantity = 1` at every tier. It was
  1000 / 5000 / 10000 before, so `quantity × rate` read $140,000 for a $140
  charge and REG-4 link A refused it.
- **governed destinations populated** — `otc_formulation` and `otc_setup`
  recorded on the frozen rows. They were NULL on the v1 snapshot, which would
  have refused the OTC line as `destination_not_recorded`. This was an
  independent second reason the re-send was required.
- **turnkey structure** — `detail_level = turnkey_only` on quote and snapshot;
  the product line is `item_group_member` under assembly `16c4a6fe`, and the
  Setup line carries the same owning assembly per OD-006.
- **no unexpected blockers** — `assessProjectionReadiness` returned exactly one
  blocker, `no_accepted_tier`, the deliberate state.

---

## 4 · Proof point 8 (run first, deliberately) — provisional tier refuses

Tier 3 is `total_is_provisional = true`; its Formulation line is
`quote_on_request`. It was accepted **on purpose** and pushed.

The push refused:

> Blocked — this Quote's Sales Order cannot be built from the column the
> customer accepted. Tier 3 was quoted as a provisional total — at least one
> line is still "quote on request". Price every line and re-send before
> pushing. Nothing was posted.

"Nothing was posted" was then verified rather than believed:

- `quotes.netsuite_so_id` / `tranid` / `push_status` / `pushed_at` — all NULL
- **zero rows in `netsuite_so_pushes`** — the refusal preceded even the
  durable-attempt insert, which lives at STEP 7; the projection gate is STEP 3.5
- no `quote_completed` audit row

The acceptance was then rolled back and re-recorded at Tier 2. The rollback
performed **no** HubSpot write: `unmarkAccepted` branches on certification mode
and reads `getDealStage` instead, on the stated grounds that the matching
Accept never moved the deal.

---

## 5 · The order NetSuite actually holds

Read back from the provider, not from what Nexus believes it sent:

| addr | item | type | qty | rate | amount |
|---|---|---|---|---|---|
| 1 | `76054` ZZ-CERT-KIT-G | **Group** | 5000 | — | — |
| 2 | `66476` DPS-BOTTLE-0001 | InvtPart (member) | 5000 | 2.175 | 10,875 |
| 3 | — | **EndGroup** | — | — | 10,875 |
| 4 | `59157` OTC-0050 | NonInvtPart | **1** | 5,600 | 5,600 |
| 5 | `26348` OTC-0024 | NonInvtPart | **1** | 700 | 700 |

### The eight proof points

1. **Item Group structure preserved** — one Group header, one expanded member,
   one EndGroup. NetSuite performed the expansion; Nexus did not flatten it.
   The group was **created** this run as `nxs-grp-8a570244…`, its definition
   read back and verified before the order referenced it.
2. **Member expansion and PATCHed rates reproduce frozen amounts** — group
   quantity 5000 × member qty-per-group 1 = 5000 units at the patched rate
   2.175 = **$10,875.00**, equal to the frozen line amount exactly.
3. **Direct Service posts as a top-level quantity-1 line** — item `59157`,
   quantity 1, rate 5,600, at address 4 — after EndGroup, so outside the group.
4. **OTC posts through its governed destination at quantity 1** — item `26348`,
   the `otc_setup` mapping, quantity 1, rate 700.
5. **Provenance matches what actually posted** — `netsuite_item_id` written on
   all three frozen lines (59157 / 66476 / 26348), each present on the order;
   `posting_provenance: { written: 3, error: null }`.
6. **Post-grouping REG-4 equals the frozen total exactly** — Σ commercial line
   amounts = **$17,175.00** = `tier_commercial_total`, to the cent. The audit
   row carries `frozen_accepted_total: "17175.00"` and `amount_pushed: 17175`.
7. **`unitCost` is reporting-only** — on the member line, `rate = 2.175`
   (commercial, frozen) and `costestimaterate = 1.5` (governed cost,
   `costestimatetype = CUSTOM`). Separate fields; the cost value appears as
   neither a rate nor an amount.
8. **No live costing value determines a customer-commercial amount** — see below.

### Why proof 8 is not vacuous

"The order matches the frozen column" would prove nothing on its own. Nothing
edited costs between send and push, so the live rollup and the frozen matrix
currently **agree** — and a figure matching both sources is evidence for
neither. That is Pattern 56 exactly: a property holding by coincidence reads
identically to one holding by construction.

The decisive evidence is the two lines the live path **cannot produce at all**.
Before this cutover `markComplete` emitted no OTC line and no Direct Service
line from any code path.

```
order total                     $17,175.00
of which OTC + Direct Service   $ 6,300.00
```

A live-derived order would have posted **$10,875.00** — and reconciled
perfectly against its own remaining lines, which is the under-billing this
slice closes. $6,300 of SO2716 exists only because the frozen projection
produced it.

The audit row states the same fact directly: `commercial_source:
"frozen_accepted_tier"`.

---

## 6 · Two things the walk surfaced, neither blocking

**a · NetSuite-derived tax sits outside the certified figure.** SuiteQL shows a
system line (item `-519`, rate 6) adding **$1,030.50**, so the transaction total
is **$18,205.50** against a commercial total of $17,175.00. This is correct and
intended: the payload deliberately omits `taxCode` so NetSuite derives per-line
tax from customer and ship-to. Recorded here so nobody later reads $18,205.50 in
NetSuite and concludes the order disagrees with the quote. REG-4 governs the
commercial lines; tax is NetSuite's, and Nexus neither sends nor reconciles it.

**b · The accounting lines carry NetSuite's own cost defaults.** Nexus sends no
`unitCost` for a fee line — a zero there would assert the fee is free — so
NetSuite falls back to the item master. On SO2716 that gives the Direct Service
line `costestimatetype = LASTPURCHPRICE`, `costestimaterate = 2500` against a
$5,600 sell, and the Setup line `ITEMDEFINED` / `0`. Both are reporting bases
with no commercial effect, but Accounting should see them during UAT and say
whether a $2,500 cost basis on that item is what they want.

**c · Minor UI copy gap.** The acceptance-rollback dialog says the rollback is
"a live CRM write Sales will see". Under certification mode it is not — the
action branches to a read. The copy does not know about the mode. Cosmetic.

**d · Review-screen line shape.** The Sales Order review screen renders the
Direct Service as `5,000 × $1.12`, its frozen row, while the order posts it as
`1 × $5,600`, its emitted shape. Both are $5,600 and the total is unaffected,
but the operator sees a different line shape from the one that posts. Worth
aligning; not a commercial defect.

---

## 7 · Reproducing this

All read-only, all safe to re-run:

```
node --env-file=.env.local --experimental-strip-types --conditions=react-server \
  --experimental-loader ./scripts/support/src-resolver.mjs \
  scripts/gate-1b/cert300-preflight.ts        # frozen matrix + readiness gate
  scripts/gate-1b/cert300-push-state.ts       # what the push left behind
  scripts/gate-1b/cert300-so-evidence.ts      # SO read-back vs frozen column
  scripts/gate-1b/cert300-cost-isolation.ts   # proofs 7 and 8
  scripts/gate-1b/ns-item-candidates.ts       # destination mapping candidates
```

`cert300-so-evidence.ts` is the one to re-run if anyone doubts the reconciliation:
it reads SO2716 from NetSuite and compares it line by line against the frozen
accepted column in integer cents.

---

## 8 · Instrument faults found while building this evidence

Both were caught by controls rather than by the checks passing, and both would
have produced confident false claims:

- **`suiteQL` returns `{ items, hasMore }`, not a bare array.** The first
  candidate probe treated it as an array, so every query printed "(none)" —
  including the control row, which is known to exist. Without that control the
  output would have read as "the sandbox has no such items."
- **A failed read and an empty result were the same output.** Fixed to report
  READ FAILED as indeterminate, per OD-027.

A third, in the cutover commit itself: breaking the **product** line's frozen
quantity left the suite green because the assertion was still satisfied by the
**accounting** line's identical text. The check now forbids the live multiply
itself.

---

## 9 · Status

Eight of eight proof points pass against a real Sales Order. F1/F4 is ready to
close; Accounting UAT can begin on SO2716.

Retained as certification evidence: **SO2716** in sandbox `7924416-SB2`, and
frozen snapshot `c77ce198-4c71-4e7f-a772-4e65b47a4645`.
