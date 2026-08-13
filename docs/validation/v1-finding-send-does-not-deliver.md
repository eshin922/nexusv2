# V1 finding — `Send` finalizes the quote; it does not deliver it

**Status:** open · awaiting business disposition (see [OD-021](../OPEN_DECISIONS.md))
**Class:** workflow / semantics defect. **Not** a defect in the commercial
snapshot or freeze behaviour, which is governed, validated, and untouched by
this finding.
**Found:** 2026-08-12, during the OD-004 / Track B grouped certification walk,
while verifying that `sendQuote` performed no outward-facing action before
authorising it on a real customer deal.

---

## 1 · What `sendQuote` actually does

`src/app/actions/quotes.ts` `sendQuote`:

1. renders the customer PDF and persists it to Supabase Storage (`pdf_url`);
2. freezes the commercial snapshot into `quote_snapshots` (payment terms, lead
   time, incoterms, prepared-by, PDF axes) and mirrors it onto `quotes`;
3. assigns the customer-facing quote number (`DPS-nnnn`);
4. stamps `sent_at`, and derives `valid_until = sent_at + days_valid`;
5. transitions `quotes.status` `draft → sent`;
6. writes the `quote_sent` audit row.

**It dispatches no email.** There is no mail transport anywhere in the
repository — no SMTP client, no Resend/Nodemailer/Graph `sendMail`, no
outbound queue. Verified by exhaustive search of `src/`.

## 2 · The complete operator journey as built

```
draft
  │
  ├─ [Send to client]  ── Nexus: freeze + number + sent_at + status=sent + audit
  │                        ↳ NOTHING leaves the building
  │
  ├─ [↳ Download + open mail draft]  ── preview-toolbar.tsx:178
  │      window.location.href = `mailto:?subject=…&body=…`
  │      • NO recipient — operator types the customer address
  │      • NO attachment — operator attaches the downloaded PDF by hand
  │
  └─ operator sends the email from their own client
         ↳ Nexus never observes this. No callback, no confirmation, no record.
```

The gap between step 1 and the last step is unbounded and invisible. Nexus's
state says `sent` from the moment of finalization, whether the operator emails
the customer thirty seconds later, next week, or never.

## 3 · Every surface that currently implies customer delivery

| # | Surface | Current text / behaviour | Claim it makes |
|---|---|---|---|
| 1 | `tab-send-to-client.tsx:241` | "{Customer} **will receive the customer PDF by email.**" | Outright false — nothing is transmitted |
| 2 | Send action label | "**Send** to client" / "Send this quote to {customer}" | Names transmission; performs finalization |
| 3 | Confirm dialog | "Send this quote?" → lists 5 effects, none of which is delivery | Framing implies dispatch; body quietly does not |
| 4 | Sub-tab name | "**Send to Client**" | Same |
| 5 | Post-send heading | "**Sent** — *awaiting {customer}*" | Asserts the customer now holds it and is responding |
| 6 | Post-send body | "The quote is **with the customer**." | Same |
| 7 | Elapsed counter | "Sent Aug 11 · **0 days ago**" | Measures a delivery age that may not have started |
| 8 | `quotes.status = 'sent'` | Lifecycle enum value | Reads as delivered throughout the codebase |
| 9 | `quotes.sent_at` | Timestamp | Column name asserts a send event |
| 10 | `quote_sent` audit action | Audit vocabulary | Records "quote sent" as a business fact |
| 11 | Client Review | "When {customer} **replies**…", "the customer is still responding to the last-sent…" | Presupposes receipt |
| 12 | Customer PDF | "**Issued** · {sent_at date}" | Customer-facing issue date |

### 3.1 The one consequence that is not cosmetic

**`valid_until = sent_at + days_valid`** (`quotes.ts:1629-1631`).

The customer's acceptance window starts at *finalization*. A quote finalized
Monday and emailed Thursday reaches the customer with three days already burned
off a window they never had. The PDF simultaneously tells them it was "Issued"
Monday. Both statements are produced by Nexus and both are wrong about the
customer's actual position.

This is the item that makes the finding commercial rather than editorial, and
it is why the wording cannot simply be softened without deciding the underlying
workflow.

## 4 · The two concepts, held apart

They are currently fused into one action and one timestamp. They are not the
same event and need not be simultaneous.

**Commercial finalization** — the customer-facing version is frozen, numbered,
rendered, and made immutable. Internal. Fully owned by Nexus. Already correct,
already governed (Pattern 52 draft-lock, `quote_snapshots`, `pdf_url`), and
demonstrably working — the OD-004 walk exercised it end to end.

**Customer delivery** — the artifact reached the customer. External. Nexus
currently has no capability to perform it, no evidence that it occurred, and no
representation of it in the schema.

Everything in §3 is a case of the first borrowing the vocabulary of the second.

## 5 · The minimum business decision

### Option A — Nexus sends the customer email directly

`Send` becomes true. Nexus owns dispatch and delivery evidence.

Requires: a mail transport decision (Microsoft Graph on the existing Entra
tenant is the natural candidate given the OAuth work already done, vs. a
transactional provider); a from-identity and reply-to policy; recipient contact
data that Nexus does not currently hold on the project/deal; attachment or
signed-link delivery; bounce and failure handling; retry semantics; and a
delivery-evidence record. It also makes an outward-facing customer
communication a Nexus-triggered act, which changes the operator-confirmation
posture around the Send button.

Largest scope. Makes every string in §3 correct by construction.

### Option B — the operator sends; Nexus finalizes

Nexus does what it already does and stops claiming more. The mail-draft action
remains the delivery path.

Requires: retiring delivery language from surfaces 1-7 and 11 in favour of
finalization language, and deciding the sub-question below. Schema and audit
vocabulary (8-10) are traced in §6 and are the expensive part — they may be
left as internal names with a documented meaning rather than renamed.

Smallest scope. Honest immediately.

**If B, one sub-question must also be settled:**

- **B1 — Nexus tracks delivery too.** Add an explicit `Mark as sent` operator
  confirmation after the email actually goes out, with its own timestamp. Gives
  a real delivery datum, a correct basis for `valid_until` and the elapsed
  counter, and an honest "awaiting customer" state. Costs a new lifecycle step
  the operator must remember, and an unconfirmed-delivery state to design.
- **B2 — Nexus tracks finalization only.** It never claims delivery. "Awaiting
  customer" becomes "finalized — not yet delivered by Nexus", `valid_until`
  is acknowledged as running from finalization (or is authored explicitly by
  the PM instead of derived), and delivery lives entirely in the operator's
  own mail client.

B2 is the smaller change and the more honest one; B1 buys a correct
`valid_until` and a truthful elapsed counter. That trade is the decision.

## 6 · Do not redefine anything yet

`sent_at`, `status='sent'`, and the snapshot semantics are load-bearing.
Traced consumers, all of which read `sent` as an accomplished fact:

- `valid_until` derivation — `quotes.ts:1629`
- customer PDF "Issued" date + `sentDate` — `customer-view-resolver.ts:411`
- version chain / snapshot history — `quote-version-chain.ts`, `quote-snapshots.ts`
- workspace + home queries (sorting, resume, completeness) — `workspace-queries.ts:309,360,448`
- Client Review gating (`isSent` blocks writes pending re-send)
- Acceptance gating and `requireRevisable` (sent-or-accepted transitions)
- the Track B / NetSuite push chain, which reads the **snapshot**, not the wording

None of these is wrong about *finalization*. They are only wrong if `sent` is
read as *delivered*. That is the redefinition to avoid making casually.

## 7 · Correction to certification language

Adopted going forward:

> Evidence showing `status = sent` proves the quote was **frozen and finalized
> by Nexus**, with a quote number assigned and an immutable PDF persisted. It
> **does not prove the customer received anything.**

This applies retroactively to every prior walk record that used "sent" to mean
delivered. It does not invalidate any of that evidence — those walks were
proving finalization and freeze behaviour, which is exactly what they proved.
It narrows the claim to what was actually demonstrated.

The OD-004 / Track B certification is unaffected in substance: it certifies the
grouped Sales Order path from an accepted quote, and reads the frozen snapshot
rather than the delivery wording.
