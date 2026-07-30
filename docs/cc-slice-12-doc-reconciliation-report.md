# Doc reconciliation report for launch-readiness discussion

**Author:** CC · **Date:** 2026-07-29 · **Ask:** CA (analysis, not fix pass; no PR)

The prompt was: verify four specific conflicts, then the broader questions, then CC's own read on the largest doc-vs-reality gap. Findings + evidence below. Order matches CA's ask.

---

## 1. Slice numbering collision — CONFIRMED, and worse than framed

CA's premise: SPEC §11 allocates Slices 13–17 to workspace features. CA is writing `SLICE-13-READINESS-SCOPE.md` and `SLICE-14-LAUNCH-READINESS-SCOPE.md` against those numbers.

**Reality:**

Neither `SLICE-13-READINESS-SCOPE.md` nor `SLICE-14-LAUNCH-READINESS-SCOPE.md` is committed to the repo. If CA has them, they're local drafts. So the collision isn't between two committed docs yet — it's an anticipated collision the CA-side drafts would introduce.

But the collision **already exists in three directions** across committed docs:

| Doc | "Slice 13" means | Last touched |
|---|---|---|
| `SPEC.md` §11 (line 578) | Deal Organizer (Project List) — 2 sessions | 2026-05-04 (~3 months stale) |
| `redesign-implementation-slice-brief.md` (line 841) | Reduced Deal Organizer (filter/sort/bulk-action **only** — visual work superseded) | 2026-05-05 |
| `bom-generator-brief.md:125` + `UX_BACKLOG.md:2933` | HubSpot library sync (vendors + products) | Later |

And **CLAUDE.md uses a parallel numbering system entirely** — v1 release-path items 1-12 (line 2916 onward), where item 7 = "Quote umbrella + NetSuite finalization" and item 10 = "SPEC compliance audit." CLAUDE.md never renumbers SPEC's 13-17 — it just runs a different axis.

**No authoritative reconciliation exists.** SPEC.md §11 hasn't been amended in three months of shipping. The de-facto reroute lives in `redesign-implementation-slice-brief.md`, but its own Q4 leaves the disposition open ("Should Slice 13 be dropped entirely now that redesign-implementation rebuilds the deal organizer?").

**If CA proceeds with SLICE-13-READINESS-SCOPE.md,** she'd add a **fourth** definition of "Slice 13" to the doc canon. Recommendation: **name the readiness/launch work independently of the 13-17 slot** (e.g., `LAUNCH-READINESS-SCOPE.md` + `LAUNCH-GATE-SCOPE.md`) — reserves the SPEC 13-17 slots for future disposition; avoids compounding the collision.

---

## 2. Success criterion #4 vs Slice 13's cutover — SPEC is stale, cutover plan is directionally correct but underspecified

SPEC §13 SC#4 (line 615): "Existing HubSpot → NetSuite Sales Order sync continues without regression."

STRATEGIC_VISION.md contains BOTH the old framing (line 12-13, top of file: "The existing HubSpot → NetSuite Sales Order sync is unchanged in v1") **AND** a May-2026 revision (line 90-115): "NetSuite receives the SO as the operational handoff" via a Nexus-direct push at Tier Selection Advance. **The revision doesn't remove or explicitly cancel the earlier text.** Same file; both statements coexist.

Slice 12 shipped the Nexus → NetSuite direct SO push. Real Sales Order 360741 (tranid SO2697) was created by CB's walk. **The existing HubSpot → NetSuite sync WAS bypassed** — Nexus is now the SO writer for accepted quotes. SC#4 as written is unmet by construction.

**Where the decision to build NetSuite integration was actually made** (relevant to Q4 below): `docs/quote-umbrella-brief.md` (2026-05-17, commit `ece5402`) — the scope INCLUDES the NetSuite SO push, explicitly. Approved by Edward pre-implementation per the brief's status line. But this brief is a **slice-scope contract**, not a spec revision. SPEC.md and STRATEGIC_VISION.md's earlier text were never updated to match.

**SC#4 is stale, not the cutover plan.** The cutover happened via Slice 12 and is operationally correct per the revised strategy. Recommendation: **rewrite SC#4** — either "Existing HubSpot → NetSuite sync is disabled for Nexus-authored quotes; legacy deals continue on the old path until reconciled" (if the old sync is actually still running for pre-Nexus deals) or "Nexus is the SO writer for accepted quotes; HubSpot → NetSuite legacy sync retired" (if the old sync is off).

**Open discovery needed for the readiness discussion:** what is the actual status of the HubSpot → NetSuite sync today? Is it disabled? Still running? Duplicating writes for Nexus-authored quotes? This isn't documented anywhere I could find. CLAUDE.md's discovery items list (2963-2971) has three unanswered questions on this — none resolved.

---

## 3. Success criterion #2 — NOT BUILT

SPEC §13 SC#2 (line 613): "100% of accepted quotes produce a HubSpot Quote object with `hs_cost_of_goods_sold` populated on every line item from the accepted tier."

STRATEGIC_VISION.md calls this "the peak of HubSpot integration depth" (line 207) — happening at Slice 12.

**Reality: not implemented.** Explore-agent verification found:

- **Zero HubSpot Quote object creation** anywhere in the codebase. `hubspot_quote_id text` column exists on `quotes` (schema.ts:344) but is never populated.
- **Zero line-item writes** to HubSpot.
- **`hs_cost_of_goods_sold` appears only in Products-domain code paths** (Nexus READS COGS from HubSpot Products at Add-product-modal time). Never written back on a Quote object.
- **What Slice 12 actually ships for HubSpot:** one API call at `src/lib/hubspot.ts:244` (`updateDealStage`) — PATCHes the deal's stage to Closed Won + optionally patches the deal `amount`. That's it.

**No TODO comment or decision memo says the Quote-object writeback was deferred.** UX_BACKLOG.md line 4886-4890 still uses future tense ("Slice 12 writeback populating line-item-level `hs_cost_of_goods_sold` from Nexus unlocks native HubSpot margin reporting for the first time"). CLAUDE.md's `HUBSPOT_WRITE_ACCESS_TOKEN` section says the token is "used exclusively by the Mark-Accepted writeback flow" — currently only exercising deal-stage + amount, plus the Products-domain library sync path.

**Roughly 30% of the mechanism SPEC §13 SC#2 describes is built.** Deal stage push + amount patch: yes. Quote object with line items with COGS: no.

**This is the single largest gap between what the docs say and what exists.** It's the answer to CA's Q9 in advance — see §9 below.

---

## 4. NetSuite integration as v1 non-goal — decision provenance is scattered

SPEC.md §2 non-goals (line 53): "NetSuite integration (read or write)" is v2 or later. SPEC.md §4 System Architecture (line 114): ASCII shows `[ NetSuite ] ← [ HubSpot ] ← (existing sync, unchanged in v1)`. Both consistent with the non-goal.

**The decision to build NetSuite integration in v1 lives across several places, none of which amend SPEC.md:**

1. **STRATEGIC_VISION.md revision note (2026-05-17, commit `ece5402`)** — line 76-115. Introduces the "two-layer architecture" framing where v1 ends at NetSuite SO push. But it's a REVISION NOTE within the doc, and the earlier "NetSuite integration is v2" text elsewhere in the same file (line 19, "v2 — Nexus → NetSuite direct integration") was NOT removed. Doc is internally contradictory.

2. **`docs/quote-umbrella-brief.md`** (2026-05-17, `ece5402`) — slice-scope contract. Scope IN includes "NetSuite SO push on Tier Selection Advance." Approved by Edward per the brief's status line.

3. **`CLAUDE.md` "v1 release-path slice sequencing"** (line 2944-2955) — item 7 "Quote umbrella + NetSuite finalization" — describes it as the combined slice with NetSuite push.

4. **`docs/cc-comm-mark-accepted-netsuite-so-push-brief.md`** — separate CC-to-CA comm doc scoping the NetSuite work.

**Not recorded anywhere authoritatively:** amendment or errata to SPEC.md §2 non-goals list. If a future reader opens SPEC.md and reads "NetSuite integration (read or write)" as a non-goal, they get the wrong answer.

Recommendation: **explicit SPEC.md amendment**. Move NetSuite integration from non-goals to goals; rewrite §4 System Architecture ASCII; rewrite SC#4 (per §2 above). Should have been done at the moment of the decision (May 2026); wasn't; now needs to happen before the readiness discussion codifies what "v1" means.

---

## 5. What else in SPEC.md is stale

The three above (SC#2 unmet, SC#4 stale, NetSuite non-goal reversed without amendment) are the load-bearing gaps. Additional stale items:

**§1 Project Overview (line 29):** "writes structured line items (with COGS) back to HubSpot when a quote is accepted — feeding the existing HubSpot → NetSuite Sales Order sync unchanged." — Both halves wrong (no line-item COGS write; sync bypassed).

**§4 System Architecture (line 121):** "HubSpot write on Mark-Accepted (Quote object create/update, line items with `hs_cost_of_goods_sold`, deal-level `amount`, `est__revenue`, `costing_sheet`)." Only `amount` ships; the other four don't.

**§5 Data Model:**
- `quotes.underpriced_override_user_id` + `.underpriced_override_reason` (line 189-190) — schema exists, never written. See §6 below.
- `quotes.hubspot_quote_id` (line 182) — schema exists, never populated.
- The whole `quote_skus` shape (line 207-224) describes a flat SKU list. Real schema has assemblies + assembly_leaves via Slice 5.5's tree refactor + Slice 11.5's NEW model migration. `quote_skus` table itself was **dropped** in Slice 11.5.1. This section describes a table that no longer exists.
- `packaging_inputs` / `freight_inputs` / `production_inputs` (line 231-280) — all three were **dropped** in Slice 11.5.1, replaced by `assembly_leaf_inputs` + `assembly_production_inputs` + `freight_leg_groups`/`freight_legs`/`freight_leg_tiers` (R6.2). SPEC's data-model section describes a schema that hasn't existed for ~2 months.

**§6 FR-7 UNDERPRICED gate (line 409):** not built. See §6 below.

**§7 Quote Lifecycle (line 487):** doesn't mention the `complete` state (added Slice 12 for post-SO-push freeze).

**§11 Slice 12 description (line 575-576):** "HubSpot Quote create/update with `hs_cost_of_goods_sold`. Deal-field updates. Writeback failure handling and retry." — First and third clauses unmet. Deal-field updates: only stage + amount.

**§11 Slice 13-17 descriptions:** all still describe original workspace-feature scope; supersession by redesign-implementation-slice + integration slices (which took some of the numbers) is unrecorded.

**§13 SC#5 (line 616):** "Zero quotes shipped in `accepted` state with un-overridden UNDERPRICED or BELOW FLOOR gates." — Trivially satisfied only because the override mechanism is unwired (see §6). Doesn't measure what it intends to measure.

**§10 v2 pre-wiring (line 517-530):** described from a "HubSpot-master, NetSuite-later" architecture. The May-2026 revision to STRATEGIC_VISION.md flipped this. §10 didn't get updated.

**Documentary status:** SPEC.md is dated 2026-05-04 and hasn't been amended in 3 months of shipping. The document represents intent as of pre-Slice-9 planning. Everything in §5 (Data Model) and §11 (Build Phases) is stale enough to actively mislead.

---

## 6. FR-7 UNDERPRICED gate — silently unimplemented; quote-level BELOW FLOOR override is also unwired

SPEC.md FR-7 (line 407-412 verbatim):

> **Two independent gates on Mark-Accepted:**
> - *Line-level UNDERPRICED gate* — fires if any (SKU, tier) line has actual sell below required sell. Admin override required, reason logged.
> - *Quote-level BELOW FLOOR gate* — fires if blended margin on the accepted tier is below firm floor. Admin override required, reason logged.
> A quote can fail both gates simultaneously; both must be resolved or overridden.

**Reality:**

**Line-level UNDERPRICED gate: DOES NOT EXIST on the accept path.** No loop over per-line margin status in `markAccepted`. Grep for `UNDERPRICED` / `underpriced` in `src/app/actions/quotes.ts`: zero matches. The schema columns (`underpriced_override_user_id`, `underpriced_override_reason`) are dead — never written. Data availability is fine (`getCostingBundle` already returns per-line status at accept time); enforcement is the gap.

**Quote-level BELOW FLOOR gate: half-built.** Detection works (`src/app/actions/quotes.ts:2140` throws `ActionGuardError` when `tierRollup.blendedMarginStatus === "BELOW_FLOOR"`). **Admin override is NOT wired** — the error message literally says "Admin override required (not yet wired; block until it lands)." OverrideModal (`src/components/mark-accepted/override-modal.tsx`) is a Slice RI.6 visual stub with `alert()` buttons.

**Compound consequence for SC#5:** "Zero quotes shipped in `accepted` state with un-overridden UNDERPRICED or BELOW FLOOR gates" is trivially satisfied because:
- UNDERPRICED gate can't fire (unimplemented) → nothing can be shipped un-overridden if the gate doesn't detect
- BELOW FLOOR gate can't be overridden (hard reject) → nothing shipped with override, but legit override cases are silently blocked

The success criterion doesn't measure what it intends to measure.

**Not banked as a deferral.** UX_BACKLOG.md line 4660-4667 (item #17) banks the **quote-level** override column pair for Slice 12, presuming line-level was already done — it wasn't. No explicit "UNDERPRICED gate deferred" entry anywhere. Silent gap.

**FR-9 step 1 (line 420) — "Validates both gates (FR-7). If either fails, requires admin override with reason."** — literally not what the code does.

---

## 7. CLAUDE.md's umbrella section — stale, but the drift is broader than that

CA's read is correct. CLAUDE.md's "Quote umbrella structure" (line 24-53) lists **4 sub-tabs:** Preview Quote · Send to Client · Mark Accepted · Tier Selection. **Reality is 5 sub-tabs** per `src/components/quote-umbrella/subtabs.ts:32-44`:

1. Preview Quote
2. Send to Client
3. **Client Review** (log-kind, added mid-Slice-12) — missing from CLAUDE.md
4. **Acceptance** (renamed from Mark Accepted per R9.1)
5. **Sales Order** (renamed from Tier Selection per R9.1)

CLAUDE.md line 51: "NetSuite SO push lives on Tier Selection sub-tab's Advance" — the tab is now called Sales Order. `docs/quote-umbrella-brief.md` (the referenced source-of-truth doc at CLAUDE.md line 26) still uses the pre-R9.1 names too.

**R9's choice/commitment split is unrecorded** in CLAUDE.md. Slice 12 introduced `customer_accepted_tier_id` (choice, captured at Mark Accepted / Acceptance) as distinct from `accepted_tier_id` (commitment, written at Sales Order Send's freeze-tx). This split was CA's own P0 fix and is load-bearing for the FK asymmetry (SET NULL vs RESTRICT). Not in CLAUDE.md.

**Other stale bits in CLAUDE.md:**

- **`v1 release-path slice sequencing`** (line 2901-2962) — item 5 says Slice 11.5.1 is "shipped"; item 7 (Quote umbrella) is marked "🟡 paused" — actually shipped in full via Slice 12 which is closing right now. Item numbers stale.
- **`Surface canon: 4 peer top-level surfaces`** at the top — correct for post-RI.8. But CLAUDE.md's own umbrella structure section further down doesn't reflect all R9 renames.
- **Costing sheet → Pricing rename references** are consistent post-RI.8, but IA-spec.md still uses the old names.
- **Pattern 22 §0.5 ledger** — 80 catches now; last two entries dated 2026-07-15 (Slice 11 Step 7). Missing Slice 12's several catches (project_source resolver, cell_ovr postmortem was banked separately, etc.). Not stale per se, just not-updated.
- **`Currently in progress`** / **`Recently shipped`** style sections don't exist in CLAUDE.md — good discipline overall, though it means slice history has to be reconstructed from git log.

CLAUDE.md is mostly current on patterns + operational discipline (that's what it's for); it's stale on **slice-status and surface-structure** claims specifically. Those two categories drift fastest.

---

## 8. Docs CA hasn't seen — inventory + authority

The `docs/` directory has 152 markdown files. Categorized (per the Explore agent's inventory):

**Canonical / spec-level** (small, load-bearing, all named by CA except IA-spec.md + BOM_NOTES.md):
| File | Last touched | Currency |
|---|---|---|
| `SPEC.md` | 2026-05-04 | 3 months stale (see §5) |
| `STRATEGIC_VISION.md` | 2026-05-17 | Internally contradictory (§2, §4) |
| `IA-spec.md` | 2026-05-04 | Uses OLD surface names; self-labels "partial" |
| `BOM_NOTES.md` | 2026-04-30 | Slice 5.5 tree contract; still current on tree semantics |
| `HUBSPOT_CACHE.md` | 2026-04-30 | Slice 2-3 vintage; hasn't tracked bidirectional sync work |
| `CUSTOMS_AND_FREIGHT.md` | 2026-04-30 | Pre-R6.2 freight-legs rework |
| `cross-round-reconciliation.md` | 2026-05-05 | Round-by-round decisions ledger — historical, useful for archaeology |
| `CLAUDE.md` | Living (5007 lines) | Current on patterns; stale on §7 items above |
| `UX_BACKLOG.md` | 2026-07-29 (today) | Active |
| `pattern-52-freeze-list.md` | 2026-07-29 | Fresh; canonical for Pattern 52 |

**Slice briefs** (~25 files): per-slice scope contracts. Some hit Q22 Pattern 22 §0.5 verification, some don't. **Authority: each brief supersedes SPEC.md for its slice's scope while it's active; after slice closes, it becomes historical.** No brief has explicit "supersedes SPEC.md §X" callouts, so a future reader has to reconstruct the current-truth by reading briefs in slice-close-date order.

**CC comm docs** (~30 files, all `cc-comm-*.md` and `cc-*-kickoff.md`): CC↔CA / CC↔Edward memos. Contains disposition decisions that never made it into canonical docs. Examples I flagged during this analysis: `cc-comm-mark-accepted-netsuite-so-push-brief.md`, `cc-comm-mark-accepted-brief-v2/v3/v4-amendments.md`. **Authority: highest, at the moment of write; then supersedes-by-slice-close-doc.**

**Slice/step/round handoff** (~40 files): audits, verifications, walk reports, close-outs. Historical.

**Historical R-round designer notes** (`docs/design-prototypes/dist/**`): CD's prototype-round outputs. Multiple rounds (R1-R8). Some referenced actively (R7b designer notes still cited); some effectively archival. **Authority: R-round-N notes supersede R-round-(N-1) for the surfaces they cover.**

**Audit findings directory** (`docs/audit-findings/`, ~22 files): Designer audit outputs, per-slice. Historical.

**Which contradict which:**
| Pair | Contradiction |
|---|---|
| SPEC.md §11 vs CLAUDE.md v1-path | Independent, non-reconciled numbering schemes |
| SPEC.md §11 vs redesign-implementation-slice-brief.md | Brief says Slice 13 "reduces or may be dropped"; SPEC still describes full scope |
| SPEC.md §11 vs bom-generator-brief.md + UX_BACKLOG.md | Slice 13 = HubSpot library sync per bom brief; Deal Organizer per SPEC |
| quote-umbrella-brief.md "item 4" vs CLAUDE.md item 7 | Brief's position number stale by 3 |
| STRATEGIC_VISION.md top-half vs revision-note-mid-file | "NetSuite integration is v2" vs "v1 ends at NetSuite SO push" — both present |
| SPEC.md §2 non-goals vs quote-umbrella-brief.md scope | "NetSuite integration (read or write)" non-goal vs Slice 12 shipping direct NetSuite push |
| SPEC.md §4 arch ASCII vs Slice 12 reality | "HubSpot → NetSuite (existing sync, unchanged)" vs Nexus → NetSuite direct |
| CLAUDE.md umbrella section (4 tabs) vs subtabs.ts (5 tabs, renamed) | Client Review tab missing; Mark Accepted / Tier Selection old names |
| IA-spec.md ("Cost Build", "Costing Sheet", "Customer view") vs post-RI.8 canon (Costs, Pricing, Quote) | Old surface names throughout |
| FR-9 (line 420, "validates both gates") vs markAccepted code | Only one gate detects; neither has working override |
| SC#2 (line 613) vs Slice 12 code | Quote object + COGS not built |
| SC#4 (line 615) vs Slice 12 code | Existing HubSpot → NetSuite sync bypassed |
| SPEC.md §5 data model vs current schema | packaging_inputs / freight_inputs / production_inputs / quote_skus tables all DROPPED via Slice 11.5.1 |

**What CA hasn't seen** (from her list of four): probably IA-spec.md, BOM_NOTES.md, quote-umbrella-brief.md, redesign-implementation-slice-brief.md, cross-round-reconciliation.md, the ~30 cc-comm-*.md memos where load-bearing disposition decisions live, and CLAUDE.md's Pattern 22 §0.5 ledger + slice sequencing sections. The most consequential for readiness: **redesign-implementation-slice-brief.md** (2026-05-05) — it's the closest thing to a spec revision that exists, and it explicitly leaves the Slice 13 disposition as an open question.

---

## 9. CC's own assessment — where the doc-vs-reality gap is largest

The nominal answer is "the HubSpot Quote object with COGS," and it IS the largest single feature gap. But that's a specific unshipped feature, not the pattern.

**The pattern I see is: architectural direction reversed by slice-scope decisions, without any pass back to update canonical docs.** Three examples:

1. **NetSuite integration moved from v2-non-goal to v1-goal.** Decided in `quote-umbrella-brief.md` + STRATEGIC_VISION.md's revision note. SPEC §2 not updated.

2. **HubSpot integration depth reduced from "Quote object + line-item COGS" to "deal stage + amount push."** Never explicitly decided in any doc I could find. Just quietly not-built. Nothing bans a future reader from noticing this and re-scoping it as "we never finished Slice 12," which is factually accurate.

3. **The `quote_skus` / `packaging_inputs` / `freight_inputs` / `production_inputs` data model was replaced entirely** by Slice 11.5's NEW model + Slice 11.5.1's OLD-table DROP. SPEC.md §5 still describes the old shape. A new dev reading SPEC.md today would build against a schema that hasn't existed for two months.

**The doc-vs-reality mechanism this creates is worse than any single stale item.** When a doc is out of date, you can spot it — you check dates, you cross-reference. When docs are **selectively** out of date — some fresh (patterns, CLAUDE.md operational bits), some ancient (SPEC.md data model, SC#2, SC#4) — you have to know WHICH parts to trust. That's institutional knowledge that lives in Edward's head + CA's head + my working context. When any of the three loses continuity, the doc drift becomes actively dangerous.

**Specifically for the readiness discussion, this makes "what is v1?" the load-bearing question.** SPEC.md's v1 (from May 2026) and shipped v1 (as of today) are different products in three material ways:
- HubSpot writeback: minimal (deal stage + amount) vs SPEC's rich (Quote + line items + COGS)
- NetSuite integration: shipped vs SPEC's not-in-v1
- Gate enforcement: quote-level detection only + no working override vs SPEC's two-gate + override workflow

**Recommendation for the readiness discussion, one priority order:**

1. **Decide + document what v1 IS.** Amend SPEC.md §2 / §4 / §11 / §13 explicitly, or issue a v3.1 supersession. Don't leave it to reader inference from slice briefs.

2. **Decide + document what SC#2 is now.** Either:
   - **(a) Build it before launch** — 2-4 weeks of work; adds HubSpot Quote-object creation, line-item association, per-line COGS write. Delivers the "peak of HubSpot integration depth" STRATEGIC_VISION claims Slice 12 shipped.
   - **(b) Retire it** — reset SC#2 to what actually ships (deal-stage + amount + NetSuite SO). Explicit written acknowledgment that the "HubSpot Quote object with COGS" feature is out of v1. Move to v1.1+ backlog with a named trigger.

3. **Decide + document the gate story.** The UNDERPRICED gate and the BELOW FLOOR override are neither built nor explicitly deferred. Same fork as SC#2: build before launch (~1 week for the two gates + override modal + Slack DM wiring) or explicitly retire and rewrite SC#5.

4. **Slice numbering.** Reserve names, not slots, for the readiness/launch work. `LAUNCH-READINESS-SCOPE.md` + `LAUNCH-GATE-SCOPE.md` free the SPEC 13-17 slots for future decisions instead of overloading them.

5. **Amend the canonical data-model docs to match Slice 11.5.1 reality.** SPEC.md §5 currently describes tables that don't exist. This is the highest-risk item for a new engineer joining post-launch.

---

## Coverage of CA's 9 explicit asks

| # | Ask | Section |
|---|---|---|
| 1 | Slice numbering collision — verify | §1 |
| 2 | SC#4 vs Slice 13 cutover | §2 |
| 3 | SC#2 built or not | §3 |
| 4 | NetSuite as v1 non-goal — decision provenance | §4 |
| 5 | Other SPEC.md staleness | §5 |
| 6 | FR-7 UNDERPRICED gate reality | §6 |
| 7 | CLAUDE.md umbrella staleness | §7 |
| 8 | Docs CA hasn't seen + authority hierarchy | §8 |
| 9 | CC's own read — largest gap | §9 |

**Delivered as: written report, no fixes, no PR** — per CA's ask.
