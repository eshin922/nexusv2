# Customer View — fidelity matrix

**Every visible element of the reference of record, traced to the Nexus component and data
source that must supply it, with the gaps named rather than improvised around.**

Produced 2026-08-24, before implementation, per Edward's instruction.

**Authority:** [`design-authority/customer-view/`](design-authority/customer-view/) —
`design/Nexus Customer View.dc.html` is the reference of record; `README.md` carries the
measurements; `authority-model.md` (CP · Revision 1) carries ownership.
**Dispositions applied:** D1–D4 in
[`design-authority/customer-view/BUNDLE.md`](design-authority/customer-view/BUNDLE.md).

Legend for **Status**: **✅ have** · **🟡 partial** — exists but not in the shape the
authority needs · **🔴 gap** — nothing satisfies it · **⚪ UI** — presentation only, no data
dependency.

---

## 1 · Top bar

| Element | Source | Nexus supply | Status |
|---|---|---|---|
| `Nexus / {customer} / Customer view` | GOVERNED | `projects.client_name` via the resolver | ✅ |
| Quote chip `Q-2419 · draft` / `· v1 frozen` | GOVERNED | `quotes.quote_number`, `status`, `version_number` | ✅ |
| Verdict chip — `approval required` / `exception approved` / `within floor` | GOVERNED | `below_floor_authorizations` + `evaluateBelowFloorAuthorization` | 🟡 — the three states exist as concepts; no single resolved verdict value is exposed for a chip |
| Operator avatar + name | GOVERNED | `ensureUser()` | ✅ |

---

## 2 · Preview pane

| Element | Source | Nexus supply | Status |
|---|---|---|---|
| `What the customer receives` violet eyebrow | PREVIEW | new markup | ⚪ |
| Configuration summary line — `{Itemized\|Turnkey} · N tier(s) · {N charges billed separately \| all-in unit price}` | DERIVED | `detail_level` + shown tiers + constructed charge placements | 🟡 — every input exists; the sentence is new |
| `{N} page PDF` | DERIVED | `1 + (addendum ? 1 : 0)` | ✅ |
| Zoom stepper — default `0.78`, step `0.08`, clamp `0.50–1.15`, `transform: scale()` | PREVIEW | operator-local, not persisted | ⚪ — **but see G7**: our preview is a PDF in an `<iframe>`, which cannot be `transform: scale()`d the way a DOM document stack can |
| Frozen banner — *"Recovery and presentation frozen on v1 · {date} · changes create v2"* | GOVERNED | `quotes.status`, `sent_at`, `version_number` | ✅ |
| Document canvas — diagonal hatch, 816px stack, `min-height: 1056px` per page | ⚪ | new CSS | ⚪ — **G7** applies |

---

## 3 · Card 0 · Governed · not editable here

Dashed border, lock glyph. Four rows: label / value / source tag.

| Row | Source | Nexus supply | Status |
|---|---|---|---|
| `Goods sell · {recommended tier}` | GOVERNED · pricing | `quoteRollup[].totalRevenue` less charge revenue | 🟡 — derivable, not currently exposed as "goods sell" separate from charge revenue |
| `Charges at cost` | GOVERNED · costs | `constructed.totalChargeCost` | ✅ |
| `Approved recovery` | GOVERNED · pricing | — | **🔴 G1** |
| `Margin floor / target` | GOVERNED · policy | `firm_settings.floor_margin_pct` / `target_margin_pct` | ✅ |
| Footer paragraph with routes to Costs and Pricing | ⚪ | new markup + links | ⚪ |
| Source tags (`pricing` / `costs` / `policy`) | — | new | ⚪ — required: *"a read-only mirror with no source label is worse than no mirror"* |

---

## 4 · Card 1 · Commercial recovery

Per D1 this applies at charge grain to **every governed recoverable charge in the registry**,
not freight only.

| Element | Source | Nexus supply | Status |
|---|---|---|---|
| One row per charge, label + approved recovery amount | GOVERNED | `RECOVERY_CHARGES` + `constructed.charges[]` | 🟡 — rows and labels ✅; the amount is **G1** |
| Policy line — `policy: {allowed options} · cost governed` | GOVERNED | `registry.available` / `refusals` | ✅ |
| Segmented `In unit price` / `Separate` / `Absorbed` | this surface | `setChargeRecovery` + `refusalFor` | ✅ — certified; this is the card that was deleted |
| Impermissible options rendered **disabled with a reason**, never hidden | — | `refusalFor` reasons | ✅ — built and certified |
| `Absorbed` | policy | — | **🔴 G2** |
| Margin-after-recovery card per tier — pct + below-floor / below-target / on-target | GOVERNED | `quoteRollup[].blendedMarginPct` vs floor/target | 🟡 — margin per tier ✅; the *"after recovery"* framing needs the elected construction, which exists |
| Tiers **not shown** still evaluated, ` · not shown`, `opacity 0.62` | GOVERNED | all tiers are evaluated today | ✅ |
| Governance note — blocked / approved-exception / within-floor | GOVERNED | `evaluateBelowFloorAuthorization` | 🟡 — states exist; the three copy variants are new |
| **Election voids a prior approval** (`approval → null`) | — | fingerprint supersession exists but only **warns** | **🔴 G3** |

---

## 5 · Card 2 · Customer presentation

*"Never changes economics. Display only."* This is the card `quote-presentation-profile-brief.md`
was actually describing.

| Element | Source | Nexus supply | Status |
|---|---|---|---|
| Shape — `Itemized` / `Turnkey` with mono sub-labels | PRESENT | `detail_level` | 🟡 — **G4**: no draft persistence |
| Tiers shown — one toggle per tier | PRESENT | `presentation_profile.shown` | **🔴 G4** |
| `Recommended` tier picker | PRESENT | `quote_tiers.recommended` exists | 🟡 — column exists; not wired as a presentation control |
| Four include-toggles — fee itemization, terms, addendum, note | PRESENT | `include_*` | 🟡 — addendum/detail exist as URL params only (**G4**) |
| Pill switch 28×16, `Hide`/`Show` state chip, row background step | ⚪ | new component | ⚪ |
| Customer note, ≤400 chars, live counter | CUSTOMER | `quotes.customer_facing_notes` | ✅ — cap and counter are new |
| Fee-fold sentence survives the toggle (*"never erases the charge"*) | DERIVED | projection | 🟡 — needs the `include_fee_lines` flag (**G4**) |

---

## 6 · Card 3 · Accounting handoff

Internal-violet. Three parts — **not** the 16-row per-tier register currently in production.

| Element | Source | Nexus supply | Status |
|---|---|---|---|
| `internal` chip + scope line | ⚪ | new | ⚪ |
| **Commercial agreement** — per **charge**: label / `{recovery word} · ${amount}` / source tag | DOWNSTREAM | `projectFrozenInstructions` per charge | 🟡 — ours is per (charge, **tier**); the authority is per charge with `this quote` / `not billed` tags |
| Recovery words — `in unit price` / `billed separately` / `absorbed — not charged` | — | `placement` | ✅ |
| Payment terms · Deposit · Bill to · Incoterms | DOWNSTREAM | `firm_settings` snapshots | 🟡 — **G5** governs the deposit |
| **Customer received** — seven derived rows, outcome not flag, *"derived at render, never stored as prose"* | DERIVED | projection of the profile | **🔴 G4** |
| **Instruction to Accounting** — the one authored field | DOWNSTREAM | — | **🔴 G6** |

---

## 7 · Pinned finalize footer

| Element | Source | Nexus supply | Status |
|---|---|---|---|
| Send chip — `frozen · v1` / `blocked` / `draft` / `approved exception` | GOVERNED | `quotes.status` + authorization state | 🟡 — same missing single verdict as the top-bar chip |
| Readiness checklist, 4 rows, ✓ / ! marks | DERIVED | governance state, presentation summary, instruction presence, manual-delivery reminder | 🟡 — row 3 needs **G6** |
| Primary — **`Freeze & send`** (D2) / `Request pricing approval` when blocked / `Frozen — start v2` | — | `sendQuote`; `reviseFromAccepted` for v2 | 🟡 — the **blocked** state must gate `sendQuote`, which today it does not do from this surface |
| `⤓ Download PDF` · `↳ Download + mail draft` | — | existing download route + `mailto:` | ✅ |
| Artifact line — draft-marked vs frozen v1 | DERIVED | `pdf_url` / snapshot | ✅ |
| Foot paragraph, four state variants | ⚪ | new copy | ⚪ |

---

## 8 · The document

Governed by the existing customer-PDF render contract and **unchanged** by this bundle
(*"Everything the customer-facing render layer establishes holds unchanged"*). Not re-traced
here. The only new dependencies are the presentation flags in §5, all of which are **G4**.

---

## 9 · Gaps — what the certified engine cannot satisfy today

Named, not improvised around. Each needs a decision before it is built.

### 🔴 G1 · "Approved recovery" is not a governed field

The authority treats cost and recovery as **two independently governed numbers** — its
fixture reads `Container freight — 900 → 1,150`, `Tooling — 1,400 → 1,750`. Card 0 shows
`Charges at cost` and `Approved recovery` as separate rows from separate owners.

Nexus derives recovery: `recoverableSell = cost × (1 + markup_rate)`, resolved from
`markup_defaults` / the quote's pins. There is no *approved recovery amount* anywhere, and no
approver for one.

**Decision needed.** Either the authority's "approved recovery" **is** our rate-derived
`recoverableSell` under a different name — in which case Card 0's `pricing` source tag is
correct and nothing is missing — or Pricing must gain a per-charge approved amount, which is
a Pricing-side schema and workflow change. **This is the largest gap and it is upstream of
this surface.**

### 🔴 G2 · `Absorbed` still cannot be honoured

The authority is explicit about why it matters: *"absorbed charges add cost but no revenue.
Absorbing is what pushes margin toward the floor."*

Ours refuses `absorbed` because `absorbedCost` is read by no consumer — the charge would
vanish from cost truth while DPS still pays it. D1 permits absorbed *"only where policy
allows it and absorbed cost is demonstrably retained in margin/floor economics."* That
retention does not exist yet.

**Work required:** carry `absorbedRecovery`'s cost into the margin basis so an absorbed
charge lowers margin. Until then `absorbed` stays refused with its reason — which the
authority's own "render disabled with a reason" rule accommodates exactly.

### 🔴 G3 · An election does not void a live approval

The authority: *"Picking a permitted option sets that charge's recovery mode **and voids any
prior approval**. This is load-bearing: an approved below-floor exception must not survive a
change to the economics it approved."*

We have the mechanism — `fingerprintCommercialState`, BV-005 invalidation — but
`setChargeRecovery` only **warns** via `loadRecoverySupersessionWarning`. It does not
invalidate.

**Decision needed:** does an election invalidate directly, or does the existing
fingerprint-comparison path already satisfy BV-005 when the fingerprint moves? These must not
both be authorities for the same question.

### 🔴 G4 · Presentation profile has no draft persistence

`presentation_profile` does not exist. Layout / detail / addendum live as URL params and React
context; tiers-shown, recommended-as-presentation, and the four include flags do not exist at
all. An operator loses every choice on reload — this is F1–F3 from #326, still open, and
Card 2 and the *Customer received* summary both depend on it.

**This is the prerequisite slice.** Card 2 cannot be built truthfully without it.

### 🔴 G5 · Deposit dollars

`authority-model.md` §2a, LOAD-BEARING: *"A presentation choice must never be the operand of
a downstream money calculation."* No accepted tier → `Deposit · 50% of accepted tier —
resolves on acceptance`, **no dollar amount anywhere**. Accepted tier → the order's figure,
mirrored with its source tag.

Note this directly contradicts the older `data-source-map.md`, which computes
`deposit_pct × presented total`. **Revision 1 governs** — see §10.

### 🔴 G6 · No authored Accounting instruction

`accounting_handoff.instruction` does not exist. The frozen recovery instruction Nexus writes
today is *derived*; this is *authored*, and they are different records with different owners.

### 🔴 G7 · The zoomable document stack vs our PDF iframe

The authority renders the document as a DOM page stack at 816×1056 with
`transform: scale(zoom)`. Nexus renders the real PDF in an `<iframe>` via the customer-pdf
route — deliberately, because it is the same render path the customer receives, and Chrome's
plugin supplies its own zoom.

**Decision needed:** keep the iframe (accepting the browser's zoom UI instead of the
authority's stepper, and losing page-break visibility as a DOM fact), or render a DOM preview
alongside the PDF (a second render path — the thing every prior slice refused to add).

### 🟡 G8 · `presentation_record` is partial

We have `quote_snapshot_artifacts` with `cpdf_data`, `structure`, `schema_version`, and
`quotes.pdf_url`. The authority additionally requires `artifact_sha256`, `page_count`, and
`delivery_state` / `delivered_by` / `delivered_at` / `delivery_channel` — the last group so
the surface can say *not sent* and never claim otherwise.

### 🟡 G9 · No single resolved verdict value

Both the top-bar chip and the send chip need one resolved state
(`approval required` / `exception approved` / `within floor`). The inputs exist; the resolved
value is not exposed.

---

## 10 · Conflicts inside the bundle

The bundle is layered, and the layers disagree. Recorded so nobody silently picks.

| | Earlier | CP · Revision 1 | Governs |
|---|---|---|---|
| Deposit dollars | `deposit_pct × presented total` (`data-source-map.md`) | forbidden unless an accepted tier exists (§2a) | **Rev 1** |
| `invoice_trigger`, `ap_contact` | authored here (`data-source-map.md`) | withdrawn — *"made it a second authority for order configuration"* (§1) | **Rev 1** |
| Primary action | `Freeze & send` (README) | `Finalize presentation` (§4) | **`Freeze & send`** — D2 |
| Recovery scope | five charges, three modes (README fixture) | freight only (§1a) | **every governed recoverable charge** — D1 |
| Preview width | — | 880px constraint removed, fluid to 816pt (§5) | **Rev 1** |
| Delivery | `Send to customer` (`data-source-map.md`) | delivery is manual and recorded, never asserted (§4) | **Rev 1** |

D1 and D2 are Edward's Tier-1 dispositions; the rest resolve to Revision 1 as the later
in-place revision of the same document set.

---

## 11 · What I need before implementing

1. **G1** — is "approved recovery" our rate-derived `recoverableSell`, or a new
   Pricing-owned approved amount? Everything in Card 0 and Card 1 hangs on this.
2. **G3** — does an election invalidate an approval directly, or is the existing fingerprint
   path the authority?
3. **G7** — iframe or DOM preview.
4. **Sequencing** — G4 (`presentation_profile`) is a prerequisite for Card 2 and for Card 3's
   *Customer received*. Card 0, Card 1 and the footer do not depend on it. My recommendation
   is Card 1 first, since it is the consequential card, its engine is certified, and it is the
   one currently missing from a surface the authority places it on.

Nothing is built until 1–3 are dispositioned. `VISUAL_FIDELITY: PENDING`; the operator flag
stays; F1–F3, SEND closure and S-7 remain held.
