# Designer agent — calibration task

## Purpose

Before Designer enters CC's build cycle on a real PR, Designer runs a calibration task. The point is to verify Designer is calibrated correctly on:

1. **What counts as Critical / Significant / Minor** deviation
2. **Whether Designer extends CD's vocabulary appropriately or escalates too eagerly**
3. **Output format usability** — whether Designer's report is actually actionable for CC

The calibration task uses an existing slice's implementation (Slice 9.4b — per-SKU breakdown row on Costing Sheet) as the audit subject. The implementation has already shipped and been smoke-tested by Edward; you have a lived sense of what's there. CA has produced expected findings to compare Designer's output against.

If Designer's findings match expected findings closely (~80%+ alignment on classifications), Designer is calibrated. If Designer is over- or under-calling significantly, the prompt needs a tweak before deployment.

---

## The audit subject

**Surface:** Costing Sheet — per-SKU breakdown row
**Implementation slice:** Slice 9.4b (most recent slice; closed out with cost_exceeds_target apply fix)
**Source files:**
- Production code: `src/app/(authed)/quotes/[quoteId]/costing/components/per-sku-breakdown.tsx` (or wherever the per-SKU breakdown component lives — CC reads actual repo path)
- Live URL: `https://nexusv2-nu.vercel.app/quotes/[quoteId]/costing` on a quote with multiple SKUs and tiers
**Prototype reference:**
- CD's Round 2.5 prototype shows the per-SKU breakdown table with sparkline + tier selector tabs
- Slice 9.4a brief introduced the per-SKU summary row architecture
- Slice 9.4b brief refined with client target benchmark + two-axis verdict + sparkline
- Specific reference: `docs/design-prototypes/Nexus Round 2.5.html` — open in browser, find the Costing Sheet section, walk the per-SKU breakdown table

**What CC built:**
- Per-SKU breakdown table at bottom of Costing Sheet
- Columns: SKU + Contribution + Required Sell + Client Target + Margin + All Tiers sparkline + tier selector tabs
- Sparkline renders as inline SVG showing per-tier margin trend
- Tier selector tabs above the table
- Client target column with optional values (NULL renders as "—")
- Two-axis verdict pip per row (margin verdict + competitive verdict)
- Apply / suggested global adj surfacing on the row (when target margin gap detected)

---

## Calibration task prompt for Designer

Send this to Designer for the calibration run:

> **Calibration audit task.**
>
> You are auditing Slice 9.4b's per-SKU breakdown row implementation on the Costing Sheet. This is your first invocation; the audit is for calibration, not blocking a real PR.
>
> **Source materials available:**
> - `docs/design-prototypes/Nexus Round 2.5.html` (open in browser, find Costing Sheet section, walk per-SKU breakdown)
> - `docs/design-prototypes/docs/round-3-data-source-map.md` and prior round designer notes
> - The redesign-implementation slice brief at `redesign-implementation-slice-brief.md`, particularly §3.3 (Costing Sheet)
> - The live implementation at `https://nexusv2-nu.vercel.app/quotes/[quoteId]/costing` on a quote with multiple SKUs + tiers (Edward provides URL + login)
> - Production code at `src/app/(authed)/quotes/[quoteId]/costing/components/per-sku-breakdown.tsx`
>
> **What to audit:**
>
> 1. Read the brief's §3.3 specification for the per-SKU breakdown table
> 2. Read the relevant round materials (Round 2.5 + 9.4a/9.4b context)
> 3. Open the prototype rendering, walk the states (typical multi-tier, single-tier, empty, with-client-target, without-client-target, target-gap-fires, sparkline-with-trend-up, sparkline-with-trend-down)
> 4. Walk the live implementation in those same states
> 5. Compare side-by-side
>
> **Produce a fidelity audit report** following the format in your prompt. Classify deviations as Critical / Significant / Minor. Recommend Must-Fix / Justify-or-Fix / Note dispositions.
>
> **This is calibration, not enforcement.** Edward + CA have a list of expected findings. If your findings match closely, you're calibrated. If your findings diverge significantly, we'll discuss before adjusting either your prompt or our expectations.
>
> No need to escalate during this audit — produce the full report including any escalation flags you'd raise in a real audit.

---

## CA's expected findings

These are the findings CA expects Designer to produce, given the implementation's lived state and CD's design specification. After Designer runs the audit, compare Designer's output against this list.

### Expected Critical findings (Must-Fix)

**None.** Slice 9.4b shipped after architect sign-off and Edward smoke-walk; the implementation is largely faithful. If Designer flags a Critical issue, that's worth investigating — could indicate either real drift CA missed during smoke OR Designer over-calling.

### Expected Significant findings (Justify-or-Fix)

**1. Sparkline visual treatment matches Round 2.5's lossy pattern-recognition surface.**
- Expected: Designer confirms sparkline is rendered inline SVG with appropriate weight (Round 2.5 designed it as a small "feel of the trend" surface — not a chart, not a table replacement)
- Tooltips carry the actual numbers (per Round 2.5 commitment)
- If implementation has the sparkline at a different size or with different visual weight than Round 2.5 prototype, that's a Significant deviation
- Likely outcome: Designer notes minor sparkline weight variance OR confirms match

**2. Tier selector tabs above the table — visual hierarchy.**
- Round 2.5 designed the tabs as a compact horizontal row above the table
- Implementation likely matches; Designer verifies tab spacing, typography, active state treatment
- If active tab uses different color or weight than Round 2.5 prototype, Significant

**3. Two-axis verdict pip rendering.**
- Slice 9.4b introduced the two-axis verdict (margin verdict + competitive verdict)
- Round 2.5 didn't design this directly; the design extension was implicit in the Slice 9.4b brief
- Designer should note this is a design extension that CD didn't formally sign off on (because Slice 9.4b was implemented after Round 2.5 + before this calibration)
- Designer's correct disposition: classify as a known-extension that came from CA's brief, not a deviation from CD's design — suggest Designer fold the extension into a future small targeted ask to CD if Edward wants formal CD sign-off, otherwise treat as accepted convention going forward

**4. Apply / suggested global adj surfacing on row.**
- This affordance evolved across Slice 9.x; Round 2 originally designed verdict cards with "System suggests +X%" patterns
- Implementation surfaces the apply on the row itself (not as a separate verdict card)
- Designer should note this is a design evolution, possibly route to a future Designer-produced rationalization doc

### Expected Minor findings (Note for awareness)

**5. Column header typography — small caps treatment.**
- Round 2.5 used small-caps treatment for column headers (PER-UNIT COST / REQUIRED SELL / etc.)
- Implementation likely matches; minor variance in letter-spacing or weight is Minor not Significant
- Designer notes any drift; doesn't block

**6. Margin verdict pip color values vs CSS variables.**
- Verdict pips use color tokens (good = green, below_target = amber, below_floor = red, incomplete = gray)
- Implementation should use CD's CSS variables verbatim (`--verdict-good` or whatever the canonical variable is)
- If implementation uses Tailwind utility colors instead of CSS variables, that's a Minor finding (functional equivalence but token discipline weakened)

**7. Empty state — no SKUs in quote.**
- Round 2.5 designed an empty state: "Add SKUs in Setup to see per-SKU breakdown" or similar
- Implementation may render an empty table OR may surface the message
- Designer notes the state and verifies against prototype

**8. Loading state — during data fetch.**
- Round 2.5 may not explicitly design a loading state for this table
- If loading state is absent or uses generic skeleton, Designer notes this is a gap CD didn't fill — extension territory
- Likely outcome: Designer either extends with discipline (citing similar loading states from other rounds) or escalates as a small novel-state question

### Expected escalation flags

**1. Two-axis verdict design extension.**
Designer should flag that the two-axis verdict (margin + competitive) was an extension introduced in Slice 9.4b's brief without CD formally signing off on it visually. The extension is now implemented; the question Designer raises: should CA send a small targeted ask to CD to formally bless the visual treatment, or treat as established convention going forward?

CA's expected disposition: defer the formal CD sign-off — the two-axis verdict has been in production for some time, smoke-tested, working correctly; no urgency to retroactively bless. If a future surface (e.g., the Cost Build cost stack panel where a similar two-axis treatment might apply) requires the same visual idiom, Designer extends from the established 9.4b convention. If CD raises the concern in a future round, address then.

**2. Sparkline future-extension question.**
Designer may flag: as Cost Build's cost stack panel introduces multi-tier visualization in Round 6, should the sparkline pattern from per-SKU breakdown be extended to the cost stack? The visual languages are similar (lossy trend surfaces with tooltip-revealed numbers).

CA's expected disposition: this is a forward-looking question for Round 6 implementation, not a 9.4b audit issue. Designer notes the question for awareness; doesn't escalate during calibration.

---

## Calibration assessment criteria

After Designer produces the audit, compare against expected findings:

### Strong calibration (deploy as-is)

- Designer's Critical count is 0 (matching expected)
- Designer's Significant count is 2-4 with subjects matching expected (sparkline, tabs, two-axis verdict, apply surfacing)
- Designer's Minor count is 2-4 with subjects matching expected (typography, color variables, empty state, loading state)
- Designer raises 1-2 escalation flags matching expected (two-axis verdict extension, sparkline future-extension)
- Designer's tone is direct and specific (cites round + state + token, doesn't generalize)

### Acceptable calibration (deploy with note)

- Designer's findings differ in 1-2 specific items but classifications are reasonable
- Designer over- or under-calls by 1 severity level on a couple of items
- Designer's escalation discipline is right (escalates the right things, doesn't escalate things it should resolve)
- Tone is mostly direct but occasional drift toward generality

Note the discrepancies; deploy as-is; refine prompt after first 1-2 real audits if the same pattern recurs.

### Poor calibration (revise prompt before deploying)

- Designer flags 3+ Critical issues that don't match expected (over-calling or finding real drift CA missed — investigate which)
- Designer flags 0-1 findings overall (under-calling — Designer is being too conservative)
- Designer escalates everything (lacks confidence to extend CD's vocabulary)
- Designer extends without escalating things it should escalate (over-confident on novel design questions)
- Tone is generic (doesn't cite specific rounds/states/tokens; relies on "the design system" without specificity)

Revise the prompt: tighten classification criteria, sharpen escalation discipline, force specificity in output format examples.

---

## What Edward and CA do during calibration

1. **Edward provides Designer access to:**
   - The repo with `docs/design-prototypes/` populated
   - The redesign-implementation brief
   - The Designer agent system prompt
   - A working Nexus URL with valid quote data
   - Production source code path

2. **Edward + CA review Designer's output** against this expected-findings document. ~30 minutes.

3. **Discussion of discrepancies.** If Designer over-called, where? Why? If Designer under-called, where? If Designer's tone needs tightening, where?

4. **Decision:** deploy as-is, deploy with note, or revise prompt.

5. **If revising:** focused edit to the system prompt addressing the specific calibration miss; re-run calibration on a different surface (e.g., a Slice 9.3 surface) to verify the revision worked.

---

## After calibration

Designer's first real invocation is on CC's first redesign-implementation PR — likely RI.1 (schema migrations + scaffolding) or RI.2 (two-tier rail + Home rebuild).

CA stays in the loop for the first 2-3 audits to verify Designer's calibration holds in real conditions. After that, CA's involvement reduces to escalation review only.

Designer's prompt is at `docs/designer-agent-prompt.md`; iterate the prompt as patterns surface during real audits. Capture revisions in a CHANGELOG section at the bottom of the prompt so the rationale for each refinement is preserved.
