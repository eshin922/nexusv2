# M2 — read-only Costs preview

Branch `feat/setup-costs-readonly-preview`, on top of `5ac569d7` (M1 close).
Uncommitted, for Codex review.

M2 of `approved-plan.md`: **the approved Costs presentation over a quote's real
records, behind an explicit switch, with no writers.** It is a labelled
milestone preview, not the finished workflow, and it says so on the surface.

Design authority: `C:/Code/nexusv2/nexus-handoff-2026-09-18-b/` — the three
canonical `.dc.html` files, `design-tokens.md`, `fidelity-checklist.md`,
`data-contract.md`, `screenshots/`. No prototype arithmetic, fixture taxonomy or
hard-coded rate was copied into production logic.

**Ready for Edward's review of the read-only Costs presentation.** Codex has
compared the rendered views against the bundle and corrected the discrepancies
below. This is not approval to enable editing or release the workflow. User
design acceptance remains pending.

---

## 0 · Scope split — interaction repair withdrawn

An interaction-repair draft (Packaging draft ownership + a post-commit revision
marker) was built during review and then **removed from this worktree** on
Codex's instruction, because its ownership helper leaned on a 5-second timeout:
time does not prove freshness, optimistic store equality is not server
confirmation, and a timeout postpones data loss rather than preventing it.

Preserved at
`C:/Code/nexus-validation-runs/financial-parity-diagnosis-20260918/interaction-draft/`
(patch, helpers, 7 mounted tests, and a README recording why the mechanism was
refused).

**The baseline interaction bugs are open and block M3. Nothing here solves
them.** They reproduce on pre-M2 `5ac569d7` as well:

- a draft in one cell replaced by another cell's reconcile;
- a committed markup (`0.0444`, `ok`, `revision 12526`) reverting to 20 in the
  UI;
- and the ordering marker itself is unsound — Codex falsified it locally, with
  no application row touched: a pre-commit snapshot and a post-commit snapshot
  can carry the **same** `xmax` (`12608:12610:12608` before, `12610:12610:`
  after). The provider's gate compares `revision < awaited`, so an equal marker
  passes.

What remains in this worktree from that work is only the **shared graph-reader
extraction** in `packaging-drilldown.tsx` — a move, with the original editor
handlers untouched. Verified: `git diff` of that file against HEAD contains no
change to any `useState` / `useEffect` / `onChange` / `onBlur` / dirty / pending
path.

---

## 1 · How to view it, and how to turn it off

```
/projects/<projectId>/quotes/<quoteId>/costs?preview=costs-m2
```

- **Off by default**, and fails closed: absent, empty, misspelled or a different
  milestone all render the existing workspace.
- **Turning it off is removing the parameter.** Nothing is persisted — no
  column, no cookie, no setting — so there is no state an old reader would have
  to understand. "Leave preview" drops only `preview=` and keeps `section=` and
  the selected tier.
- No environment or credential change; no entry point added to the default
  workspace, so the existing UI is unchanged when the switch is absent.
- Query-only suits local M2 opt-in. **It is not a claim about production
  rollout** — that needs its own reviewed release / kill-switch scope.

---

## 2 · File map

### New

| File | What it is |
|---|---|
| `src/lib/costs/m2-preview-switch.ts` | The switch: parameter, fail-closed predicate, href builder preserving every other parameter. |
| `src/lib/costs/costs-overview-model.ts` | **The shared read model.** Pure function from stored facts to owners → rows → charges. No queries, no arithmetic. |
| `src/lib/costs/packaging-line-graph-read.ts` | The packaging-line node read, lifted verbatim from `packaging-drilldown.tsx` so the drawer and the preview share one implementation. |
| `src/components/costs/preview/costs-m2-preview.tsx` | Store-connected half. The graph enters here and leaves as resolved data. |
| `src/components/costs/preview/costs-m2-preview-body.tsx` | Notice, gap panel, view switcher. Pure function of its props. |
| `src/components/costs/preview/spreadsheet-view.tsx` | `sheetBlock()` — every owner, every row, every tier, plus the MARKUP % track. |
| `src/components/costs/preview/by-product-view.tsx` | `editor()` — picker, then field cards. |
| `src/components/costs/preview/by-module-view.tsx` | `ownerBlock()` — one accordion per product. |
| `src/components/costs/preview/shared.tsx` | Read-only cell / tag / field primitives. |
| `src/styles/costs-m2-preview.css` | `cm2-`-prefixed; geometry transcribed from the prototype's own inline styles. |
| `tests/support/next-link-stub.tsx` | `next/link` for mounted tests (Next ships `link.js`). |

### Modified

| File | Change |
|---|---|
| `src/app/.../costs/page.tsx` | Reads the switch; projects `m2Facts` from rows it **already loads**; renders the preview *instead of* the module accordion. Header, Cost Stack and Client Target strip are shared by both branches, untouched. Adds `position` to the service-leaf select. |
| `src/components/costs/packaging-drilldown.tsx` | Delegates its graph read to the extracted module. A move; handlers untouched. |
| `src/components/costs/production-drilldown.tsx` | `fmtPct1` moved to `money-display.ts` and **re-exported**, so every existing import is unchanged. Needed because importing it dragged the server-action graph into the preview. |
| `src/lib/money-display.ts` | Now owns `fmtPct1`. |
| `src/app/globals.css` | Imports the new stylesheet. |
| `tests/support/server-contract-loader.mjs` | Resolves `next/link` to the stub. |
| `tests/unit/product-structure-slice1-cutover.test.ts` | Three Cutover classifications for new files naming canonical identity. |

---

## 3 · Fidelity work in this pass

Every structural item the interim review raised, against the bundle's own
source (`fld()`, `group()`, `ownerBlock()`, `edCard()`, `edField()`,
`edReadOnly()`, `tag()`, `eyebrow()`) rather than against a screenshot alone.

| Review finding | What changed |
|---|---|
| By module reconstructed four broad platform modules | **Rebuilt as `ownerBlock()` product accordions** — one card per owner, one open at a time, each holding its own Recurring costs / One-time charges / Production tier totals / Members / Freight sections with the tier grid inside. |
| By product was a vertical definition list | **Rebuilt as `edSection()` + `edCard()`** — picker, then a card per cost row whose fields sit in the `repeat(auto-fit, minmax(190px,1fr))` grid: Pricing vendor · Markup category · Unit cost · <tier> · Quantity per sellable unit, with override and notes behind the collapsed disclosure, and a card per charge. |
| Raw `primary_packaging` used as a row identity | Rows are named **"Product cost"**, gaining ` · <vendor\|category>` only when an owner has more than one row — the prototype's own disambiguation rule. The category moved to the trailing markup-category track where the design puts it. |
| Repeated engineering descriptors under every row | Removed. One badge per concept: `recurring · per unit`, a single `One-time cost`. |
| Spreadsheet lacked separate markup / category tracks | Grid is now `260px repeat(tiers+1, 118px) minmax(190px,1fr)` — the MARKUP % track is a real column, the trailing track carries the markup category. |
| Banner occupied the workspace | Replaced by a one-line notice with the explanation behind a disclosure. |
| Pricing-vendor described as an award | Corrected everywhere to price-source provenance; the By-product hint is the bundle's own "source of pricing · not the awarded supplier". |
| Unpriced direct service omitted | Its governed row is always present with blank per-tier cells. |
| `testingMicrosTotal` omitted | Carried and labelled. `toolingArtworkTotal` (legacy) likewise. |
| Lines grouped globally by `lineGroupId` | Keyed on **owner + line group**, so two owners can never merge into one line. Denormalised metadata that disagrees across a line's tier rows is reported (`conflictingFields`, an amber "tier rows disagree" tag) rather than silently flattened. |

### Residual corrections (second fidelity pass)

Raised on rendered output after the first pass, and fixed here.

| Finding | What changed |
|---|---|
| Tier headers overflowed the 118px track — labels already carry the quantity (`MOQ · 1,000 units`) and `tierHeadText` appended it again | `tierHead()` splits label from quantity, wraps inside the track, and **omits the quantity when the label already states it** (matched on the formatted digits, which is exactly what would be appended). One `TierHeadCell` is now shared by every grid view. |
| By-product picker ran the name and SKU together | Both were inline spans, so `margin-top` did nothing. Now `display: block`. |
| The preview's tier was disconnected from the Cost Stack, and By product reset to the first tier | The preview reads `selectActiveTierId` from the same store the stack reads and passes it through the pure body as a prop. Selecting one calls the same gesture `CostStackHeader.selectTier` makes — `setActiveTier` then `?tier=` via `router.replace` — so `ActiveTierUrlSync` stays authoritative. Headers and cells highlight it in all three views. **Navigation only: no new financial state, no writer, and the all-SKU stack keeps its whole-quote scope.** |
| Spreadsheet rendered a "Quote total per tier" row of dashes | Removed. A dash under a totals label reads as a total that failed to compute, which is worse than not offering one. The alternatives rule and the Cost Stack's authority are stated once in the card foot. The same applies to By module's "Charges per tier" foot. |
| "Setup selected no charges for this product" | Replaced with **"No one-time charges on this product. They are added in Setup."** Absence is absence; the record carries nothing that distinguishes "nobody has been here yet" from "considered and declined". |
| Repeated implementation prose on ordinary rows | Trimmed — e.g. "read from the instance and tier tables, not from the engine", and the per-row "not a one-time charge" caveat that the group head already states once. Canonical bundle hints are kept verbatim. |

Read-only treatment is the bundle's own `edReadOnly()` register — dashed BDS on
SUNK, same 7px/9px box as an editable field — so a field keeps its footprint
without pretending to be editable. **There is no `input`, `textarea` or `select`
anywhere in the preview**; the By-product tier scope is `aria-pressed` buttons.

### Token divergence, stated

The prototype states light-mode OKLCH literals. Nexus has a dark theme, so each
role binds to the established Nexus token carrying it (`INK→--ink`,
`ACC→--accent`, `BD→--rule`, …) and the three surfaces Nexus has no token for
(HAIR, SUNK, PAPER) are derived, not pinned. Values agree to within a luminance
step in light mode; pinning would produce bright cards in dark. Geometry is
quoted exactly.

Pattern 30 note: the bundle ships **inline styles inside three `.dc.html`
files** and no standalone stylesheet, so there is no canonical CSS to adopt
verbatim. `design-tokens.md` plus the prototype's style constructors are the
canonical artefact, and each rule names the construct it came from.

---

## 4 · What the preview will not do

- **No arithmetic.** Every figure is either a stored value rendered as stored
  (`"1.1100"` → `1.1100`) or a value read from the engine's node graph. Asserted
  structurally: every monetary field on the model is a `string`, and the model
  publishes no key matching `total|sum|extended|landed|sell|margin`.
- **No totals, and no empty totals row either.** The prototype foots the sheet
  with `stack(tid).total` and the owner cards with "Recurring extended per tier"
  / "Charges per tier". Those are prototype arithmetic the brief says to discard,
  and the engine publishes no node for these populations. The rows are **gone**,
  not rendered as dashes; the card foot states the alternatives rule and names
  the Cost Stack as the authority. **Listed as gap G-1.**
- **No mode inference.** Screenshots 08/09/10 show `SAME ACROSS TIERS` /
  `DIFFERENT BY TIER` and a spanning "all tiers" amount. Not rendered: no stored
  shared-mode intent exists to read, and ten of the twelve product-owned charges
  on the configured database carry unequal amounts. **G-2.**
- **Module interiors are pointed at, not rebuilt.** Freight and the group
  Production module are existing screens; their rows read "in module" and carry
  an entry point that leaves the preview.

---

## 5 · Owner coverage

| Owner | Covered | Identity |
|---|---|---|
| Item Group | yes | `assemblies.id`; `quoteLeafId` **null** — a group owns no cost row |
| Group member | yes | `quote_leaves.id`; junction id is a React key only |
| Direct product | yes | `quote_leaves.id` |
| Direct service | yes, priced or not | `quote_leaves.id` + its `serviceIdentity`'s governed column |
| Component-owned charges | yes | charge **instance** id; repeats of one type stay distinct |
| Quote-level freight / duty / tariffs | pointed at | Freight module; reads `—` |
| Legacy `'@quote'` charges | see G-3 | |

Nothing is silently dropped. An unplaceable charge or packaging row is rendered
under "Charges with no owner in this quote" and reported in the gap panel with
its id.

---

## 6 · Gaps and deliberate divergences

| # | What | Why | Where it belongs |
|---|---|---|---|
| **G-1** | No quote / line / charge totals, and no placeholder row for them | No governed node publishes them for these populations; computing them here would be a display deriving a commercial quantity, and a dashed row reads as a total that failed | A math-layer node, or a later milestone |
| **G-2** | No shared/different mode chips or spanning amount | No stored intent to read; inferring one from equal amounts converts a coincidence into a commercial fact | M4/M5 |
| **G-3** | Legacy `'@quote'` charge instances not listed as charges | Such an instance **stands for a production column**; its amount lives there and `updateComponentChargeCost` refuses to price it as a charge. The money is already on this surface as the group's production line — only the instance *row* is unlisted | Representation boundary; raise if the row itself is wanted |
| **G-4** | Product Type chips show HubSpot's **raw internal value** (`Primary`, not `Primary Packaging`) | The label vocabulary needs `loadHubspotProductTypeOptions`, a live HubSpot read this page does not perform. A guessed label would be worse | Whenever that vocabulary is on this page |
| **G-5** | The design's 8-item fee vocabulary exceeds the 5-key production registry (`print_plates`, `tooling`, `artwork_plate`, `samples`, `other_service`) | **No enum key was invented.** The preview shows what exists | Setup-side business decision |
| **G-6** | Charge-level markup reads `—` | Not exposed to this surface; none invented (data contract §G). The prototype reads `—` here too | — |
| **G-7** | `testingMicrosTotal` has no row in the existing Production module | It is shown here where a value exists, because a stored cost on neither surface has vanished. The module's own row list is unchanged | Production module scope |
| **G-8** | View and focused owner are component state, not URL | Neither is a quote fact. The focused TIER is no longer local: it is the store's active tier and the canonical `?tier=` parameter, shared with the Cost Stack | Revisit if deep-linking a view is wanted |
| **G-9** | **Refresh coherence not proven.** Amounts come from the RSC snapshot; markup comes from the reactive store graph | The two could disagree after a cross-tab refresh. Reusing the store's packaging slice for amounts was drafted and withdrawn with the interaction work, since the same ownership question it raises is the one under review | Assess before M3; **no parity claim during live updates** |

---

## 7 · Tests and results

### New / changed

| File | Establishes |
|---|---|
| `tests/unit/costs-m2-read-model.test.ts` (19) | Owner identity across all four kinds; junction-vs-cost-identity; all tiers per line; blank ≠ zero; one line group across its tier rows; unpriced charges present with state named; **unequal amounts preserved, equal amounts not collapsed**; two same-type charges stay two; unplaced charges/rows reported; missing readiness → `unknown`; production rows only where a value exists, under the module's own names; a service's column resolved from its identity; **no computed monetary quantity**; plus the corrections — unpriced service keeps its row, testing/micros and legacy tooling carried, owner-scoped line grouping, conflicting metadata named |
| `tests/unit/costs-m2-preview-mounted.test.tsx` (20) | **No form control in any of the three views**; concise notice with collapsed detail and a correct exit href; tier + MARKUP % tracks; `1.1100 / 0 / unpriced` distinct; **"Product cost" naming and no raw category key**; no qualifier on a single row; engine markup in the markup track; charge keeps per-tier amounts; unpriced service present; **no invented quote total, Cost Stack named**; **By module is one accordion per owner with the canonical sections, one open**; entry points leave the preview; freight reads `—`; **By product renders field cards with the four canonical fields and a collapsed disclosure**; focused tier named and all tiers reachable; every owner survives a change of view; unplaceable record reported; **plus tier navigation — the active tier comes from the quote rather than a view default, all three views agree, selecting one reports the stack's own gesture, the active column is highlighted with no tier hidden, a null active tier falls back without hiding anything, and a label that already states its quantity is not given it twice** |
| `tests/unit/costs-m2-preview-switch.test.ts` (5) | Fails closed on absent/empty/near-miss/other milestone; repeated params read; round trip preserves `section` and `tier`; no trailing `?` |
| `tests/unit/costs-m2-packaging-line-read.test.ts` (6) | Resolved markup is the **engine's** on a line with no override; override reports itself and the rung below as inherited; fails closed on missing, duplicate and preview-evaluation graphs; one traversal covers every pair |

One test was **removed and replaced, not weakened**: "a service with no stated
amount carries no production line" asserted the behaviour the review rejected.

### Results

```
npx tsc --noEmit        exit 0
npm run test:unit       3302 pass · 0 fail · exit 0
npm run verify:ci       exit 0

focused, run individually (real exit codes):
  costs-m2-read-model            19 pass · 0 fail · exit 0
  costs-m2-preview-switch         5 pass · 0 fail · exit 0
  costs-m2-packaging-line-read    6 pass · 0 fail · exit 0
  costs-m2-preview-mounted       20 pass · 0 fail · exit 0
```

`verify:ci` prints its standing report-only line about 70 unawaited-rejection
sites **outside** the enforced region — pre-existing, unchanged, not a veto.

The preceding results describe CC's database-free pass. Subsequent independent
browser verification used only the isolated local validation database; see below.

### Independent review, September 18

Final checks: `verify:ci` exit 0; 3,304 unit tests passed; three browser cases
passed in 30.1 seconds. Logs and screenshots are in
`C:/Code/nexus-validation-runs/financial-parity-diagnosis-20260918/`, prefixed
`m2-review-`. This supersedes the earlier unrendered status.

The browser cases cover two and four tiers, all three views, tier navigation,
unchanged all-SKU stack figures while navigating, no Server Action writes,
and returning to the original editor with the selected tier. A separate guarded
fixture covers grouped and standalone product charge owners, two tooling
instances, unequal amounts, absent alternatives, and missing classification.
It removes its own charge rows and standalone attachment in `finally`.

Visual corrections include contained tier headings, no duplicated quantities,
separate product/SKU lines, selected-column emphasis, consistent charge columns,
responsive product cards, existing tooling labels, and classification warnings
in all views. Freight is now shown once at quote scope, accessible from every
view. By-module recurring markup uses the same supplied engine read as the
other views. No financial calculation or writer was added.

The redesigned region was inspected at 1728px and 909px. Existing platform
navigation and Cost Stack behavior at narrow widths remain unchanged; this is
not a full-platform mobile acceptance. Shared charge amounts, editing, new Setup,
refresh coherence (G-9), and the separately reproduced focus/save defects remain
outside this presentation acceptance. The latter two still block M3.

### Freight panel fidelity pass · September 19

The revised Costs design places the quote-owned Freight summary **below** the
cost views, following operator review, and opens the existing Freight editor in
a right-side panel. The preview now follows that structure: `Record shipment`
and each shipment's `Edit` action open the same existing editor component in
the panel, while the summary remains the page-level view. Escape, the close
button and the scrim close the panel; opening and closing it does not replace
the editor component with a second writer. The editor is mounted only after the
first open and remains mounted while the panel is hidden, preserving its local
interaction state.

The same rendered pass removed internal snake-case markup-category keys from
all three Costs views. For example, `primary_packaging` is now presented as
`Primary Packaging`; labels that are already authored for operators are kept
unchanged.

Operator refinements to the existing Freight editor are separate from the
read-only cost grids: the resting shipment card omits completed coverage and
repeated component context; empty journey and treatment metadata are not shown;
optional destination detail stays behind an explicit control; and the delete
flow explains why recorded operational evidence prevents removal. Duty and
Tariff each now use one amount and one markup entry, labelled as applying to
every tier. A save from either control updates each existing quote tier, while
the tier columns show the resulting sell totals. The markup entry footprint was
widened so ordinary multi-digit percentages remain readable at the approved
panel width.

Verification after this pass: TypeScript clean; 3,309 unit tests passed; the
full `verify:ci` chain passed. The live local preview was reviewed at the normal
desktop viewport and at the approved 909px breakpoint, with the Freight panel
opened against the populated four-tier validation quote.

### Freight summary column alignment · September 19

The read-only Freight summary now uses the same shared grid definition as the
spreadsheet cost rows: a 260px owner/label track, one 118px track per tier plus
one 118px MARKUP % track, 12px gutters, and a flexible trailing Cost source
track. This keeps the tier and markup columns on the same vertical rails while
letting source context take the available width. The source column identifies
selected-destination freight and customs-entry duty/tariff values.

Rendered against the populated four-tier local preview: the four tier rails
and MARKUP % track align with the spreadsheet. Focused freight summary/action
tests: 13 passed; `npm run verify:types` passed; `git diff --check` passed
(Git reported only its existing LF-to-CRLF working-copy notices). This change
is presentation-only and writes no quote data.

---

## 8 · Feature-off preservation

- Switch absent → the module accordion renders exactly as before; the two
  branches are exclusive and the preview never mounts beside the editors.
- Everything above the accordion is the same components reading the same store
  in both branches.
- `m2Facts` is projected in memory from rows the page already loads — no extra
  query — and built unconditionally so its correctness is not on a code path
  only the preview exercises.
- No writer, schema change, migration, permission change, snapshot, accounting
  or workflow effect. Nothing about the preview is persisted.

Behavioural deltas to the default path, for Codex to confirm:

1. `packaging-drilldown.tsx` calls the extracted read instead of its inline
   copy — same inputs, outputs and batching.
2. `fmtPct1` relocated to `money-display.ts`, re-exported; no import site
   changed.
3. `serviceLeafRows` selects one extra column (`position`), ignored by
   `ProductionDrilldown`.
4. `server-contract-loader.mjs` resolves `next/link`. Test infra only; the full
   suite is green.
