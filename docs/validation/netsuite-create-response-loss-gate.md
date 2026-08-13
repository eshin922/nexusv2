# NetSuite CREATE ambiguous-response gate — `computeIdempotencyKey` traced

**The question.** If NetSuite creates the SO but Nexus loses the CREATE response
before persisting `netsuite_so_id`, what prevents a retry from creating a second
SO?

**The answer, in one sentence.** Nothing inside Nexus — by explicit design the
retry *does* re-issue CREATE — so the only thing standing between that retry and
a second Sales Order is the **NetSuite-side UserEvent script
`_dps_ue_prevent_dupplicated_so.js`**, with the `X-NetSuite-Idempotency-Key`
header intended as the first line of defence but carrying **no evidence anywhere
in this repository that NetSuite honours it.**

Read-only trace. Nothing was executed against NetSuite. DPS-1048 not Completed.

---

## 1 · The key itself

`src/lib/netsuite/sales-orders.ts:293`

```ts
export function computeIdempotencyKey(quoteId, quoteSnapshotId): string {
  const hash = createHash("sha256").update(`${quoteId}|${quoteSnapshotId}`).digest("hex");
  return `nxs-so-${hash.slice(0, 40)}`;
}
```

Deterministic in `(quoteId, acceptedSnapshotId)`. Computed at
`mark-complete.ts:850`, **after** the durable attempt is elected, so a retry
recomputes the identical key. Payload movement cannot mint a second identity.

It leaves Nexus in exactly one place — `client.ts:318`:

```ts
if (args.idempotencyKey) headers["X-NetSuite-Idempotency-Key"] = args.idempotencyKey;
```

---

## 2 · The three layers, and what each actually guarantees

### Layer 1 — `netsuite_so_pushes` (Nexus). Does **not** close this window.

The attempt row is written **before** the POST, and the response-loss case leaves
it in the state the lifecycle header names explicitly
(`attempt-lifecycle.ts:23-24`):

```
pending + null    POST in flight (response-loss window; unchanged)
```

On retry that row is re-elected (it still satisfies `ownsSnapshot`, since it is
not `failed + validation`), and its frozen `payload_snapshot` and recomputed key
are replayed. But the create-suppression predicate is keyed on **SO-id
presence**:

```ts
export function mustNotCreate(attempt) { return attempt.netsuiteSoId !== null; }
```

In this window `netsuite_so_id` is `null`, so `mustNotCreate` is **false** and
`createSalesOrder` is called again. This is deliberate and documented at
`sales-orders.ts:313-316`:

> "the header here catches only the *post succeeded, persist failed* retry
> window where the orchestrator can't see the previous push."

So Layer 1 guarantees **one live attempt, one stable payload, one stable key** —
not one CREATE.

There is also **no automated pre-CREATE query** for an existing SO on
`custbody_dps_deal_id`. The `⚠ MANDATORY PREFLIGHT` in
`od-004-walk-runbook.md:23` is a **manual runbook step performed by the
operator**, not code. Nothing in `mark-complete.ts` performs it.

### Layer 2 — `X-NetSuite-Idempotency-Key`. **Unevidenced.**

This is the layer the design nominates to close precisely this window. Its
correctness depends entirely on a NetSuite platform behaviour, and:

- The string `X-NetSuite-Idempotency-Key` appears **only** at `client.ts:318`
  and in the comment at `sales-orders.ts:311`. A sweep of `docs/`, `tests/` and
  `scripts/` returns **zero** matches.
- No test asserts it. No walk recorded it. No document states the retention
  window, the conditions under which NetSuite replays versus re-creates, or
  whether the account/version supports it at all.

If NetSuite ignores an unrecognised header, the retry is an ordinary POST. **A
header that is silently dropped and a header that is honoured are
indistinguishable from Nexus's side** — no error, no signal, no log. That is the
Class A failure shape this codebase has already been bitten by three times
(pooler dual-budget, Realtime 10-binding cap, Entra admin consent): a platform
constraint that is invisible in normal observability until behaviour breaks.

**Unverified is not the same as broken.** NetSuite may well honour it. The point
is that the gate cannot be closed by reading this code, because the code cannot
answer the question — the answer lives in the provider.

### Layer 3 — `_dps_ue_prevent_dupplicated_so.js` (NetSuite). **Measured.**

The one mechanism with real evidence
(`so-field-parity-matrix.md:83-84`, `od-004-walk-runbook.md:23`):

- A UserEvent script refuses any second Sales Order for a deal that already has
  one, failing with `DUPLICATED DEAL`.
- **Status is not a filter** — SO2624 is `Closed` and still blocks.
- "A deal is consumed permanently by its first successful CREATE."

So a second *order* is prevented. **This, not the header, is what is actually
holding the line today.**

---

## 3 · The consequence that matters more than the duplicate

Layer 3 prevents the duplicate and, in doing so, produces a worse-documented end
state. Trace it:

1. CREATE succeeds at NetSuite; response lost. Attempt row: `pending + null`.
2. Retry re-elects the row and re-issues CREATE (§2, Layer 1).
3. The SuiteScript refuses it. A UserEvent rejection returns **HTTP 400**, and
   `classifyResponse` (`errors.ts:110-114`) maps any 4xx that is not
   401/403/404/429/concurrency to **`validation`**.
4. `recordAttemptFailure` is called with `netsuiteSoId: resumeSoId` — which is
   `null`, because the first response was lost. `failureStatusFor` therefore
   returns `{ status: "failed", terminal: true }`.
5. The row becomes **`failed + validation`** — the one state `ownsSnapshot`
   excludes. It **releases its claim** on the snapshot.

End state:

- A **real Sales Order exists** in NetSuite.
- Nexus holds **no `netsuite_so_id`** for it, on the quote or on any push row.
- The deal is **permanently consumed** — no future CREATE for it can ever
  succeed.
- The quote cannot Complete through the normal path.

This is the orphan the lifecycle header itself warns about
(`attempt-lifecycle.ts:44-47`) — "surfacing as `DUPLICATED DEAL` with the real SO
id orphaned". The invariant *"once `netsuite_so_id` is non-null, never
`failed`"* fully closes that hazard for the **post-CREATE PATCH** route it was
written for. It cannot close it for the **response-loss** route, because there
the id was never learned, so the invariant it protects has nothing to protect.

**Both known failure modes reach the same place: a real SO that Nexus cannot
name.** The duplicate is prevented; the orphan is not.

---

## 4 · What would close the gate

Not a code change first — a **measurement**, and then a recovery path.

**(a) Falsify the header.** In the sandbox, POST a Sales Order twice with an
identical `X-NetSuite-Idempotency-Key` and observe whether NetSuite returns the
original record or creates a second. This must be run against a deal with **no**
existing SO, otherwise the SuiteScript refuses the second call and the
instrument cannot express the failure it is meant to exclude — the same trap as
the grep that could not match numeric differences. The control is a second pair
with **different** keys, which must produce two distinct outcomes for the test to
mean anything. Record the retention window.

**(b) Give the response-loss window a Nexus-side answer**, since (a) may come
back negative and, even if positive, retention is finite. The natural one already
exists as a manual runbook step: before CREATE, query
`transaction WHERE type='SalesOrd' AND custbody_dps_deal_id = <dealId>` and
adopt any existing SO's id into the attempt row instead of posting. That
converts the orphan into a resume — `mustNotCreate` then returns true on the
next pass. The query is already written in the runbook and already used by the
zero-SO preflight.

**(c) Classify `DUPLICATED DEAL` distinctly from ordinary `validation`.** It is
the one 4xx that means *an order exists*, which is the opposite of the
side-effect-free reading `failed + validation` encodes. Under the current
mapping it takes the one branch that releases the claim.

Each is independently useful; (b) is the one that makes the system correct
without depending on a provider behaviour nobody here has measured.

---

## 5 · Status

**Gate remains OPEN.** The question is answered — the protection is a NetSuite
UserEvent script, not `computeIdempotencyKey` — but the answer is not one that
authorises Complete:

- the header layer is unverified;
- the surviving guard produces an unrecoverable orphan;
- and no Nexus-side code performs the deal-id preflight that would prevent it.

**Do not Complete DPS-1048.**
