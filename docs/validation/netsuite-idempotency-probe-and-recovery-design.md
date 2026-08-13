# NetSuite CREATE gate — Step 1 measurement + Step 2/3 recovery design

**Step 1 is answered by measurement: `X-NetSuite-Idempotency-Key` is NOT honoured
by account `7924416_SB2`.** Two otherwise-identical Sales Order CREATEs carrying
the **same** key produced **two Sales Orders**.

Design only below Step 1. Nothing implemented. DPS-1048 untouched and not used.

---

## Step 1 · Provider request-idempotency — MEASURED

### Method

Sandbox `7924416_SB2` (`env=sandbox`, writes allowed; production writes are
refused by `assertWriteAuthorized` without explicit opt-in).

`custbody_dps_deal_id` was **deliberately omitted**. This is the whole design of
the probe: with a deal id present, "header honoured" (replay, 1 SO) and "header
ignored" (UserEvent refuses, 1 SO) both collapse to *one SO exists*, and the
instrument cannot express the difference. Removing the deal id removes the mask.
The estate was first confirmed to contain Sales Orders with NULL deal id
(SO2334, SO2347, SO2422, SO2439, SO2462), so the shape was known to be
permitted.

**Ground truth was a SuiteQL count of orders carrying a unique memo tag**, not
the HTTP responses — the responses are the thing under question.

### Result

```
key = nxs-probe-Rc6f8098-1   (identical on both requests)

POST 1: OK  internalId=361541
POST 2: OK  internalId=361641

GROUND TRUTH: 2 Sales Orders   id=361541 SO2705 · id=361641 SO2706
distinct internalIds returned: 2
```

**No control run was required.** A control exists to disambiguate a *negative*
result — had one SO appeared, a differing-key pair would have been needed to
prove two keys can produce two orders. The instrument produced the failure
directly, so there is nothing left to disambiguate.

Corollary observed in passing: both POSTs succeeded, confirming the duplicate-
deal UserEvent does not fire when `custbody_dps_deal_id` is absent.

### Disposition

- **Layer 2 does not exist.** Do not claim the header prevents duplicate Sales
  Orders. It was never evidenced, and it is now falsified for this account.
- Retained in code per instruction, as inert defence-in-depth should NetSuite
  enable the feature later. **No behaviour may depend on it.**
- No retention/expiry question remains: a key that does not deduplicate at all
  has no retention window to characterise.

### Cleanup

Both probe orders were deleted (`DELETE /record/v1/salesOrder/{id}` succeeded for
both); a follow-up query returned **0** remaining `NEXUS-PROBE-A%` orders. The
estate is back to its pre-probe 702 Sales Orders. No deal id was consumed — the
probe payload carried none.

### What this does to the gate

It makes it **worse, and correctly so**. The three-layer model is now two:
Nexus-side attempt uniqueness (which by design permits the second CREATE) and
the duplicate-deal UserEvent (which prevents the second *order* but produces the
orphan). The hoped-for layer between them is gone.

One mitigating fact, verified while tracing: `createRecord` does **not** route
through `nsRequest`, so a CREATE is never auto-retried by the transport layer.
The duplicate window is reachable only by an explicit operator retry, not by
silent machine retry.

---

## Step 2 · Ambiguous-attempt reconciliation — design

### Where it belongs

Only when a **re-elected** attempt is ambiguous. A row inserted in the current
execution has provably not been POSTed yet; a row inherited from a previous
execution in `pending + netsuite_so_id = NULL` is indistinguishable between
"died before POST" and "POST landed, response lost". So the reconciliation gate
sits in `mark-complete.ts` on the `durableAttempt` branch, before the CREATE,
whenever `!mustNotCreate(durableAttempt)`.

### The query

Governed identity already projected to NetSuite:

```sql
SELECT id, tranid, entity, total, status, custbody_dps_deal_id
  FROM transaction
 WHERE type = 'SalesOrd' AND custbody_dps_deal_id = :dealId
```

Status is deliberately **not** filtered — the UserEvent does not exempt closed
orders, so neither may reconciliation.

### Outcomes

| matches | action |
|---|---|
| **0** | No order exists. CREATE may proceed. |
| **1** | **Candidate** for adoption — never adopted on count alone. Verify (below). |
| **>1** | **Fail closed.** Manual reconciliation. Never guess which is ours. |

### Adoption verification

A single match is a candidate, not a conclusion. Adoption requires agreement on
every check available, compared against the attempt's **frozen
`payload_snapshot`** — which is authoritative precisely because it cannot drift:

1. `custbody_dps_deal_id` equals the quote's deal id
2. `entity` equals the payload's customer internal id
3. `total` equals the accepted commercial total (the same value the
   `quote_accepted` audit already records — $3,500 for Order B)
4. transaction type is `SalesOrd`
5. line/grouping structure matches the frozen grouping plan where the provider
   exposes it

Any mismatch ⇒ **refuse adoption, fail closed.** A near-match is a stop, not a
tie-break.

**Stronger upgrade, recommended and out of Nexus's sole control.** Every check
above is an *inference* that a found order is ours. Writing the deterministic key
into a NetSuite custom field on CREATE — e.g. `custbody_nxs_idempotency_key` —
would make adoption an **identity match** rather than a correlation: query by the
key, and a hit is definitionally this attempt's order. This requires a NetSuite
administrator to add the field, so it cannot be assumed; the heuristic match
above is the design that works with today's estate, and this is the design that
would make the whole class of ambiguity disappear. Worth raising with the
NetSuite admin alongside BLOCKER 1.

### On successful adoption

Persist `netsuite_so_id` and `tranid` through the existing recovery boundary
(`recordSalesOrderCreated`), landing the attempt in `awaiting_rates` — the state
that already owns the snapshot and already suppresses CREATE. **No CREATE is
issued.** Rate convergence then resumes on the normal post-CREATE path, which
needs no changes: adoption's whole purpose is to rejoin the lifecycle that
already works.

---

## Step 3 · `DUPLICATED DEAL` must not be ordinary validation

`classifyResponse` maps every non-401/403/404/429 4xx to `validation`
(`errors.ts:110-114`), and a UserEvent rejection is an HTTP 400. So today the one
response that means **"the external effect you were attempting already exists"**
takes the branch reserved for **"nothing happened, safe to discard"** — and
`failed + validation` is the single state `ownsSnapshot` excludes, releasing the
claim.

**The HTTP class and the business meaning are opposites here.**

Design:

1. Detect the duplicate-deal rejection specifically — by its `DUPLICATED DEAL`
   marker, not by status code — and give it its own error class
   (`duplicate_deal`), never `validation`.
2. On that class, run the Step 2 reconciliation query.
3. Adopt only on a unique and sufficient match.
4. Otherwise enter a distinct **`needs_reconciliation`** state.
5. **Never release snapshot ownership on the basis of an HTTP 400.**

`needs_reconciliation` must satisfy two properties, both already expressible:

- it **owns the snapshot** — trivially true, since `ownsSnapshot` excludes only
  `failed + validation`;
- it **suppresses CREATE** — which requires extending `mustNotCreate`, below.

A contradiction case deserves naming: `DUPLICATED DEAL` returned while the
reconciliation query finds **zero** matching orders. The guard matched on
something the query cannot see. That is not a licence to create — it is the
clearest possible fail-closed.

---

## Lifecycle invariant — the extension

Current:

> Once `netsuite_so_id` is non-null, the attempt may never transition to
> `failed`.

Still valid, and insufficient: it protects an identity Nexus never learned in the
response-loss case. Extended:

> **Once an external Sales Order may exist, the attempt must not enter any state
> that permits an ungoverned fresh CREATE until provider reconciliation has
> established whether it exists.**

Concretely, `mustNotCreate` stops being a test of *knowledge* and becomes a test
of *possibility*:

```
mustNotCreate(attempt) =
     attempt.netsuiteSoId !== null            // an order is known to exist
  || attempt.status === 'needs_reconciliation' // an order may exist, unresolved
```

and any re-elected `pending + null` attempt must pass through reconciliation
before CREATE. The three predicates that must stay in lockstep — the migration
0065 unique index, the durable-payload selector, and `ownsSnapshot` — acquire a
fourth sibling in `mustNotCreate`. They are one rule expressed four times, and
the existing comment's warning applies with more force: changing one without the
others reopens the defect.

---

## Required regressions — how each is provable

All twelve are unit-testable against the pure rules in
`attempt-lifecycle-rules.ts` plus a stubbed provider query; none needs a live
NetSuite call.

| # | Case | Expected |
|---|---|---|
| 1 | `pending+null`, provider has 0 | exactly one CREATE |
| 2 | `pending+null`, provider has 1 matching | adopt · **zero** CREATE |
| 3 | adopted | resumes normal rate convergence |
| 4 | `DUPLICATED DEAL` | reconciliation branch, not terminal validation |
| 5 | duplicate + 1 match | adopt |
| 6 | duplicate + 0 matches | fail closed (contradiction) |
| 7 | duplicate + >1 match | fail closed |
| 8 | customer mismatch | refuse adoption |
| 9 | total mismatch | refuse adoption |
| 10 | retry after adoption | zero CREATE (`mustNotCreate` true) |
| 11 | throughout ambiguous reconciliation | snapshot ownership retained |
| 12 | ordinary pre-CREATE validation failure | current semantics unchanged |

**#12 is the one most at risk.** The repair must not disturb migration 0065's
`failed + validation` release semantics for genuine pre-CREATE rejections — that
release is what lets a repaired payload be re-elected. The change narrows which
responses *reach* that classification; it must not change what the
classification does.

### The falsification

Reconstruct today's sequence end to end and assert it is unreachable:

```
CREATE committed → response lost → attempt pending+null
  → retry → CREATE re-issued → DUPLICATED DEAL
  → classified validation → failed+terminal → ownership released
  → real SO orphaned, deal permanently consumed
```

Under the repair the same inputs must instead reach *adopted* (or a fail-closed
`needs_reconciliation`), and the assertion should be on **ownership never being
released** and **CREATE count**, not merely on the final status — a status-only
assertion would pass against an implementation that still emitted a second
CREATE before settling.

---

## Status

- **Step 1: closed by measurement.** Header not honoured; do not depend on it.
- **Steps 2 and 3: designed, not implemented.**
- The Nexus-side reconciliation is now **required, not defence-in-depth** — the
  probe removed the alternative.

**Gate remains OPEN. Do not Complete DPS-1048.**

Order B unchanged: Sent · Accepted · `turnkey_only` frozen · $3,500 · production
HubSpot untouched · no NetSuite SO.

Probes: `.artifacts/probe-preflight.ts`, `.artifacts/probe-shape.ts`,
`.artifacts/probe-a-header.ts`, `.artifacts/probe-cleanup.ts`.
