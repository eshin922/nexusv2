# Collapsing the Quote lifecycle to three governed stages — dependency trace

**Disposition, Edward 2026-08-24.** `Preview Quote → Send to Client → Client
Review → Acceptance → Sales Order` overstates what Nexus owns. Nexus does not
send the customer email, owns no delivery channel, and cannot observe a customer
reviewing. Target: **QUOTE → ACCEPTANCE → SALES ORDER**.

**This is a trace, not an implementation.** Nothing below is built yet.

---

## 0 · The headline

**The two stages are retirable. The `sent` STATUS is not, and must not move.**

Almost everything governed keys on `quotes.status`, not on which tab is
showing. The two tabs are presentation of a state machine that already skips
one of them.

But there are **two sole authoring surfaces** inside the doomed tabs, and both
are load-bearing. Dropping the tabs without replacing them is the failure the
disposition names — "do not hide the two tabs first and discover later that a
governed gate still depends on them."

| # | Surface | Sole caller of | Consumed by | Severity |
|---|---|---|---|---|
| **A** | `send-quote-flow.tsx` (inside Send to Client) | `sendQuote` | the entire lifecycle | **BLOCKING** |
| **B** | `add-entry.tsx` (inside Client Review) | `addQuoteReviewEvent` | Acceptance's prefill | **HIGH** |

### A · Send to Client is the only way to send a quote

`grep sendQuote src/components` returns exactly one call site:
`send-quote-flow.tsx:90`, which is rendered only by `tab-send-to-client.tsx`.

Freeze & send is currently **inert** and is a separate disposition. So:

> **Retiring the Send tab before Freeze & send is wired leaves no path to send
> any quote at all.**

That fixes the order of work: **Freeze & send must be wired and certified
first.** The tab retirement is the *last* step of that work, not its first.

### B · Client Review is the only way to author a review event

`addQuoteReviewEvent` has exactly one caller: `add-entry.tsx:69`, rendered only
by `tab-client-review.tsx`.

`quote_review_events` is a real table with four governed event types
(`sent`, `responded`, `asked`, `revision_requested`). `sent` rows are written
by the system inside `sendQuote` and `reviseQuote`. **The other three are
PM-authored, and Client Review is the only surface that authors them.**

They are not decorative. `getLatestRespondedEventForPrefill` reads the most
recent PM-authored `responded` event into `acceptancePrefill`, which prefills
the **Acceptance** tab's customer-comment transcription. Retiring Client Review
without a replacement makes that field permanently empty and the table
effectively append-only-by-system.

This is the standing "functional dependency check before dropping an
affordance" rule: the affordance is the sole authoring surface for data another
surface consumes, so it is drop-and-REPLACE, not drop.

**The replacement is natural.** The only consumer of PM-authored review events
is Acceptance. Under the new model, customer correspondence is part of the
*acceptance* record — "customer comments / acceptance notes" is named in the
disposition's own list of what Acceptance owns. So the feed moves INTO
Acceptance rather than being deleted.

---

## 1 · Full dependency trace

### 1.1 Routes and sub-tabs

| Artifact | Today | Change |
|---|---|---|
| `SubTabId` | `preview \| send \| review \| accepted \| tier` | drop `send`, `review` |
| `SUBTABS[].n` | typed `1\|2\|3\|4\|5` | `1\|2\|3` |
| `?tab=` param | `parseSubTabParam`, unknown → `preview` | see §2.2 — must MAP, not fall through |
| `tab-send-to-client.tsx` | renders send flow | content moves to Quote / Freeze & send |
| `tab-client-review.tsx` | renders feed + `add-entry` | content moves to Acceptance |

### 1.2 Workflow / status projection — **already skips Client Review**

`computeUmbrellaAdvance`:

```
draft    → frontier "send"
sent     → frontier "accepted"      <-- Client Review is never a frontier
accepted → frontier "tier"
complete → null
```

And `SUBTABS` types Client Review as `kind: "log"` — the umbrella's own legend
says *"a place to track, not a gate to pass."*

**So the progression loses nothing.** The only edit is that `draft`'s frontier
becomes `null`: Quote owns its own act (Freeze & send) rather than advancing to
a separate tab. That is the same shape `accepted`→`tier` already has for a tab
that owns its submit.

### 1.3 Send / freeze transaction — **preserve wholesale**

`sendQuote` (`quotes.ts:1433`) is certified machinery and is not to be
rewritten. It:

- assigns the customer-facing quote number (`quote_number_prefix` from
  `firm_settings`, per DEC-4);
- sets `status = 'sent'`, stamps `sent_at`;
- writes the `quote_sent` audit row;
- inserts the origin `quote_review_events` row (`event_type='sent'`).

Freeze & send **invokes** this; it does not reimplement it. The extra freezing
the disposition requires (presentation profile, accounting handoff, exact
artifact) composes around it in the same transaction.

### 1.4 `sent` is a real gate on three actions

```
markAccepted                quotes.ts:2494   status !== "sent"  -> refuse
recordCustomerAcceptance    quotes.ts:3148   status !== "sent"  -> refuse
clearCustomerAcceptance     quotes.ts:3211   status !== "sent"  -> refuse
requireRevisable            quote-guards:200 needs sent | accepted
```

**The status enum does not change.** `draft | sent | accepted | superseded |
lost` stays exactly as it is; `sent` keeps meaning what it means. Only the
LANGUAGE at the surface changes, per the disposition:

| stage | surface language | underlying |
|---|---|---|
| Quote | Draft / Ready to freeze / Frozen & released | `status='draft'` → `'sent'` |
| Acceptance | Awaiting acceptance / Accepted | `'sent'` → `'accepted'` |
| Sales Order | Not ready / Ready / Pushed | `'accepted'` → `'complete'` |

"Frozen & released" is a *rendering* of `sent`. No migration, no gate rewrite,
no audit-action rename, no change to any of the three refusals above.

**This is the compatibility spine of the whole change.** Renaming the status
enum would touch 67 read sites, the organizer, the deals surface, every
frozen snapshot and every audit projection — for no gain, since the disposition
asks for truthful *language*, not different *state*.

### 1.5 Frozen snapshots

Pattern 52 draft-lock keys on `assertDraft` / `assertNotFrozen`, both of which
read `quote.status`. Untouched by tab retirement. The freeze list
(`docs/pattern-52-freeze-list.md`) gains entries from the Freeze & send work,
not from this one.

### 1.6 Below-floor approval and Slack callbacks — **independent**

`below-floor-approval-request.ts`, `below-floor-authorization.ts` and
`/api/slack/interactivity` key on pricing state and approval records, not on
umbrella tabs. `override-modal.tsx` sits under `components/mark-accepted/`,
which is the Acceptance stage and survives.

No dependency on `send` or `review`. **Verify by falsification during
implementation** rather than accepting this paragraph: an approval request
raised, approved via Slack, and consumed, with the two tabs absent.

### 1.7 Sales Order eligibility — **unaffected**

`markComplete` requires `status === 'accepted'`. Reached from Acceptance, which
survives.

### 1.8 Organizer / deals status surfaces

`src/lib/organizer/tasks.ts:211,230` derive tasks from `f.status === 'sent'`;
`projects/[id]/page.tsx:613-615` renders per-version status chips. Both read
the STATUS, not the tab, so both survive unchanged — provided §1.4 holds and
the enum does not move. Their *labels* may want the new language; that is
cosmetic and separable.

### 1.9 Audit events — **already transition-named**

`quote_sent`, `quote_accepted`, `quote_reverted`, `quote_revised`,
`quote_completed`. Per the standing convention these name TRANSITIONS, not
mechanisms or tabs, so retiring a tab renames nothing. `quote_sent` remains
correct under Freeze & send — the transition is the same transition.

`admin/audit-log/renderers.ts:50` renders `quote_sent`; unchanged.

### 1.10 Tests and browser certification

- `tests/e2e/slice-12/primary-send-lifecycle.spec.ts` — its first test is
  literally named *"draft Preview to Send to Client to Client Review"* and
  walks the retired route. **Must be rewritten, not deleted**: the lifecycle it
  certifies still exists, through a different surface.
- `scripts/provision-cb-step10-fixture.ts`, `provision-cb-step8c4-fixture.ts` —
  seed quotes at `sent`; unaffected by tab changes, and must keep reading from
  source per the fixtures rule.
- Unit suite: `subtabs`, `advance-target` and umbrella tests reference the five
  ids; they change with the enum.

---

## 2 · Proposed migration and compatibility treatment

### 2.1 Ordering — forced, not chosen

```
1  Wire Freeze & send    (separate disposition; invokes sendQuote, adds the
                          freeze set, exposes existing refusal states)
2  Move the review feed into Acceptance   (drop-and-replace for finding B)
3  Retire the two tabs, collapse SubTabId to three, relabel the strip
4  Rewrite the e2e lifecycle walk against the new surface
5  Certify end to end on a deployed artifact
```

Steps 1 and 2 are drop-and-replace prerequisites. Step 3 is the only step that
touches routes, and it comes **after** both replacements exist. Doing 3 first is
precisely the failure the disposition prohibits.

### 2.2 URL compatibility — map, do not fall through

`parseSubTabParam` returns `preview` for anything unrecognised. If `send` and
`review` are simply deleted from the enum, existing links land on Preview
silently — and `?tab=review` in particular would land somewhere that no longer
contains what the operator wanted.

Map them explicitly instead:

```
?tab=send    -> quote        (the act now lives in Quote's footer)
?tab=review  -> acceptance   (the feed now lives in Acceptance)
```

Retain the mapping as a named constant with the disposition date, so the next
reader sees a deliberate supersession rather than dead enum values.

### 2.3 What is explicitly recorded as superseded

- **The page-level `Continue to Send →` progression is superseded by Freeze &
  send in Customer View.** Already implemented structurally: the restored
  branch of `tab-preview-quote.tsx` returns before `AdvanceBar` is referenced,
  so it cannot return when the admin gate is removed. Under the three-stage
  model the control is retired outright, not merely unreachable.
- **`Send to Client` and `Client Review` are retired as operator lifecycle
  stages** — not hidden, not conditionally suppressed. Nexus does not own
  delivery or observation, and a stage that claims otherwise is a false
  statement about the firm's process.

### 2.4 What must NOT change

- `quotes.status` enum values.
- `sendQuote`'s transaction body.
- The three `status !== 'sent'` refusals.
- Audit action names.
- `quote_review_events` and its four event types — the table survives; only its
  authoring surface moves.

---

## 3 · Open question for disposition

**Does `event_type = 'asked'` / `'revision_requested'` survive the move?**

Inside a "Client Review" stage those read as observations of a customer.
Inside Acceptance they read as the PM's own record of correspondence, which is
truthful. `revision_requested` additionally grows the inline `↺ Revise`
affordance, so it is functional as well as informational.

Recommendation: **keep all four types, relabel the surface.** The data is the
PM's record either way, and the disposition's own wording for Acceptance —
"customer comments / acceptance notes" — covers them. But the naming is worth a
decision rather than an assumption, since `asked` and `revision_requested` were
authored under the retired framing.
