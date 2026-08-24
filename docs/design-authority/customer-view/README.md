# Handoff: Nexus Customer View (Quote Presentation & Recovery)

## Overview

The Customer View is the surface where an operator decides **how governed costs are recovered** and **how the resulting price is presented to the customer**, then freezes and sends the artifact. It is a two-panel workspace:

- **Left (fluid):** a live WYSIWYG preview of the exact PDF the customer receives (letter-size pages, 816px document width, zoomable).
- **Right (fixed rail, default 452px):** the configuration stack — governed inputs (read-only), commercial recovery, customer presentation, accounting handoff — with a persistent send footer.

The core design thesis: **this surface never changes what costs are.** Costs and approved recovery amounts are owned upstream (Costs, Pricing). This surface decides only how those amounts are *recovered* (in unit price / billed separately / absorbed) and how they are *shown*. Recovery choices move economics and run through pricing governance; presentation choices never move economics.

## About the Design Files

The files in `design/` are **design references created in HTML** — prototypes showing intended look and behavior. They are **not production code to copy directly**.

The task is to **recreate this design in the target codebase's existing environment** (React, Vue, etc.) using its established component library, styling approach, and data layer. If no environment exists yet, choose the most appropriate framework and implement there.

The prototype uses a small in-house templating runtime (`support.js`) purely so the design could stream and render live. **Do not port `support.js`.** Read the template for markup/styling intent and the logic class for behavior/derivations; reimplement both idiomatically.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and interaction states are final and intentional. Recreate the UI pixel-accurately against the codebase's existing primitives. Every value below is exact.

All colors are authored in **OKLCH**. Convert to the codebase's color format if needed; do not eyeball substitutes — the palette's low-chroma warm neutrals are deliberate and sRGB hex approximations should be computed, not guessed.

---

## Screens / Views

There is one screen with many states. Layout from the top down:

### 1. Application top bar

- Height `56px`, `flex: none`, horizontal flex, `align-items: center`, `gap: 16px`, `padding: 0 22px`.
- Background `oklch(0.985 0.006 85)`, bottom border `1px solid oklch(0.88 0.012 85)`.
- Contents in order:
  1. `Nexus` — JetBrains Mono 11px, `letter-spacing: 0.08em`, uppercase, `oklch(0.68 0.012 255)`.
  2. `/` separator — `oklch(0.82 0.014 85)`.
  3. Customer name (`Lumen Beauty Co.`) — 13px, `oklch(0.52 0.015 255)`.
  4. `/` separator.
  5. `Customer view` — Newsreader 19px, weight 500.
  6. **Quote chip** — JetBrains Mono 11px, `padding: 3px 7px`, `radius: 4px`, bg `oklch(0.945 0.010 85)`, text `oklch(0.36 0.02 255)`, border `1px solid oklch(0.88 0.012 85)`. Text: `Q-2419 · draft`, or `Q-2419 · v1 frozen` when frozen.
  7. **Verdict chip** — JetBrains Mono 10px, `letter-spacing: 0.06em`, uppercase, `padding: 3px 7px`, `radius: 4px`. Three states:
     - `approval required` — bg `oklch(0.94 0.04 25)`, text `oklch(0.55 0.18 25)`
     - `exception approved` — bg `oklch(0.94 0.05 70)`, text `oklch(0.62 0.13 70)`
     - `within floor` — bg `oklch(0.94 0.035 155)`, text `oklch(0.55 0.10 155)`
  8. Spacer (`flex: 1`).
  9. User: 22px circular avatar, bg `oklch(0.92 0.04 255)`, text `oklch(0.28 0.12 255)`, initials 10px weight 600; then name at 12px `oklch(0.52 0.015 255)`.

### 2. Body

`flex: 1; min-height: 0; display: flex; overflow: hidden`. Two children: preview column (`flex: 1; min-width: 0`, right border `1px solid oklch(0.88 0.012 85)`) and rail (`flex: none`, width from prop).

### 3. Preview toolbar

- `padding: 9px 20px`, bg `oklch(0.985 0.006 85)`, bottom border `1px solid oklch(0.88 0.012 85)`, flex `gap: 14px`.
- Purple eyebrow pill: `What the customer receives` — JetBrains Mono 10px, `letter-spacing: 0.07em`, uppercase, text `oklch(0.55 0.06 300)`, bg `oklch(0.95 0.02 300)`, `padding: 3px 8px`, `radius: 4px`.
- Summary line, 12px `oklch(0.52 0.015 255)`: `{Itemized|Turnkey} · N tier(s) · {N charges billed separately | all-in unit price}`.
- Right: `{N} page PDF` (JetBrains Mono 11px), then a zoom stepper — container `padding: 3px`, bg `oklch(0.965 0.008 85)`, border `1px solid oklch(0.88 0.012 85)`, `radius: 7px`; `−` / percentage / `+`. Percentage cell `min-width: 38px`, centered, JetBrains Mono 11px.
- **Zoom:** default `0.78`, step `0.08`, clamped `0.50 – 1.15`. Applied as `transform: scale(z)` with `transform-origin: top center` on the document stack.

### 4. Frozen banner (conditional)

Shown only when `frozen === true`. `padding: 9px 20px`, bg `oklch(0.94 0.035 155)`, bottom border `1px solid oklch(0.88 0.012 85)`, 12.5px text `oklch(0.36 0.02 255)`. Label `frozen` in JetBrains Mono 10px uppercase `letter-spacing: 0.07em`, `oklch(0.55 0.10 155)`. Copy: `Recovery and presentation frozen on v1 · Aug 21, 2026 · changes create v2.`

### 5. Document canvas

- `flex: 1; overflow: auto; padding: 28px 0 60px`.
- Background is a diagonal hatch conveying "not app chrome":
  `repeating-linear-gradient(-45deg, oklch(0.955 0.008 85) 0 8px, oklch(0.965 0.008 85) 8px 16px)`.
- Document stack: `width: 816px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px`.

#### Page shell (each page)

`background: oklch(0.995 0.003 85)`, `box-shadow: 0 24px 60px oklch(0.20 0.02 255 / 0.10)`, `border: 1px solid oklch(0.88 0.012 85)`, `padding: 54px 58px 42px`, `min-height: 1056px`, column flex. A `flex: 1` spacer pushes the footer to the bottom of the sheet.

#### Page 1 — pricing document

**Letterhead.** Space-between, bottom border `1.5px solid oklch(0.20 0.02 255)`, `padding-bottom: 18px`.
- Left: `The DPS` Newsreader 26px weight 500; tagline 11.5px `oklch(0.52 0.015 255)`, `max-width: 250px`, `line-height: 1.45`: "Turnkey product development & manufacturing for beauty, health & wellness brands".
- Right: JetBrains Mono 10.5px, `line-height: 1.8`, `oklch(0.36 0.02 255)`, right-aligned — doc number (12px, `oklch(0.20 0.02 255)`), `Issued · August 21, 2026`, `Valid until · October 15, 2026`.

**Parties.** Two-column grid, `gap: 40px`, `padding: 20px 0 24px`. Each column: eyebrow (JetBrains Mono 9.5px, `letter-spacing: 0.09em`, uppercase, `oklch(0.68 0.012 255)`), name (Newsreader 16px), details (11.5px `oklch(0.52 0.015 255)`, `line-height: 1.6`).

**Pricing section — itemized shape.**
- Eyebrow: `Tiered pricing` (or `Confirmed pricing` when one tier shown).
- Title: Newsreader 21px — `Per-unit pricing across volume tiers` (or `Per-unit pricing · Tier N`).
- Lede: 12px `oklch(0.36 0.02 255)`, `line-height: 1.55`, `max-width: 630px`. Text depends on whether any charge is billed separately (EXW vs FOB copy) plus a recommended-tier sentence when >1 tier is shown.
- Table is a CSS grid: `grid-template-columns: 1fr repeat(N, W)` where `W` = `190px` (1 tier), `140px` (2), `112px` (3).
  - Header row: bottom border `1px solid oklch(0.20 0.02 255)`; `Product` eyebrow left; each tier column right-aligned with label (JetBrains Mono 11px) and sub (JetBrains Mono 9.5px `oklch(0.52 0.015 255)`) — sub gains ` · recommended` on the recommended tier.
  - SKU rows: `padding: 10px 0`, bottom border `1px solid oklch(0.92 0.010 85)`. Name Newsreader 14.5px; meta JetBrains Mono 10px `oklch(0.52 0.015 255)`. Cells right-aligned, `padding-left: 14px`: unit price JetBrains Mono 13px, extended JetBrains Mono 10px `oklch(0.52 0.015 255)`.
  - **Landed-charges row** (only when ≥1 charge is `included`): name `Landed charges — N items`, sub-line italic 11px "landed in the unit price above"; per column shows amortized per-unit and extended included total.
  - **Total row:** `padding: 12px 0`, bg `oklch(0.975 0.010 85)`, bottom border `1.5px solid oklch(0.20 0.02 255)`. Label Newsreader 15px weight 500 — `Unit-price subtotal` if any charge is separate, else `Turnkey total`; sub italic 11px. Columns: total JetBrains Mono 15px weight 500, then `$X.XX /unit` JetBrains Mono 10px.

**Pricing section — turnkey shape.** Replaces the table with a `gap: 14px` row of one card per shown tier: `flex: 1`, border `1px solid oklch(0.88 0.012 85)`, `padding: 16px`, bg `oklch(0.985 0.006 85)`; label, sub, then total in Newsreader 25px and `$X.XX /unit` beneath. Followed by a `What this price includes` block — eyebrow, then 12px lines at `line-height: 1.85`: `→` for included items, `×` for separately invoiced.

**Charges billed separately** (when any charge is `separate`). Top border, eyebrow `Charges billed separately`, disclaimer 11.5px, then rows in `grid-template-columns: 1fr auto auto; gap: 20px`, baseline-aligned, `padding: 6px 0`, bottom border `1px solid oklch(0.94 0.008 85)`. Label 12.5px with ` · {basis}` in 11px `oklch(0.68 0.012 255)`; qty JetBrains Mono 10.5px; amount JetBrains Mono 12px, `min-width: 80px`, right-aligned. Footer row: `Total payable · Tier N` 12.5px weight 500 + amount JetBrains Mono 13.5px weight 500.

**Included in the price above** (itemized + `feeLines` on). Same three-column row pattern at `padding: 5px 0`.

**Fee note** (itemized + `feeLines` off + charges included). Single 11.5px sentence: "Freight, duty, tooling and one-time fees of $X are included in the totals above — itemization available on request."

**Commercial terms** (when on). Two-column grid `gap: 13px 40px`, top border `1px solid oklch(0.20 0.02 255)`. Four pairs: eyebrow key + 13px value — Valid until, Payment terms, Lead time, Incoterms (EXW when freight is separate, else FOB).

**Notes** (when on and non-empty). `padding: 13px 15px`, bg `oklch(0.975 0.010 85)`, `border-left: 2px solid oklch(0.82 0.014 85)`; eyebrow `Notes`; body 12.5px `line-height: 1.6`.

**How to accept.** Newsreader 15px heading; 12px body `max-width: 560px`, `line-height: 1.6`: "Reply to this quote with the tier and quantity you'd like to proceed on. We'll issue a PO confirmation and production schedule within 2 business days of acceptance."

**Page footer.** Top border `1px solid oklch(0.92 0.010 85)`, JetBrains Mono 9.5px `oklch(0.68 0.012 255)`, space-between: `The DPS · {docNumber}` / `Page 1 of {N}`.

#### Page 2 — specification addendum (optional)

Running head (JetBrains Mono 10px, space-between, bottom border), eyebrow `Addendum A`, title `Product specifications` (Newsreader 21px), then one panel per SKU: border `1px solid oklch(0.90 0.010 85)`, `padding: 15px 17px`, `margin-bottom: 11px`; header row = name (Newsreader 16px) + code (JetBrains Mono 10.5px); then a 3-column grid `gap: 14px` of 6 spec fields (eyebrow key 9px + 12px value).

---

### 6. Configuration rail

Scrolling column, `padding: 16px 16px 24px`, `gap: 13px`, bg `oklch(0.965 0.008 85)`. Four cards, then a pinned footer.

#### Card 0 — Governed · not editable here

Visual language for "read-only, owned elsewhere": bg `oklch(0.945 0.010 85)`, **dashed** border `1px dashed oklch(0.82 0.014 85)`, `radius: 10px`, `padding: 12px 14px`. Header row: eyebrow `Governed · not editable here` + lock glyph at right.

Four rows (label 12px / value JetBrains Mono 11.5px / source tag JetBrains Mono 9px uppercase `min-width: 58px` right-aligned):
| Row | Value | Source |
|---|---|---|
| Goods sell · {recommended tier} | computed | pricing |
| Charges at cost | sum of charge costs | costs |
| Approved recovery | sum of approved recovery | pricing |
| Margin floor / target | 25% / 30% | policy |

Footer paragraph, 11px `line-height: 1.5`, with links to Costs and Pricing: cost amounts are owned upstream; this surface decides how they are **recovered** and how they are **shown** — never what they are. ("recovered"/"shown" emphasized at weight 500, `oklch(0.36 0.02 255)`.)

#### Card 1 — Commercial recovery *(step numeral `1`)*

bg `oklch(0.985 0.006 85)`, border `1px solid oklch(0.82 0.014 85)` (heavier than card 2 — this is the consequential card), `radius: 10px`, `overflow: hidden`.
Header: numeral (JetBrains Mono 10px `oklch(0.68 0.012 255)`), title Newsreader 16px `Commercial recovery`, sub 11.5px "Changes sell price and margin. Runs through pricing governance."

One row per charge, `padding: 10px 14px`, bottom border `1px solid oklch(0.94 0.008 85)`:
- Label 13px + approved recovery amount (JetBrains Mono 11.5px) on the right.
- Policy line, JetBrains Mono 9.5px `oklch(0.68 0.012 255)`: `policy: {allowed options, lowercased, " / " joined} · cost governed`.
- Segmented buttons (`gap: 5px`): `In unit price` / `Separate` / `Absorbed`. **Options not permitted by the charge's governed policy render disabled** (`opacity: 0.42`, `cursor: not-allowed`) with a `title` giving the reason. Disabled options are still rendered — the constraint must be visible, not hidden.

Footer block, bg `oklch(0.975 0.010 85)`, `padding: 11px 14px`: eyebrow `Margin after recovery · all governed tiers · floor 25% · target 30%`, then one margin card per tier (`gap: 6px`, `flex: 1`, `radius: 7px`, `padding: 7px 9px`) showing label, percentage (JetBrains Mono 14px), and state:
- below floor — bg `oklch(0.94 0.04 25)`, text `oklch(0.55 0.18 25)`
- below target — bg `oklch(0.94 0.05 70)`, text `oklch(0.62 0.13 70)`
- on target — bg `oklch(0.94 0.035 155)`, text `oklch(0.55 0.10 155)`

Tiers not shown to the customer are still evaluated; their card gets ` · not shown` appended and `opacity: 0.62`.

Governance note beneath, 11.5px, red (`oklch(0.55 0.18 25)`) when approval is implicated, else `oklch(0.52 0.015 255)`. Three variants — blocked, approved-exception, within-floor (exact copy in the logic).

#### Card 2 — Customer presentation *(step numeral `2`)*

Same shell but a lighter border `1px solid oklch(0.88 0.012 85)` — deliberately quieter than card 1. Sub: "Never changes economics. Display only."

- **Shape** — two segmented buttons: `Itemized` / `line by line`, `Turnkey` / `one number`. Sub-labels are JetBrains Mono 9.5px at `opacity: 0.7`.
- **Tiers shown** — one toggle per tier (label + qty sub). Then a `Recommended` row with tight segmented tier buttons.
- **Include toggles** — four rows, each a clickable row (`padding: 10px 14px`, `gap: 10px`, bottom border) with a 28×16 pill switch (`radius: 8px`, `padding: 2px`, knob 12px circle bg `oklch(0.995 0.003 85)` with `0 1px 2px oklch(0.20 0.02 255 / 0.25)`; track `oklch(0.42 0.14 255)` on / `oklch(0.86 0.012 85)` off; `transition: all 140ms`), label 12.5px + dynamic meta 11px, and a right-side state chip reading `Hide` (on) or `Show` (off) — off-state chip uses border `oklch(0.42 0.14 255)`, bg `oklch(0.92 0.04 255)`, text `oklch(0.28 0.12 255)`, weight 500, and the row background steps to `oklch(0.972 0.008 85)`. The four toggles: Itemize included charges, Commercial terms block, Specification addendum, Customer note.
- **Customer note** — eyebrow + `{n}/400` counter; textarea 3 rows, `radius: 7px`, border `1px solid oklch(0.82 0.014 85)`, `padding: 8px 9px`, 12.5px, `line-height: 1.55`, bg `oklch(0.995 0.003 85)`. Hard cap 400 chars. Placeholder: "Printed verbatim above How to accept."

#### Card 3 — Accounting handoff *(step numeral `3`)*

Purple family to mark "internal, never printed": bg `oklch(0.95 0.02 300)`, border `1px solid oklch(0.90 0.03 300)`. Header title Newsreader 16px, sub 11.5px `oklch(0.45 0.04 300)`: "Inherited on acceptance. Never printed for the customer." Right-side `internal` chip: JetBrains Mono 9px uppercase, bg `oklch(0.985 0.006 85)`, border `1px solid oklch(0.90 0.03 300)`, text `oklch(0.55 0.06 300)`.

- **Commercial agreement · read-only** — one row per charge (`{label}` / `{recovery word} · ${amount}` / source tag), then Payment terms, Deposit, Bill to, Incoterms. Recovery words: `in unit price`, `billed separately`, `absorbed — not charged`. Source tag is `not billed` for absorbed charges, else `this quote`.
- **Customer received · derived** — key/value list (key JetBrains Mono 9.5px uppercase `min-width: 92px`) summarizing shape, tiers shown, recommended tier, included/separate/absorbed charges, fees, terms, addendum, note. Absorbed line explicitly appends "— never shown to the customer".
- **Instruction to Accounting · authored here** — textarea, purple border, same metrics as the customer note, no cap.

#### Rail footer (pinned)

`flex: none`, top border `1px solid oklch(0.82 0.014 85)`, bg `oklch(0.985 0.006 85)`, `padding: 12px 16px 15px`, `box-shadow: 0 -8px 24px oklch(0.20 0.02 255 / 0.05)`.

- **Send chip + recipient.** Chip states: `frozen · v1` (green), `blocked` (red), `draft`/`approved exception` (amber) — JetBrains Mono 9.5px uppercase.
- **Checklist**, 4 rows, 12px, `gap: 4px`; each with a 15px circular mark — `✓` on `oklch(0.94 0.035 155)` / `oklch(0.55 0.10 155)`, or `!` on `oklch(0.94 0.04 25)` / `oklch(0.55 0.18 25)`. Items: governance state, presentation summary, accounting-instruction presence, and a fixed reminder that delivery is manual.
- **Primary button**, full width, `radius: 7px`, `padding: 11px 14px`, 13.5px weight 500. Three states:
  - not frozen, within floor / approved → `Freeze & send`, bg `oklch(0.42 0.14 255)`, text `oklch(0.985 0.006 85)`
  - blocked → `Request pricing approval`, bg `oklch(0.94 0.04 25)`, border+text `oklch(0.55 0.18 25)`
  - frozen → `Frozen — start v2`, bg `oklch(0.965 0.008 85)`, border `oklch(0.82 0.014 85)`, text `oklch(0.36 0.02 255)`
- **Secondary pair** (`gap: 7px`, each `flex: 1`): `⤓ Download PDF` and `↳ Download + mail draft`. Border `1px solid oklch(0.82 0.014 85)`, bg `oklch(0.985 0.006 85)`, 12.5px, `radius: 7px`, `padding: 9px 10px`; hover border `oklch(0.52 0.015 255)`. Tooltips explain exactly what each does.
- **Artifact line**, JetBrains Mono 9.5px `oklch(0.68 0.012 255)`: whether the emitted PDF is draft-marked or the frozen v1 artifact.
- **Foot paragraph**, 11px `oklch(0.68 0.012 255)`, `line-height: 1.5` — four variants matching the state (frozen / blocked / approved exception / clean).

---

## Interactions & Behavior

**Zoom.** `−`/`+` step 0.08 within `[0.50, 1.15]`; label is `round(z*100)%`.

**Recovery election.** Picking a permitted option sets that charge's recovery mode **and voids any prior approval** (`approval → null`). This is load-bearing: an approved below-floor exception must not survive a change to the economics it approved. Non-permitted options are inert and explain themselves via tooltip.

**Governance gate.** Margin is evaluated for **every governed tier**, not only the tiers shown to the customer. If any tier's margin is below the 25% floor and no approval is granted, the surface is `blocked`: the send button becomes `Request pricing approval` and no artifact may be emitted. In the prototype, clicking it stands in for an out-of-band Pricing approval (`approval → "granted"`); in production this must dispatch a real approval request and the state must return from the server.

Consequence to preserve: a display toggle can never clear a floor breach.

**Freeze.** With no blocking condition, `Freeze & send` sets `frozen`. Frozen state changes the doc number (drops ` · draft`), shows the frozen banner, relabels chips, disables recovery edits (`pick` handlers become no-ops), and switches the primary button to `Frozen — start v2` (which unfreezes — production should instead create a v2 record).

**Presentation toggles.** All immediately re-render the preview. If every tier is deselected, the preview falls back to the recommended tier alone (never render an empty document).

**Text fields.** Customer note capped at 400 chars, counter live. Accounting instruction uncapped. Both `onChange` (per keystroke).

**Delivery is manual.** Nexus never emails the customer. The two secondary actions generate the PDF locally; the mail action additionally opens a draft in the OS mail client. Do not silently add server-side send.

---

## State Management

```
recovery: Record<chargeId, "included" | "separate" | "absorbed">
detail:   "itemized" | "turnkey"
shown:    Record<tierId, boolean>
recTier:  tierId
include:  { feeLines, terms, note, addendum }: boolean
note:     string (≤400)
acctNote: string
zoom:     number (0.50–1.15)
frozen:   boolean
approval: null | "requested" | "granted"
```

Initial values: recovery = each charge's `default` (all `included`), `detail: "itemized"`, all tiers shown, `recTier: "t2"`, `include: {feeLines: true, terms: true, note: true, addendum: false}`, `zoom: 0.78`, `frozen: false`, `approval: null`.

### Derived economics (per tier)

```
goodsSell  = Σ(sku.prices[tierIdx]) × tier.qty
goodsCost  = goodsSell × GOODS_COST_RATIO      // 0.62 in the prototype
included   = Σ recover  where mode == "included"
separate   = Σ recover  where mode == "separate"
absorbed   = Σ recover  where mode == "absorbed"
chargeCost = Σ charge.cost                      // all charges, regardless of mode
revenue    = goodsSell + included + separate
cost       = goodsCost + chargeCost
unitTotal  = goodsSell + included
payable    = revenue
perUnit    = unitTotal / tier.qty
amortUnit  = included / tier.qty
margin     = (revenue - cost) / revenue
```

Note the asymmetry that carries the design's meaning: **absorbed charges add cost but no revenue.** Absorbing is what pushes margin toward the floor.

Floor `0.25`, target `0.30`. Comparisons use a `1e-6` epsilon.

### Server-owned in production

- Charge definitions, their **costs**, their **approved recovery amounts**, and their `allowed` recovery policies + refusal reasons.
- SKU/tier price matrix and the goods cost basis.
- Margin floor/target policy.
- Approval state and approver identity.
- Quote version and freeze record.

Client-owned: recovery elections (within policy), presentation choices, both note fields, zoom.

### Prototype fixture data

**Tiers:** t1 = 1,000 units · t2 = 5,000 · t3 = 10,000.

**SKUs** (unit prices at t1/t2/t3):
- Primary bottle · 200ml — `BTL-200 · 24/case` — 3.62 / 3.28 / 3.05
- Airless pump — `PMP-4208 · 48/case` — 1.94 / 1.71 / 1.58
- Serum fill, cap & label — `FIL-SER · per unit` — 2.40 / 2.15 / 1.98

**Charges** (cost → approved recovery · basis · allowed):
- Container freight — 900 → 1,150 · per shipment · included/separate (cannot absorb: "Policy: freight must be recovered")
- Duty & tariffs — 520 → 520 · pass-through, at cost · included/separate (cannot absorb: "Statutory pass-through — cannot be absorbed")
- Tooling — pump collar — 1,400 → 1,750 · one-time · all three
- Project setup — 700 → 900 · one-time · all three
- Artwork & plate — 300 → 380 · per SKU · 3 SKUs · included/absorbed (cannot separate: "Not separately invoiceable")

Spec addendum fields for the three SKUs are in the logic class (`SPECS`).

### Formatting

- Money: `"$" + Math.round(n).toLocaleString("en-US")` — whole dollars, thousands separators.
- Unit price: `"$" + n.toFixed(2)`.
- Percent: `(n*100).toFixed(1) + "%"`.

---

## Design Tokens

### Color (OKLCH)

| Token | Value | Use |
|---|---|---|
| canvas | `oklch(0.965 0.008 85)` | app background, rail background |
| surface | `oklch(0.985 0.006 85)` | bars, cards |
| paper | `oklch(0.995 0.003 85)` | document sheet, inputs |
| surface-sunken | `oklch(0.945 0.010 85)` / `oklch(0.975 0.010 85)` | governed card, total row, footers |
| ink | `oklch(0.20 0.02 255)` | primary text, rules |
| ink-2 | `oklch(0.36 0.02 255)` | body text |
| ink-3 | `oklch(0.52 0.015 255)` | secondary text |
| ink-4 | `oklch(0.68 0.012 255)` | eyebrows, meta |
| border | `oklch(0.88 0.012 85)` | default border |
| border-strong | `oklch(0.82 0.014 85)` | inputs, emphasized cards |
| border-hair | `oklch(0.92 0.010 85)` / `oklch(0.94 0.008 85)` | inner row rules |
| accent | `oklch(0.42 0.14 255)` | primary action, switches, links |
| accent-tint | `oklch(0.92 0.04 255)` | avatar, off-state chip, selection |
| accent-ink | `oklch(0.28 0.12 255)` | text on accent tint, link hover |
| danger | bg `oklch(0.94 0.04 25)` · fg `oklch(0.55 0.18 25)` | below floor, blocked |
| warn | bg `oklch(0.94 0.05 70)` · fg `oklch(0.62 0.13 70)` | below target, draft |
| ok | bg `oklch(0.94 0.035 155)` · fg `oklch(0.55 0.10 155)` | on target, frozen |
| internal | bg `oklch(0.95 0.02 300)` · border `oklch(0.90 0.03 300)` · fg `oklch(0.55 0.06 300)` / `oklch(0.45 0.04 300)` | accounting handoff, preview eyebrow |

### Typography

Three families, each with one job:
- **Newsreader** (serif, 300–600) — document headings, card titles, figures on the paper. Sizes used: 26, 25, 21, 19, 16, 15, 14.5.
- **Instrument Sans** (400/500/600) — all UI and body copy. Sizes: 13.5, 13, 12.5, 12, 11.5, 11.
- **JetBrains Mono** (400/500) — numbers, codes, eyebrows, state chips. Sizes: 15, 14, 13, 12, 11.5, 11, 10.5, 10, 9.5, 9. Eyebrows: `letter-spacing: 0.09em`, uppercase; chips `0.06–0.07em`.

Google Fonts: `Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500`, `Instrument+Sans:wght@400;500;600`, `JetBrains+Mono:wght@400;500`.

Body: `-webkit-font-smoothing: antialiased`, `::selection` background `oklch(0.92 0.04 255)`.

### Radius

`4px` chips · `5px` small state chips · `6px` segmented buttons · `7px` inputs, buttons, margin cards, zoom stepper · `8px` switch track · `10px` rail cards · `50%` avatar, checklist marks.

### Shadow

- Document sheet: `0 24px 60px oklch(0.20 0.02 255 / 0.10)`
- Rail footer: `0 -8px 24px oklch(0.20 0.02 255 / 0.05)`
- Switch knob: `0 1px 2px oklch(0.20 0.02 255 / 0.25)`

### Spacing

Rail card padding `11–12px 14px`; rail gutter `16px`; card gap `13px`; document page `54px 58px 42px`; document gap `22px`; grid gaps `40px` (parties), `20px` (charge rows), `14px` (spec fields), `5–7px` (button groups).

### Transitions

Segmented buttons `all 120ms`; switch `all 140ms`. No entrance animations anywhere — this is an operational surface.

### Tweakable prop

`railWidth` — range, default `452`, min `380`, max `560`, step `8`, px. The preview column absorbs the remainder.

---

## Assets

No images, no icon library. The only glyphs are text characters: `−` `+` `✓` `!` `→` `×` `⤓` `↳` `🔒` `/` `·`. Replace `🔒` with the codebase's lock icon and `⤓`/`↳` with its download/forward icons if one exists; keep `✓`/`!`/`→`/`×` as characters (they're typeset, not iconography).

---

## Files

**`design/`**
- `Nexus Customer View.dc.html` — the source design: template markup with exact inline styles, plus the logic class holding all derivations, fixture data, and state transitions. **This is the reference of record.**
- `Nexus Customer View.standalone.html` — self-contained build; open in a browser to interact with the prototype. Reference only.
- `support.js` — the prototype's rendering runtime. Included so the standalone file can be traced; **do not port it.**

**`docs/`**
- `authority-model.md` — why this surface may not change cost or price, and what it *is* allowed to decide. Read this before implementing the governance gate.
- `data-source-map.md` — field-by-field ownership: which values come from Costs, Pricing, policy, or this surface.
- `designer-notes.md` — rationale for the rail's three-step structure and the presentation/economics split.
- `approval-states-design-position.md` — the position on approval states, including why an election change voids an approval.

### Implementation order suggested

1. Fixture data + `econ()` derivation and formatters — get the numbers right first; everything else is a view of them.
2. Document preview (itemized shape), then turnkey shape and the addendum page.
3. Recovery card with policy-constrained options and the margin cards.
4. Governance gate, checklist, and the send-state machine.
5. Presentation toggles and both note fields.
6. Accounting handoff card (pure projection of the above — no new state).
