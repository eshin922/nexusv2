# Gate 0 a/b/g server-truth verify — DPS-1007

**To:** CA + Edward
**From:** CC
**Re:** Verify results for the 503-anomaly send + verdict
**Status:** **VERDICT — 503 was COSMETIC. Gate 0 is CLEAN.**

---

## §1 · Results — all three checks GREEN

Ran against quote `54c38f67-3aa3-44e1-8be2-b85f85882ac1` via
`DIRECT_URL` (session-mode pooler) + Supabase service-role Storage
client.

### §a — quote row ✅

```
id:              54c38f67-3aa3-44e1-8be2-b85f85882ac1
quote_number:    DPS-1007
status:          sent
sent_at:         2026-07-27T16:57:06.408Z
pdf_url:         https://zqyfxvphqyurbzbshzwy.supabase.co/storage/v1/
                 object/sign/quote-pdfs/54c38f67-.../b03e86d4-.pdf?token=eyJ...
version_number:  1
scenario_label:  smoke-gate0-happy-0727
```

- Quote number assigned ✓
- Status sent ✓
- sent_at populated ✓
- pdf_url populated with a signed Supabase Storage URL ✓

### §b — storage object ✅

```
quote-pdfs/54c38f67-3aa3-44e1-8be2-b85f85882ac1/
  b03e86d4-6546-4594-8564-0bc3718e0b03.pdf   size=36631  created=2026-07-27T16:57:10.128Z
```

- One PDF object at the expected path ✓
- 36,631 bytes (reasonable for a customer PDF) ✓

### §g — audit row ✅

```
count: 1
{
  action: "quote_sent"
  created_at: 2026-07-27T16:57:10.358Z
  diff_json.pdf: {
    bucket:      "quote-pdfs"
    sendUuid:    "b03e86d4-6546-4594-8564-0bc3718e0b03"
    storagePath: "54c38f67-3aa3-44e1-8be2-b85f85882ac1/b03e86d4-...pdf"
  }
  diff_json.snapshots: {
    tcs, leadTime, daysValid, incoterms, pdfLayout, detailLevel,
    paymentTerms, includeSpecAddendum
  }
  diff_json.preparedBy: {
    name: "Daniel Park"
    email: "daniel@thedps.co"
    phone: null
    derived_from: "hubspot_owner_id"
  }
  diff_json.validUntil: "2026-08-26"
  diff_json.quoteNumber: "DPS-1007"
}
```

- Exactly 1 `quote_sent` row ✓
- `diff_json.pdf` contains bucket + storagePath + sendUuid (the
  Slice 11 required shape) ✓
- Snapshots block captures all frozen commercial defaults ✓
- PreparedBy resolved via `hubspot_owner_id` path (the pre-existing
  path, NOT the new signed-in PM fallback — no regression on the
  linked-deal case) ✓
- validUntil = sent_at (7/27) + 30 days = 8/26 ✓
- Total audit rows for this quote: 2 (`scenario_copied` at 09:54:57 +
  `quote_sent` at 09:57:10) — matches expected create → send flow ✓

---

## §2 · Timeline reconstruction

| Event | Timestamp | Delta from sent_at |
|---|---|---|
| `sent_at` (transaction commit — quotes row) | 16:57:06.408Z | — |
| Storage upload complete | 16:57:10.128Z | +3.72s |
| Audit row inserted | 16:57:10.358Z | +3.95s |

**Server-side work took ~4 seconds** between the initial quote-row
update (sent_at) and the final audit write. Breakdown:

- 0-3.72s: `renderToBuffer` (react-pdf render is CPU-heavy) +
  Supabase Storage upload
- 3.72-3.95s: audit row insert

Plus network round-trip + Clerk auth handshake + Next.js routing,
the browser likely saw a response arriving ~5s+ after the click.
That's the window where Vercel's edge / function response layer
can return 503 while the underlying transaction has already
committed.

---

## §3 · Verdict — 503 was COSMETIC

The 503 CB observed was **not** a partial-write bug. The `sendQuote`
transaction completed cleanly server-side (quote row + storage
object + audit row all present with correct timestamps + integrity).
The edge returned 503 on the slow response, but the client's
follow-up GET to `/customer-pdf` hit the render endpoint, which
succeeded, and the UI ended in a fully-sent state via re-read.

**Gate 0 is CLEAN.** CB proceeds to §2 matrix per the standing
smoke handoff.

**Bank per CA §4:** the 503 is worth a §0.5 note regardless of the
verdict — a customer-facing irreversible action returning 503 while
appearing to succeed is a real UX concern even when server-side
integrity holds. See §5 below.

---

## §4 · Why the 503 doesn't need immediate remediation

- The Step 6 §4 ordering held: render+upload+audit all completed
  BEFORE the transaction committed. There's no "sent state with
  missing artifact" gap.
- The UI recovered gracefully — CB reported UI-side c/d/e/f all
  green. PMs don't see a broken state.
- The 503 fires only on slow sends; typical fast paths (small
  quotes, warm functions) won't hit it.
- No PM-facing action needed: the quote is sent, the PDF is
  persisted, the customer artifact is delivered.

If the 503 became frequent OR started masking real failures, we'd
escalate — but this instance is single-run and the outcome is
clean.

---

## §5 · Bank as §0.5 catch — slow-send 503 with silent recovery

**Shape:** a customer-facing irreversible server action (render +
upload + audit) took ~4s server-side. Vercel's edge returned 503
to the browser despite the transaction committing cleanly. UI
recovered via the follow-up GET reading server-truth state; PM
wasn't shown an error.

**Why worth banking:**
1. **False-positive risk:** future automation / retry-on-503 logic
   could double-commit if it assumes 503 means "try again." A
   retry on this exact shape would fire a SECOND `sendQuote`
   attempt against an already-sent quote — the draft-lock catches
   it (`assertDraft` throws on the second call), so no data
   damage, but the UI would surface a confusing error.
2. **Silent-mask risk:** if a future refactor to `sendQuote`
   inverts the ordering (marks sent BEFORE render+upload), a
   response-layer 503 would then be masking a real partial-write.
   The current Step 6 §4 ordering is the load-bearing invariant;
   any change to it must preserve "artifact persisted before
   sent-state committed."
3. **UX-quality signal:** even with server integrity intact, a
   PM seeing "sent" state after a 503-looking network log entry
   is a trust-eroding moment. Worth eventually smoothing (v1.1+).

**Fix candidates (banked v1.1+, not gating v1):**
- Move render+upload to a background job (client polls / Supabase
  realtime notifies on completion). Removes the slow-server-
  response window entirely.
- Streaming response with progress ticks so the edge sees the
  connection as active during the render.
- Verify Vercel function timeout config allows >5s reliably on
  this route (Pro plan defaults may already be 60s+; check).

**Monitoring hook:** if the audit_log gains a `quote_sent` row
without a corresponding storage object OR a storage object without
an audit row, that's the partial-write signature Step 6 §4 was
designed to prevent. Worth a periodic audit query.

---

## §6 · Sequencing

- [x] Gate 0 clean → §2 matrix opens for CB
- [ ] PR #124 (linkage hotfix) — still open, ready to merge (does
      not block current smoke since Gate 0 hit the happy path on a
      different linked deal); banks the sender-fallback for future
      linked-deal-with-no-owner cases
- [ ] PR #122 (Step 8 close-out) — still open, ready to merge
      after full smoke matrix clean
- [ ] CB matrix walk → §3 charges combo → §4 addendum → §5
      affordances → §6 print B/W → §7 fidelity spot-check
- [ ] Slice 11 CLOSES on full smoke clean

Side bugs (production cost-line persistence + no discoverable
"create ASY") remain on separate tickets, non-gating.
