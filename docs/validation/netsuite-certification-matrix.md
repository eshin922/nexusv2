# NetSuite certification matrix — the fewest artifacts that prove four mechanisms

**Status:** proposed. **Nothing created, nothing completed.** Blocked on the
deployed-target gate below.
**Date:** 2026-08-13

---

## 0 · Blocking gate — not satisfiable from this side

Before any provider write:

| | required |
|---|---|
| `NETSUITE_ACCOUNT_ID` (Vercel **Preview**) | `7924416_SB2` |
| `NETSUITE_ENV` (Vercel **Preview**) | `sandbox`, or absent (inference then yields sandbox from the `_SB2` suffix) |

**Both values are needed, and the second is not redundant.**
`assertWriteAuthorized` fails closed on a production account — but `env` is
`process.env.NETSUITE_ENV ?? inferEnv(accountId)`, so an explicit
`NETSUITE_ENV=sandbox` on a production account overrides the inference and
re-opens the write. Reading only the account would leave that hole unexamined.

**I cannot read Vercel configuration.** No runtime probe answers this either:
the only NetSuite read reachable from the UI is `resolveGovernedPaymentTerms`
→ `getRecord` (via the Quote surface), which proves the credentials work but not
which account they belong to — the same customer exists in both.

**Honest limitation.** A dashboard read proves *configuration*, not the running
process, and CERT-ENV-1 is the standing evidence that those can differ. The
compensating control here is different from the suppression case: an incorrect
account fails closed at `assertWriteAuthorized` unless `NETSUITE_ENV` masks it,
which is exactly why both values are recorded together.

---

## 1 · What must be proven

| # | mechanism | where the cost is written |
|---|---|---|
| **M1** | Direct Product end-to-end projection | — |
| **M2** | Unit Cost on a Direct line | **at CREATE**, in the payload |
| **M3** | Unit Cost on Item Group members (`20da735`) | **post-expansion**, scalar PATCH |
| **M4** | Mixed Direct + Item Group provider behaviour | — |

**M2 and M3 are different mechanisms, not one mechanism on two shapes.** A Direct
line carries `costEstimateType` / `costEstimateRate` in the CREATE body. An Item
Group member does not exist at CREATE — NetSuite expands it from the group, so
its cost can only be written afterwards by scalar PATCH against the expanded
line. **A Direct artifact therefore cannot certify M3, and no amount of Direct
evidence substitutes for it.**

**One further constraint that decides fixture shape:** the Item Group path only
runs at `detail_level = turnkey_only`. An itemized quote emits flat lines for
group members, whose costs are set at CREATE — that re-proves M2 and proves
nothing about M3. **Any M3 artifact must be `turnkey_only`.**

---

## 2 · M4 is a probe question, not an artifact question

The unknown in M4 is provider behaviour: does NetSuite duplicate when a group
line and an **unrelated** flat line arrive in one CREATE? Probe 7a observed
duplication for members sent alongside *their own* group — a different payload
shape that settles nothing here.

Answering that with a governed artifact would make the artifact the experiment.
If NetSuite doubles the order, the doubled order is a real one. The cheapest
correct instrument is a disposable SO, exactly as the writability and member-PATCH
probes were run.

**P1 — disposable mixed-payload probe.** One throwaway sandbox Sales Order:
one Item Group line plus one unrelated flat line, single CREATE. Read back the
line list. Delete, and prove deletion.

- **expected if safe:** group header + its members + EndGroup + exactly one flat
  line; each item appearing the expected number of times.
- **expected if unsafe:** any item duplicated, or a line count above the
  expected total.

P1 costs no governed artifact and decides the shape of everything below.

---

## 3 · The matrix — two branches, decided by P1

### Branch A — P1 shows mixed is safe → **1 governed artifact**

A single **mixed, `turnkey_only`** quote proves all four at once:

| assertion | how this one order proves it |
|---|---|
| M1 | the Direct Product appears as exactly one ordinary line, no Group/EndGroup around it |
| M2 | that line carries `costEstimateType: CUSTOM` + `costEstimateRate` = governed cost, set at CREATE |
| M3 | the Item Group's members carry the same pair, written post-expansion by PATCH |
| M4 | both structures coexist with no duplication and correct totals |

Requires removing the mixed-structure refusal first — legitimate, because P1 is
the evidence the refusal currently says is missing.

### Branch B — P1 shows mixed duplicates → **2 governed artifacts**

The refusal becomes permanent and correct, so no mixed artifact may exist.

| artifact | detail level | proves |
|---|---|---|
| **A1** Direct-only quote | `itemized` | M1, M2 |
| **A2** Item-Group-only quote | **`turnkey_only`** | M3 |

M4 is then answered as *"refused by design, evidenced by P1"* — a recorded
provider limitation rather than an unproven gap.

**Two is the floor in this branch.** A1 and A2 cannot merge: merging them is the
mixed order Branch B has just established to be unsafe.

---

## 4 · What every governed artifact must carry

Learned from `fa74cbe5`, which was disqualified after the fact for the first of
these:

1. **HubSpot deal with an associated company.** `markComplete` throws without
   `associatedCompanyId`. Verify at source, not from the cache — the cache row
   can be evicted (see `hubspot-cache-eviction-vs-complete-lineage.md`).
2. **`netsuite_customer_map` row** for that company.
3. **SKUs that resolve** in the sandbox — no SKU-less products (now refused at
   attach anyway).
4. **Tiers with quantities**, and an accepted tier.
5. **Accepted state** with `customer_accepted_tier_id`; `accepted_tier_id` NULL
   is the correct pre-Complete state and must not be seeded (Pattern 52 / #154).
6. **Exactly one active sent snapshot.**
7. **Non-null governed costs.** ← *the assertion-specific one.* With a null cost
   the code correctly writes nothing, so a cost-less artifact certifies nothing
   about M2 or M3. It would pass while proving the opposite of what was intended.

Freight is **not** required.

## 5 · Making misattribution detectable

Reconciliation is necessary and not sufficient. Each artifact must use:

- **at least two products with DIFFERENT unit costs** — equal costs make a swap
  invisible, since the totals match either way;
- **unit cost ≠ sell rate** on every line, so a cost that is silently echoing
  `rate` is visible as such;
- **recorded expected values before the click**, per line: SKU, quantity, rate,
  `costEstimateType`, `costEstimateRate`.

The read-back then checks per-line identity, not just the order total.

## 6 · Sequence

1. **Gate** — record the two Vercel Preview values. Nothing proceeds without them.
2. **P1** — disposable mixed probe; delete and prove deletion.
3. **Branch** — A (one artifact) or B (two), per P1.
4. **Build** the fixtures against §4, with §5's distinguishability.
5. **Complete once** per artifact; read back and verify per line.
6. `verify:s7-preserved` after each.

SO2707 / SO2708 / SO2709 remain untouched throughout.
