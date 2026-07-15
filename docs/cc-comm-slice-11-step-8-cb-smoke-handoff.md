# Slice 11 Step 8 — CB smoke handoff

**To:** Edward + CB (smoke agent)
**From:** CC
**Re:** Full-matrix smoke walkthrough for Slice 11 close-out
**Status:** Handoff. Everything below is executable — no queries
back to CC needed to enable the smoke.

---

## §0 · Prereqs

- **PR #121 (Step 7 boundary gates) MERGED before starting** — Step 7's
  Font.register fix (`grandNumReq` + `tkTotalReq` Newsreader italic 500
  → weight 500 slot registered) must be live in the deploy under smoke.
  Without it, the "medium italic" register on the grand totals + turnkey
  totals renders subtly wrong.
- **`quote-pdfs` Supabase bucket exists** (already confirmed pre-Step-6).
- Preview Vercel deploy URL of `main` (post-#121 merge) or the branch's
  own preview if smoke runs on the branch pre-merge.
- Sign in as **the PM whose send you'll test** (the send action stamps
  the actor into `preparedBy` snapshot on the sent quote — you want
  that to reflect the smoker, not a fixture).

---

## §1 · GATE 0 — end-to-end send works (before ANY matrix walk)

**If Gate 0 fails, STOP. Report to Edward + CC before continuing.**

### 1.1 · Create a throwaway quote

Any project in dev. Create a fresh scenario:
1. Project detail → **+ New scenario** → give it a label (e.g., `smoke-step-8`).
2. Add 2 tiers with real qty (e.g., `1000` and `5000`).
3. Add 1 assembly with 1 leaf; give the leaf a HubSpot product OR sample
   spec content (the addendum + charges tests need real data — one leaf
   is enough for Gate 0).
4. Add packaging + production cost lines so cost stack is nonzero. Wait
   for the "Just updated" hint to settle (autosave commit + reconcile).
5. Navigate to **Pricing**. Confirm blended margin is above target (no
   suggestion_manual_only firing). If margins are low, adjust cost
   inputs to clean the quote — Gate 0 is about the send path, not
   pricing state.
6. Navigate to **Quote** (customer view surface).

### 1.2 · Confirm the preview iframe renders

- Preview iframe loads without HTTP 500.
- Preview reflects the quote's current data (SKU name, tier prices,
  charges block if any).
- Toolbar shows **↗ Send**, **Download PDF**, **Download + mail draft**,
  layout toggles (tier_table / single_tier), detail toggles (itemized /
  turnkey_only), and addendum checkbox (all editable — quote is draft).

### 1.3 · Click **↗ Send**

- Confirm dialog fires. Confirm.
- Wait for the send to complete (~5-10s including render + upload).

### 1.4 · Confirm the six Gate 0 acceptance points

| # | Check | How |
|---|---|---|
| a | `pdfUrl` written to DB | `select pdf_url, sent_at from quotes where id = '<quoteId>'` — pdf_url populated, sent_at set to now |
| b | Storage object exists | Supabase Dashboard → Storage → `quote-pdfs` → find `<quoteId>/<uuid>.pdf`; download it, opens as valid PDF |
| c | Preview == persisted PDF | Open the persisted PDF (from Storage or download-affordance) and the on-screen preview iframe side-by-side; identical layout, same numbers |
| d | Snapshot froze | Toolbar toggles now DISABLED (sent quote is read-only); the axes rendered match send-time values, not live |
| e | Issued date + Valid-until populate | Both dates render on the preview (no em-dash placeholders); Valid-until = Issued + 30 days (default) |
| f | prepared-by = the sending PM | Preview "Prepared by" block shows the smoker's name/email, not the fixture VENDOR_FIXTURE.preparedBy |
| g | Audit row | `select action, diff_json from audit_log where entity_id = '<quoteId>' and action = 'quote_sent' order by created_at desc limit 1;` — diff_json.pdf = `{bucket:"quote-pdfs", storagePath:"<quoteId>/<uuid>.pdf", sendUuid:"<uuid>"}` |

**All 7 must pass. Gate 0 clear only when all green.**

If Storage object exists but preview doesn't match persisted PDF:
Step 6 `buildQuoteDocument` factory has drifted between preview + send
paths. That's a send-path regression, report as Gate-0 failure.

---

## §2 · The 12-cell matrix (after Gate 0)

Test EACH cell — a quote configured with the row × column combination
listed. Same throwaway quote from §1 can be reconfigured; or create
distinct throwaway quotes per cell.

Layout: 3 page states × 2 layouts × 2 detail levels = **12 cells**.

| # | Page state (SKUs × Tiers) | Layout | Detail |
|---|---|---|---|
| 1 | multi-SKU, multi-tier | tier_table | itemized |
| 2 | multi-SKU, multi-tier | tier_table | turnkey_only |
| 3 | multi-SKU, single-tier | single_tier | itemized |
| 4 | multi-SKU, single-tier | single_tier | turnkey_only |
| 5 | single-SKU, multi-tier | tier_table | itemized |
| 6 | single-SKU, multi-tier | tier_table | turnkey_only |
| 7 | single-SKU, single-tier | single_tier | itemized |
| 8 | single-SKU, single-tier | single_tier | turnkey_only |
| 9 | one-unpriced-tier (mixed pricing) | tier_table | itemized |
| 10 | one-unpriced-tier | tier_table | turnkey_only |
| 11 | one-unpriced-tier | single_tier | itemized |
| 12 | one-unpriced-tier | single_tier | turnkey_only |

### 2.1 · Per-cell verification checklist

- **Pricing renders correctly** — sell prices per SKU × tier match the
  Pricing surface; line-total sublines add correctly; grand total
  = sum of line totals; turnkey per-unit = grand total / units.
- **Recommended tier treatment** — the recommended tier (★ in tier
  table) is bracketed / starred / tinted per CD spec. If no
  recommendation set on the quote, the treatment is absent.
- **turnkey_only = deliberate all-in price** — reads as a single
  clear number for THIS tier / SKU, not an empty table. The
  itemized breakdown (COGS columns) is suppressed. Copy near the
  price reads as intentional "delivered price" (not "N/A").
- **`turnkey_only` + one-unpriced-tier** — the unpriced tier's
  turnkey cell renders "quote on request" or "total on request"
  (per CD spec), NOT $0.00. Other tiers show real turnkey.
- **`itemized` + one-unpriced-tier** — the unpriced tier's sell
  column shows "from $X" (or equivalent placeholder). Column
  headers/subtotals aren't broken.
- **Flat pricing** — a single-tier quote with all-same-per-unit
  reads cleanly (no "N-tier" markers when N=1).

### 2.2 · If any cell fails

Fidelity gap OR data-rendering bug. Screenshot + report the cell
number + which check failed. Do NOT proceed to §3 / §4 until §2 is
green — later stages assume the matrix baseline.

---

## §3 · Charges + one-unpriced combo (orthogonal-flags integration test)

Seed a NEW throwaway quote with the specific combination:

1. **`allocate_service_fees_to_cost = FALSE`** on the assembly (Costs
   surface → Production drilldown → Allocate toggle OFF).
2. **Freight = pass-through** (Costs surface → Freight drilldown →
   freight-treatment toggle to `pass_through`).
3. **One tier unpriced** — leave one tier's qty populated but its
   pricing incomplete (some cell shows "from $X" state).
4. **One-time service fees present** — packaging Setup fees + Tooling
   fees on the production drilldown, at least $1 each so they render.

Navigate to Quote surface.

### 3.1 · Verification checklist

- **Charges block renders** — one-time fees (setup, tooling, R&D)
  listed as line items. No COGS breakdown columns (those are
  suppressed when `allocate=false`).
- **Freight lines render** — pass-through per-leg lines with the
  "plus freight at cost" held-out note.
- **Fees folded into turnkey total** — the turnkey grand-total
  math ADDS the service fees (double-count-prevention note also
  present per CD spec).
- **Partial treatment coexists** — the unpriced tier's cell
  shows the placeholder ("from $X" or "total on request") without
  breaking the charges block or the freight display.

The point: the orthogonal-flags model handles all three states
simultaneously. If any of the three drops out (e.g., unpriced tier
suppresses charges block, or pass-through freight breaks turnkey
totals), that's a regression.

---

## §4 · Addendum-with-content

Seed a quote WITH ASY spec content on at least one leaf:

1. Add 1 assembly + 3 leaves.
2. Leaf 1: **typed leaf** — assign a Product Type (e.g., glass bottle),
   fill some spec values (barrier_coating, cap, dimensions, etc.).
3. Leaf 2: **placeholder leaf** — assign a Product Type but leave
   spec values NULL / empty.
4. Leaf 3: **untyped leaf** — no Product Type assigned.
5. Turn ON the `include_spec_addendum` checkbox in the Quote toolbar.

### 4.1 · Verification checklist

- **Addendum pages render AFTER pricing** — multi-page `<Document>`
  places addendum pages sequentially after the pricing pages (per
  Step 3b port).
- **Leaf 1 (typed)** — spec values render as filled rows.
- **Leaf 2 (placeholder)** — spec fields render but values show
  mono-italic `—` (the `.val.empty` treatment; requires
  JetBrains Mono italic — smoke-test that Font.register #77
  fix stayed intact).
- **Leaf 3 (untyped)** — leaf block renders with the "product type
  not yet assigned" state (per CD's untyped leaf spec).
- **Page footer meaningful** — addendum pages carry the same
  page footer as pricing pages (Page N of M continuous count).
- **Send this quote** → confirm the sent quote's
  `include_spec_addendum` snapshot column captured `true`;
  navigating back to the read-only preview still shows the
  addendum pages.

### 4.2 · Toggle behavior

- Toggle addendum OFF → preview updates, single-document render
  (pricing pages only).
- Toggle back ON → addendum pages return.
- Snapshot column moves through commits per Slice 11 Step 4
  autosave discipline.

---

## §5 · Affordances

On any smoke quote:

- **Download PDF** button → opens/downloads the PDF as attachment
  (Content-Disposition attachment; browser downloads instead of
  inline preview). Verified against Storage's persisted file when
  quote is sent; against the live-render path when draft.
- **Download + mail draft** → same download + `mailto:` opens
  the OS mail client with the customer email pre-filled and a
  compose subject / body. Confirm mail client actually opens; on
  a machine without a configured mail handler, the browser will
  no-op — that's platform behavior, not a Nexus bug.
- **↗ Send** → already covered in Gate 0.
- **manual-only banner** — force a manual-only state (Scenario B
  shape: one SKU dragging tier blend below target on the Pricing
  surface). Confirm the banner label + helpText read the copy
  stopgap from PR #120: `"Adjust cost inputs on the Costs
  surface, or send below-target acknowledging the risk."` No
  phantom "per-cell override" / "admin override" language.

---

## §6 · Print-mode B/W check (Edward eyeball)

Not a CB screen-check — a print-preview eyeball. Quick pass:

1. Open any smoke quote's preview PDF.
2. Browser print preview → toggle to grayscale.
3. **Recommended-tier treatment survives** — the ★ / bracket / tint
   still distinguishes the recommended tier from siblings under
   grayscale. If the "recommended" affordance was color-only, it
   disappears in print — that's a fidelity regression.

CD spec calls for the recommended-tier to be legible in B/W. Only
Edward's / CC's eye can confirm that.

---

## §7 · CD fidelity gate (the Pattern-30 check)

At any point during §2–§4 smoke, spot-check against CD's canonical
CSS + prototype HTML:

- Turnkey card LOOKS like a card (bordered, distinct fill, register
  matches CD).
- Recommended-tier bracket LOOKS like the R7b bracket (not a subtle
  underline or an accent color).
- Tiers render as flex columns in tier_table (not stacked).
- Addendum leaf-blocks visually distinct (not merged into a single
  wall of text).

An improvised port passes a "content walk" but fails fidelity — this
is the check that catches it. If a smoke passes §2 content checks
but fails §7, the port has fidelity drift. Report.

---

## §8 · Merge gate

Slice 11 closes when:

- [ ] §1 Gate 0 all 7 checks green
- [ ] §2 all 12 matrix cells green
- [ ] §3 orthogonal-flags combo green
- [ ] §4 addendum with all 3 leaf variants + snapshot behavior green
- [ ] §5 all affordances working
- [ ] §6 print-mode B/W recommended-tier legibility confirmed by
      Edward or CC
- [ ] §7 CD fidelity spot-check no drift
- [ ] Post-smoke: any bugs surfaced fixed + re-smoked

Once §1–§7 all green, Slice 11 is closed. Close-out banks landed
alongside this smoke (see CLAUDE.md Pattern 51 + 52 + ledger #80).

---

## §9 · Post-Slice-11 queue

- **Per-cell override UI wire (Part 2)** — the
  `suggestion_manual_only` recovery path. Data model + write path
  already shipped in Slice 11.5; UI wire per CA memo (SHOW
  BREAKDOWN dual-input, focus-scroll from manual-only banner,
  floor hard-block, overridden-cell visual marker, verify state
  resolution). Estimated 2-3 sessions.
- **MS OAuth** — open-pending-IT (tenant consent).
- **v1.1+ banked** — admin-override authorization; effective-until
  versioning on frozen columns (if reproducibility ever needs
  schema-level enforcement beyond draft-lock; see Pattern 52).

---

## §10 · Rollback plan (only if Gate 0 fails hard)

If the send path is fundamentally broken and blocking the smoke:

1. Revert PR #121 (Step 7 boundary gates) — unlikely to be the
   cause but the freshest change; rule it out.
2. Revert PR #120 (copy stopgap) — even less likely, but
   independent revert.
3. Revert PR #119 (Option B) — pricing-classifier work, orthogonal
   to send path; probably not the cause.
4. Roll back further only in consultation with Edward + CA.

The send path itself (`sendQuote` in `src/app/actions/quotes.ts`)
landed in Step 6 — that's the more likely regression source if
something's broken. Roll back to the pre-Step-6 tag as a last
resort; PMs would lose the send functionality entirely but Slice
10 baseline would be restored.

Report Gate 0 failures with the specific check (a-g) that failed
+ the SQL rows / Storage output / preview screenshot as evidence.
