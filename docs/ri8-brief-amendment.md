# RI.8 brief amendment

**Status:** Draft for Edward review. Polish slice; scope accumulated
from RI.0–RI.7 deferrals + Round 5 admin gap audit.

**Base brief:** `docs/redesign-implementation-slice-brief.md` §8
sequenced RI.8 as "Smoke + bug fix + design polish + light/dark mode
tuning verification | 3-5 days." This amendment expands the scope —
admin visual rebuild work that RI.7 deferred plus the audit log
polish from §3.12 lifted to its full Round 5 spec.

**No CR-SM companion expected** (polish work; no new state machine
or schema). If scoping surfaces something stateful, flag separately.

---

## 0. Frame

RI.7 shipped the admin foundation + state-machine columns + customer
view snapshot wiring functionally, but with a known visual-debt list
queued for RI.8. Plus the dark-mode verification commitment from base
brief item 9 still needs a sweep. Plus T&Cs bullet rendering, plus
Setup surface placement is an open PM call CC has been holding off on
since RI.4.

Polish doesn't mean "small." The admin visual rebuild alone is
~3 surfaces × Round 5 design treatment. The dark-mode sweep is 12+
surfaces. Estimate: 5–8 days, comparable to RI.5/RI.6 footprint.

---

## 1. Round 5 admin visual rebuild

Base brief §3.10 / §3.11 / §3.12 specifies the full Round 5 design
for the three admin surfaces. RI.7 shipped MVPs against the
functional requirements but did NOT apply the Round 5 visual
treatment. RI.0 token rebuild compounded the problem — the existing
Slice 8 admin pages had used stock Tailwind palette (`slate-*`,
`amber-*`, etc.) which RI.0's `@theme` block replaced, so RI.7
inherited the visual breakage on top of the design gap.

Spot fix in RI.7: four Save/Search buttons swapped to `.r2-btn primary`
to render as recognizable buttons (commit `2251d2d`). Rest of the
admin chrome is still broken Tailwind utilities.

### 1.1 `/admin/firm-settings` gap audit

**Brief target (§3.10, Round 5):**
- Two-state surface (read mode + edit mode); read mode shows current
  policy card with portfolio-effect strip + history rail
- Edit mode: "+5.0 pts vs current 35%" delta indicators; re-band
  preview with affected-quotes list; "Save & re-band N quotes"
  button names the side effect on its face
- Schedule-effective-date affordance drawn but inert (Round 5 backlog)

**RI.7 shipped:**
- One-state stacked-cards layout (margin policy card + customer-facing
  defaults card + current-row dl summary + history details)
- No delta indicators, no re-band preview, no affected-quotes list
- Schedule affordance not drawn

**RI.8 gap:** the entire Round 5 read/edit two-state model needs to
be built, plus the affected-quotes preview engine. The
customer-facing-defaults card from RI.7 keeps its functional scope
but visually consolidates into the read/edit model alongside margin
policy.

### 1.2 `/admin/markup-defaults` gap audit

**Brief target (§3.11, Round 5):**
- Propagation rule helper banner (persistent prose at top of page)
- Inline-edit table with live disclosure during edit ("Saving 40% →
  42% will recompute 142 line items across 11 draft quotes")
- "Unused — never used" chip on zero-use category rows
- Add Category button drawn but inert in v1

**Current state (Slice 8):** Edward smoked /admin/markup-defaults
during RI.7 walk and it returned 200; visually it carries the same
Tailwind-palette-breakage as the rest of admin.

**RI.8 gap:** apply Round 5 treatment + dry-run cost-stack engine
for the live disclosure prose. Latter is non-trivial — needs to
simulate the recompute against draft quotes without writing.
Approximate ranges are acceptable per the brief ("estimated
blended-margin shift on those drafts: +0.6 to +1.4 pts").

### 1.3 `/admin/users` gap audit

**Brief target:** none. RI.7 added this surface; brief doesn't
specify a Round 5 design for it (admin surfaces in brief were
firm-settings, markup-defaults, audit log).

**RI.8 gap:** extrapolate Round 5 register to the users table.
Same visual vocabulary as markup-defaults inline-edit table.

### 1.4 `/admin/audit-log` gap audit — see §2 below

Audit log is large enough to be its own scope item.

---

## 2. Audit log polish (§3.12 full spec)

RI.7 shipped MVP per the CR-SM §6.1 commitment. Deferred items per
the brief amendment §7 deferral note + UX_BACKLOG entries:

- **Filter chips** at top: Entity / User / Action / Date range
  (free-text search already shipped)
- **Filter status bar:** "FILTERED · All activity touching Lumen
  & Co. (project P-2418) — 6 entries across 8 days · Clear filter"
- **Time-grouped feed headers:** "TODAY · APR 30", "YESTERDAY ·
  APR 29", etc. (currently flat reverse-chronological)
- **Cascade chips:** "cascade · 4 rows × 4 tiers re-derived" when
  source change has caused_by_audit_id descendants
- **"Show derived writes" toggle:** off by default; on for forensic
  deep-dive — surfaces derived rows as visible feed entries
- **Structured diff table** per row (currently raw JSON dump)
- **URL-state for filter persistence** (deep-linkable)
- **Export CSV** of current filtered set
- **Copy deep-link** affordance
- **Pagination / infinite scroll** past 200 entries (currently
  hard-capped)

Plus the 5 pre-RI.7 action types still on generic-fallback renderer
(raws_mode_updated / production_policy_updated / tier_price_adj_updated
/ cell_target_updated / quote_level_client_target_updated). Add
explicit renderer cases per the convention.

---

## 3. T&Cs bullet rendering

Per UX_BACKLOG entry from RI.7 smoke. PdfTerms currently splits
on blank-line separators for paragraph rendering. Edward's first
T&Cs paste hit the limitation on the logistics rates section
(three bullets reformatted as prose-with-semicolons workaround).

**Scope:** parse common bullet markers (`-`, `•`, `*` at line
start) within paragraph blocks into rendered `<ul>` lists. Keep
the small-text legal register.

**Alternative:** ship full Markdown rendering (bold, headings,
links — all the marks customers might paste from a Google Doc).
Tradeoff: parser dependency vs. ergonomic flexibility. Decide at
slice kickoff. My lean is the markers-only path for v1 — narrow
scope, no external dep, covers Edward's actual case.

---

## 4. Dark mode verification

Base brief §10 item 9 commits dark-mode `--ink-4` luminance tuning
during RI.0 with verification during RI.8. RI.0 implemented the
+15-20% lift on `--ink-4` per UX_BACKLOG entry "Light mode default
+ dark mode token tuning."

### 4.1 Token-set coverage check

`src/styles/design-tokens.css` defines both `:root` (light) and
`[data-theme="dark"]` token sets. Spot-verified during RI.0; RI.8
needs the full sweep.

**Surfaces to verify:**
- Home / Deal organizer (RI.2)
- Project Detail (RI.3)
- Cost Build (RI.4) — most visual complexity; cost-stack header is
  the load-bearing surface for dark-mode legibility
- Costing Sheet (RI.5) — verdict band + per-SKU breakdown
- Customer view (RI.6) — **PDF subtree uses literal OKLCH per the
  token-lock convention; dark mode does NOT apply to the
  customer-facing render**. Only the PM-chrome (toolbar, banner)
  applies dark mode. Verify the toolbar stays legible.
- Mark-Accepted (RI.6) — verdict + tier cards
- Admin surfaces (post-§1 rebuild) — verify dark mode applies
  consistently to the new Round 5 chrome
- Setup (still on legacy Tailwind v1 — see §6) — out of scope OR
  rebuilt in §6, depending on §6 decision

### 4.2 Novel work flag

Round 5 admin design (read/edit two-state with portfolio-effect
strip, re-band preview, affected-quotes list) wasn't sketched in
dark mode in the prototypes — CD focused on light-mode
presentation. RI.8 implementation may need to extrapolate dark-mode
treatment for some Round 5 patterns.

**Potential CD R7 ask:** if extrapolation lands ambiguously on
specific surfaces (e.g., re-band preview's affected-quotes list
hover state), Designer can audit + recommend; if Designer can't
resolve from existing rounds, escalate to CD via Edward + CA. My
read: most patterns will extrapolate cleanly from existing dark
tokens. Reserve CD R7 ask for genuine gaps surfaced during build,
not pre-emptively.

---

## 5. General polish + smoke pass

Final sweep across all rebuilt surfaces (RI.0–RI.7 + RI.8 new).
Categories:

- **Visual fidelity:** Designer audit per surface; catch
  late-surfacing R3/R4/R5/R6 grammar drift
- **Cross-surface consistency:** chip vocabulary, button hierarchy,
  spacing rhythm, italic-em treatment for emphasis
- **Edge states:** empty states, no-data placeholders, loading
  skeletons, error boundaries
- **Light/dark mode sweep:** per §4 above
- **Bug fix bin:** anything Edward / Designer / smoke catches
  during RI.0–RI.7 implementation that wasn't load-bearing for
  the slice it surfaced in
- **Dev stub removal:** the customer-view "↗ Mark sent (dev —
  Slice 11 replaces)" affordance gets removed when Slice 11 ships
  the real PDF flow. If Slice 11 lands before RI.8, this removal
  rolls into RI.8 cleanup; if RI.8 lands first, leave for Slice 11.

---

## 6. Setup surface determination (open PM question)

Setup / Quote Builder is `/projects/[id]/quotes/[quoteId]/page.tsx`
— the SKU + tier + notes builder. Base brief §3.5 specifies it as
"Tier 2 structural revision" but RI.0–RI.7 didn't touch it. Still
on legacy Slice 5-era Tailwind utility classes that the RI.0
@theme rebuild broke visually.

**Three paths Edward needs to decide between for RI.8:**

### (a) Fold into Project Detail

Project Detail (RI.3) is the natural home for "what is this quote
about" once scenario cards become the dominant organizing surface.
SKU + tier + notes affordances could move into the scenario card
detail expansion. Pro: consolidates a tier-2 page into the existing
rail/inbox surface; one fewer URL to maintain. Con: scenario cards
get heavier; Round 4 design didn't sketch this consolidation.

### (b) Standalone with CD R7 ask

Setup stays its own page but gets a proper Round 7 design pass —
CD designs the Tier 2 structural revision per base brief §3.5
explicitly. Pro: dedicated design treatment; matches the original
intent. Con: requires a CD round; defers RI.8 by however long CD
takes; introduces new design vocabulary that needs gap analysis.

### (c) Keep legacy Tailwind v1

Setup stays at its Slice 5 visual treatment (which is currently
visually broken under RI.0). Spot-fix the broken Tailwind palette
utilities to use @theme tokens, but don't redesign. Pro: smallest
scope; Setup is functional + PMs aren't blocked. Con: visible
visual debt; doesn't match the redesign-implementation arc that
RI.0–RI.7 established.

### R1 design source context

R1 set the canonical Setup design: "Define SKUs & volume tiers"
italic display title, two-column setup grid (SKU table left + tier
rail right), Save draft + Continue to cost build action cluster.
That's the locked design intent from base brief §3.5 ("Round 1
locked from Round 1 onward"). Round 6 prototypes don't address
Setup directly; whether Round 6's grammar carries forward to
Setup is left for Designer / CD to resolve.

**My read:** (c) is the wrong long-term answer — visible debt
accumulates. Between (a) and (b), the question is whether Setup is
a meaningfully distinct surface or scenario-card detail.
PMs presumably spend time on Setup specifically when shaping a new
quote (SKU additions, tier reshuffles); folding into scenario
cards would change that workflow. I'd lean (b) — keep Setup
standalone, get CD's R7 design treatment for it, but only if RI.8
isn't time-constrained. If Edward wants RI.8 to wrap fast, (c) +
log (b) as a follow-up slice is the pragmatic call.

**PM call needed before RI.8 kicks off** — this gates §1.3 (admin
users), §4 (dark mode sweep — which surfaces are in scope), and
the overall slice scope.

---

## 7. Visual-grammar gap analysis (CD R7 ask yes/no)

Same shape as CR-SM §5. Each new visual state RI.8 introduces,
mapped against existing R3/R4/R5/R6 vocabulary.

| New state / surface | Existing register? | New grammar? |
|---|---|---|
| Round 5 read/edit two-state on firm-settings | Round 5 designed | ❌ no — applying it |
| "+5.0 pts vs current 35%" delta indicator | Round 5 designed | ❌ no |
| Re-band preview + affected-quotes list | Round 5 designed | ❌ no |
| Markup defaults live-disclosure prose during edit | Round 5 designed | ❌ no |
| Audit log filter chips + filter status bar | Round 5 designed | ❌ no |
| Audit log time-group headers | Round 5 designed | ❌ no |
| Audit log cascade chip | Round 5 designed | ❌ no |
| Audit log structured diff table | Round 5 designed | ❌ no |
| T&Cs bullet rendering in PdfTerms | extends existing PdfTerms register (small-text legal) | ❌ no — list semantics within existing typography |
| Dark-mode treatment for Round 5 admin patterns | extrapolated from existing dark tokens | ⚠ maybe — extrapolation may surface ambiguity (see §4.2) |
| Setup surface (per §6 decision) | (a) extends Round 4 scenario card · (b) needs CD R7 · (c) extends existing Tailwind utility register | (a) ❌ · (b) ✅ NEW · (c) ❌ |

**Verdict:**
- §6 path (a) or (c): zero new visual grammar. CD R7 ask NOT required for RI.8.
- §6 path (b): CD R7 round IS required (Setup standalone design).
- §4.2 dark-mode extrapolation may surface ambiguity per-surface; resolve via Designer audit; only escalate to CD if Designer can't extrapolate cleanly.

**CD R7 ask: conditional on §6 path-b.** If Edward picks (a) or
(c), CD R7 not needed. If Edward picks (b), CD R7 is the natural
home for the Setup design treatment.

---

## 8. Implementation impact summary

If §6 resolves to (a) or (c) and §4 extrapolates cleanly:

**Files modified:**
- `src/app/admin/firm-settings/page.tsx` + supporting components
  (read/edit two-state, portfolio-effect strip, history rail,
  re-band preview engine)
- `src/app/admin/markup-defaults/page.tsx` + supporting components
  (inline-edit table, propagation banner, live disclosure)
- `src/app/admin/users/page.tsx` (extrapolated Round 5 register)
- `src/app/admin/audit-log/page.tsx` + supporting components
  (filters, time-grouped feed, cascade chips, structured diff,
  URL-state, CSV export)
- `src/components/pdf/pdf-terms.tsx` (bullet rendering)
- `src/styles/design-tokens.css` (any dark-mode tweaks surfaced
  during sweep)
- Setup page per §6 decision

**New files:**
- Possibly `src/app/actions/firm-settings-reband-preview.ts`
  (dry-run engine; non-trivial)
- Possibly `src/app/actions/markup-defaults-recompute-preview.ts`
  (same shape)

**Schema:** none expected. Polish, not feature.

**Verifiers:** none new expected. Existing RI.7 verifiers
(boundary, schema readiness, scenario-quote invariant, audit
renderer smoke) continue to apply.

**Estimated work:** 5–8 days (light-mode build + dark-mode sweep
+ smoke + bug fix). Comparable to RI.5/RI.6 footprint. Path (b)
adds 1–2 days for CD round + integration.

---

## 9. PM decisions resolved (Edward, post-review)

All six endorsed:

1. **§6 Setup determination: (c) spot-fix + log (b) as follow-up.**
   Spot-fix the broken Tailwind palette utilities on Setup to use
   @theme tokens (visible debt clears, no redesign); log (b)
   standalone Setup design with CD R7 as a follow-up slice for
   when CD has bandwidth.

2. **§3 T&Cs rendering: markers-only.** Parse `-`, `•`, `*` at
   line start into `<ul>`. No Markdown parser dependency.

3. **§2 audit log scope: all-in.** Retire the deferred queue in
   one slice — filters + time-grouped feed + cascade chips +
   structured diff + URL-state + CSV + pagination + the 5
   pre-RI.7 action renderers.

4. **§1.2 markup defaults dry-run engine: approximate ranges.**
   Per brief §3.11 spec language ("+0.6 to +1.4 pts"). Exact
   recompute simulation is over-scope for disclosure prose.

5. **§4.2 CD R7 escalation policy: Designer first.** Designer
   sign-off on dark-mode extrapolation for novel Round 5
   patterns. CD R7 ask reserved as fallback only if Designer
   can't extrapolate cleanly from existing rounds.

6. **§5 dev stub sequencing: leave in RI.8.** Slice 11 cleans up
   the customer-view "↗ Mark sent (dev)" affordance when PDF
   flow lands. RI.8 doesn't touch it.

## 9.1 Preview-engine coupling note (Edward, post-review)

The two preview engines ship WITH their respective Round 5 admin
pages — don't split into separate slices:

- Re-band preview (firm-settings)
- Recompute preview (markup-defaults)

They're load-bearing for the design intent — Round 5's read/edit
two-state's whole point is "show me the side effect before I
commit." Without the preview, the edit-mode UX is functionally
incomplete. Treat preview engines as required, not optional.

---

## 10. Decisions — status

- [x] §6 Setup determination: (c) spot-fix + log (b) follow-up
- [x] §3 T&Cs rendering: markers-only
- [x] §2 audit log polish: all-in
- [x] §1.2 markup defaults dry-run engine: approximate ranges
- [x] §4.2 CD R7 escalation policy: Designer-first
- [x] §5 dev stub: leave in RI.8 (Slice 11 cleans up)
- [x] Navigation audit findings dispositioned (Path 2 per Designer
      recommendation — see §12 + `docs/ri8-navigation-audit-findings.md`)

**All gates clear.** RI.8 implementation ready to kick off:
slice-ri.8 branches off main with the three RI.8 prereq docs as
first commit, F-1 + F-2 + F-3 inner-rail fix as second commit.

---

## 11. Sequencing within RI.8

Per resolved decisions (§6 = (c), §4 Designer-first extrapolation,
preview engines coupled to their pages, navigation audit dispositioned
Path 2):

0. **Inner-rail wiring fix** (F-1 + F-2 + F-3 from navigation audit
   — FIRST COMMIT on slice-ri.8). Headline finding: Round 4's
   canonical navigation has been silently broken since RI.3
   because `src/app/projects/[id]/layout.tsx:29` never passes
   `activeQuoteId` to `<InnerRail>`. Fixing this reframes the rest
   of RI.8 work — PMs get the intended workflow rail back.
   - **F-1 Option B:** create
     `/projects/[id]/quotes/[quoteId]/layout.tsx` where quoteId is
     a route param; thread to `<InnerRail>` there. Cleaner Next 15
     composition than client-side `useParams()` shape.
   - **Double-rail-render risk:** during implementation, watch for
     the project layout's `<InnerRail>` render AND the new quote
     layout's `<InnerRail>` render both firing. Resolution: scope
     the rail render to the quote layout only (remove from project
     layout when descending into a quote, OR have the project
     layout's InnerRail be a no-op pass-through when activeQuoteId
     is present in the route).
   - **F-2:** inner-rail.tsx:136 — change href from
     `/quotes/${s.latestQuoteId}/setup` to `/quotes/${s.latestQuoteId}`
     (drop nonexistent `/setup` segment).
   - **F-3:** inner-rail.tsx:156-162 — replace disabled span with
     `<Link>` to `/customer-view`; drop the stale "Slice 10"
     tooltip.
1. **Setup spot-fix** (per §6.c — replace broken Tailwind palette
   utilities with @theme tokens; no redesign).
   - **F-4 absorbed:** replace three-column "Cost inputs" nav strip
     with one "Continue to Cost build →" affordance per brief §3.5
     + R1 source.
2. **Markup defaults Round 5 rebuild** + recompute preview engine
   (smaller surface; warms up the Round 5 register implementation).
3. **Firm settings Round 5 rebuild** + re-band preview engine
   (read/edit two-state).
4. **Admin /users Round 5 extrapolation** (Designer-audit before
   build per §4.2 policy if extrapolation lands ambiguously).
5. **Audit log polish all-in** (filters + time-groups + cascade
   chips + structured diff + URL-state + CSV + pagination + 5
   pre-RI.7 action renderers).
6. **T&Cs bullet rendering** (small, scope-bounded; markers-only
   per §3 decision).
7. **Project Detail + Costing Sheet + per-surface tactical polish:**
   - **F-9:** Project Detail scenario card gets dual-affordance —
     "Open · Costing" + "Build" both visible per card.
   - **F-12:** wire inner-rail mini activity feed via existing
     `getProjectActivity` with smaller limit (option a, per brief
     §3.6 line 535 commitment).
   - **F-6:** move Costing Sheet "← Back to Cost Build" from
     action cluster to page-eyebrow as breadcrumb (R2 grammar).
   - **F-7:** Customer view + Mark-Accepted breadcrumbs adopt
     mono-caption register (`.r2-eyebrow` shape) instead of raw
     inline-text.
8. **Dark mode sweep** across all rebuilt surfaces (excluding
   PDF subtree per token-lock).
9. **F-10 conditional verify** post-F-1 (inner-rail fix). If
   sub-rail wiring fully resolves Cost Build's back-nav gap,
   F-10 closes. If not, escalate.
10. **Smoke + bug fix** (final pass).
11. **Designer audit** (full slice review).
12. **PR-to-main**.

---

## 12. Navigation / workflow audit (RI.8 prerequisite)

Parallel doc to this brief amendment — Edward reports navigation
feels clunky in actual use. Cross-surface workflow analysis
covering the full IA arc:

```
Home → Project Detail → Setup → Cost Build → Costing Sheet →
Customer view → Mark-Accepted → Admin
```

**Focus areas:**
- Route hierarchy + back-navigation
- Action button placement consistency across surfaces
- Inner-rail routing (which surfaces it should and shouldn't drive)
- Workflow continuity across the create → send → accept → track arc

**Scope doc:** `docs/ri8-navigation-audit-scope.md` (drafted
alongside this amendment; sets the Designer agent invocation
brief).

**Audit ran May 2026.** Designer produced 13 findings (9 tactical,
4 structural) — full output at `docs/ri8-navigation-audit-findings.md`.
Designer's competency-honesty was on point: it caught the structural
F-1 inner-rail bug WITHIN its pattern (per-surface code reading)
AND surfaced IA-level questions OUTSIDE its pattern as a clean CD
R7 ask. Both behaviors banked as durable convention in
`docs/designer-agent-prompt.md` (working principle 9).

**Disposition resolved (Edward + CA, post-Designer-audit): Path 2.**
- Tactical findings (F-1, F-2, F-3, F-4, F-5-tactical, F-6, F-7,
  F-9, F-12) absorbed into §11 sequencing. F-1 + F-2 + F-3 ship as
  the FIRST commit on slice-ri.8 — Round 4's canonical inner-rail
  navigation has been silently broken since RI.3; fixing this
  reframes the rest of RI.8.
- Structural findings (F-5-structural, F-8, F-11, F-13) package as
  a CD R7 IA ask. Designer's §4 framing forwarded verbatim:

  > "Per-surface fidelity isn't the problem — the problem is the
  > connections between surfaces. R7 design pass on: (a) Home-to-quote
  > re-entry pattern; (b) inner-rail surface-visibility rules across
  > the IA arc; (c) per-surface 'next move' affordance vs centralized
  > inbox; (d) breadcrumb standardization across quote-scoped
  > surfaces (with attention to R6's deliberate omission on Cost
  > Build)."

- **RI.9 navigation slice** opens once CD lands IA direction.
  F-5-structural, F-8, F-11, F-13 land there with the CD R7 output
  as kickoff scope.
- **F-10 conditional** — verify post-F-1 fix (see §11 step 9).

§10 checklist closed; RI.8 ready to kick off.
