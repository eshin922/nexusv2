# Surface naming canon (Slice RI.8)

The four customer-facing surfaces between Setup and Mark Accepted
were renamed during RI.8 for clearer labels. Old → new:

- **Cost build → Costs** (URL `/cost-build` → `/costs`)
- **Costing sheet → Pricing** (URL `/costing` → `/pricing`)
- **Customer view → Quote** (URL `/customer-view` → `/quote`)

Setup + Mark Accepted unchanged.

**What's renamed:**
- Route folders, component folders, page-level component names
  (`CostBuildHeader → CostsHeader`, `CostingPageHead →
  PricingPageHead`, `CustomerViewHost → QuoteHost`).
- Per-surface CSS files (`r6-cost-build.css → r6-costs.css`,
  `r2-costing.css → r2-pricing.css`, `r3-customer-view.css →
  r3-quote.css`).
- Lib + types files anchored to the renamed surfaces
  (`src/lib/customer-view-fixtures.ts → src/lib/quote-fixtures.ts`,
  `src/types/customer-view.ts → src/types/quote.ts`).
- User-facing labels in JSX text, button copy, breadcrumbs,
  back-nav, eyebrows.

**What's intentionally NOT renamed** (concept-anchored, not
surface-anchored):
- `src/lib/costing.ts` — costing math library; serves all four
  surfaces, not just Pricing.
- `src/lib/costing-store.ts` + `src/components/costing-store-provider.tsx`
  — state management for cost data; concept, not surface.
- `src/app/actions/costing.ts` — costing-math action layer;
  consumed by multiple surfaces.
- DB schema fields with "customer" (e.g., `customer_facing_notes`,
  `customer_accepted_at`) — describe the customer entity, not
  the Quote surface.
- Audit log action names like `customer_acceptance_recorded` —
  describe business events (customer's acceptance), not surface
  refs.
- `quote.status` enum values (`draft` / `sent` / `accepted` /
  `superseded` / `lost`) — describe lifecycle, unchanged.
- `getCostingBundle`, `QuoteCostBreakdown`, `CostingPage` type,
  etc. — concept-anchored types.

**URL awkwardness flag:** `/projects/[id]/quotes/[quoteId]/quote`
repeats "quote." Edward's call: accept the repetition for
label/URL consistency. Don't reroute or alias.

**301 redirects** in `next.config.ts` preserve external bookmarks
to the old paths. Same precedent as F-4 redirects from
`/packaging`, `/production`, `/freight` to `/cost-build` (which
is now `/costs`).

**Future-CC default:** use the new surface names in all new code,
comments, and documentation. Reference: Edward's rename directive,
May 2026.

## Rename heuristic — surface refs vs concept refs

When a UI surface is renamed (or any large semantic rename ripples
through the codebase), the operating heuristic is:

> **Rename surface references. Preserve concept references.**

A reference is a *surface* reference if it would change with the
surface (file is named after the surface, label is rendered to PMs,
URL path is the user-facing IA). A reference is a *concept*
reference if it would survive a surface redesign — math libraries,
state stores, action layers, schema columns, audit-log action keys,
enum values, business-event names.

**Applied during the Slice RI.8 surface rename (May 2026):**

- Renamed: `src/components/cost-build/` → `src/components/costs/`
  (surface-anchored folder), `CostBuildHeader` → `CostsHeader`
  (page-level component), CSS files `r6-cost-build.css → r6-costs.css`
  (per-surface stylesheet).
- Preserved: `src/lib/costing.ts` (math library used by every
  surface), `src/lib/costing-store.ts` (state mgmt), `src/app/actions/costing.ts`
  (server actions), `customer_facing_notes` + `customer_accepted_at`
  (schema fields describing the customer entity, not the Quote
  surface), `customer_acceptance_recorded` audit action (business
  event), `quote.status` enum values.

**Practical test when uncertain:** ask "would this reference
survive a future complete redesign of the surface — different
visuals, different IA, different label?" If yes, it's
concept-anchored — preserve. If no, it's surface-anchored — rename.

This rule applies to future renames too. Recognizing the
distinction early prevents drift in two directions: over-renaming
(concept names get dragged into the rename, breaking semantic
clarity) or under-renaming (surface-anchored identifiers stay on
the old name, creating drift between naming and label).

## "Design was illustrative; real data needs different proportions"

CD's design prototypes are anchored on mock data. When real
production data stresses dimensions that the mock didn't —
column widths, row heights, list lengths, character counts —
deliberate drift from the design source's literal proportions is
sometimes necessary. The drift is acceptable when:

- the design source's *intent* is preserved (composition, register,
  grammar) even though numeric proportions change
- real data documentably exceeds the mock's range (e.g., production
  HubSpot product names "Hydrating Glow Serum 50ml Glass Dropper
  Bottle Frosted" vs R1's toy "Foo product")
- the change is documented explicitly in the commit message so
  future fidelity audits don't flag it as drift-from-spec

Caught Slice RI.8 step 1.5 — R1's setup-grid `1.4fr 1fr` proportion
was sized for short SKU table mock data; real DPS product names
truncated badly in the half-width column. Widened to `2fr 1fr`
(~67/33) with explicit doc + commit-message rationale. Designer
audit weighed this against R1 fidelity intent and confirmed the
composition (SKU table dominant left, tier rail flanking right)
is preserved.

When this pattern recurs: name the dimension under stress (column
width, row height, etc.), document the mock vs real-data
mismatch, get Edward + CA sign-off if the drift is non-obvious.
Don't silently re-proportion under "looks better with my data."

## "Functional dependency check before dropping an affordance"

Before removing a UI affordance — even one that visually doesn't
fit a redesign — audit whether it's the **sole authoring surface**
for any underlying data. If yes, drop-and-replace, not just drop.

A "sole authoring surface" check:
- Is there ANOTHER UI surface that can write the same column /
  field / setting?
- Is there an action layer the affordance is the only caller of?
- If the affordance disappears, is the data effectively read-only?

If any answer is yes, the affordance is load-bearing — design a
replacement workflow before dropping. The replacement may live
on a different surface (row-expand drawer, modal, dedicated
admin) or fold into an adjacent affordance.

Caught Slice RI.8 step 1.5 Designer audit on SKU table column
restructure. R1's six-column layout drops the inline Notes
column entirely. v1's per-row notes input is the ONLY UI write
path for `quote_skus.notes` (the page-level NotesEditor edits
*quote-level* `internalNotes` + `customerFacingNotes` — distinct
columns). Dropping the per-row affordance without a replacement
would have made `quote_skus.notes` effectively read-only. Designer
flagged this; the work was deferred to §6.b standalone Setup
redesign which gets to design the proper replacement workflow
(row-expand drawer, modal, or per-SKU sub-editor in the
page-level Notes block).

When this pattern recurs: explicit "what writes this data today,
what writes it after the change" audit before any affordance
removal. Log the discovery if the affordance turns out to be
load-bearing — the discovery itself is reusable knowledge.

## "Two computations for similar-labeled displays will diverge"

When the math layer exposes derived approximations (e.g., a
proportional-share allocation) while another display layer uses
direct primitives (e.g., per-line markup application), the labels
imply matches but the math doesn't guarantee them. Two surfaces
labeled "Total — packaging" can produce different numbers without
either being wrong — they're just answering different questions
with different formulas.

**Reference moment:** Slice RI.8 hotfix surfaced THREE semantic
mismatches across the cost-stack architecture in a single PM
smoke session:

1. **Subtotal vs row sum**: cost-stack rows display `cost +
   markup_share` (R6 fidelity); Subtotal was reading `totalCost`
   (cost-only). PMs read the column and expect rows-sum =
   Subtotal — formulas guarantee they don't.
2. **PKG row vs drilldown TOTAL**: cost-stack PKG = `cost +
   proportional_markup_share_of_total`; drilldown TOTAL =
   `Σ unit_cost × (1 + line.markup_pct)`. ~9% ratio gap from
   weighted-average markup vs proportional re-allocation.
3. **D+T fold**: cost-stack D+T was hardcoded 0 (math layer didn't
   split duty+tariff from container freight); display label
   implied trackable component.

Root cause is the same in all three: **derived approximations vs
math-layer primitives**. The fix is structural — extend the math
layer to expose first-class per-component primitives, then every
display surface reads the same value. Avoid the trap of
"approximating in the display layer because the math doesn't
have it" — that approximation becomes a future smoke flag.

**Checklist when adding a derived display value:**

1. **Identify the primitive.** What's the single source of truth
   the math layer should expose? Don't re-derive it in the
   display.
2. **Check sibling displays.** If two surfaces both render
   "packaging total" (mini-stack, drilldown foot, cost-stack
   row), they MUST source from the same primitive. PMs read
   labels; formulas guarantee consistency.
3. **Comprehensive semantic audit before commit.** When adding
   a new display field, trace EVERY existing surface that
   shows a similar value. Compare formulas. If they differ,
   either align the formulas OR rename the labels to
   distinguish what each shows.
4. **Resist proportional-share approximations** when first-class
   primitives are achievable. Cost stack's proportional markup
   distribution was a v1 shortcut; first surfaced as PM
   confusion three slices later.

**Banked from Slice RI.8 hotfix scope expansion (May 2026).**
The first two mismatches were fixed reactively (each fix +
re-smoke surfaced the next); CA's "comprehensive semantic audit
before commit" call broke the whack-a-mole pattern on the third.
Future similar surfaces: do the audit first, ship one
comprehensive fix.

## "Surface unification can orphan components"

When consolidating routes / surfaces (route 1 + route 2 + route 3
→ single route), child components from the deprecated routes can
get disconnected during the refactor. Imports go stale; the
component file still exists but no caller references it. Result:
load-bearing UI affordances silently disappear, often discovered
weeks or months later through a "this never worked" smoke flag.

**Reference moment:** Slice RI.4 unified `/packaging`,
`/production`, `/freight` → single `/costs`. The
`CustomsRow` editor at
`src/app/projects/[id]/quotes/[quoteId]/freight/customs-row.tsx`
was preserved (per the Slice RI.4 page.tsx comment claim:
"These components are token-aware after RI.0 and don't need
rebuilding"). But it was never re-rendered inside the new
`FreightDrilldown` — the new sub-card displayed the same data
as read-only `—` placeholders. PMs lost the only path to edit
`quote_skus.duty_pct` / `tariff_pct` post-RI.4. The cost
contribution from D+T silently dropped to 0 for any quote
configured after the consolidation; freight contribution
dropped to 0 too when `sku_total_cbm` wasn't set elsewhere.
Discovered Slice RI.8 step 8 dark-mode smoke when Edward
noticed the section header em-dashes.

**Checklist for future consolidation slices:**

1. **Grep for orphaned imports.** After the consolidation:
   ```
   grep -rn "import.*<componentName>" src/
   ```
   For each component file under the deprecated route's
   directory, verify at least one production caller imports it.
   Zero callers = orphan; either re-wire or delete.
2. **Functional dependency check** on each deprecated affordance
   (see existing convention above) — already covered for
   abstract affordances, but explicitly extend to
   component-level imports during route consolidation.
3. **Action-layer audit.** Each server action exported by the
   deprecated route's files — does some active component still
   call it? If yes, the action's input UI must still exist
   somewhere reachable. If no, the action is dead code (delete
   or migrate intent into the new surface).
4. **End-to-end input-to-margin trace.** For the math the
   deprecated surface fed: write a one-paragraph trace
   ("PM enters X on surface Y → action Z writes column W →
   compute path C reads W → bucket B in QuoteCostBreakdown")
   and verify every step is reachable post-consolidation.
5. **Smoke ask in consolidation PR:** "list every column edited
   pre-consolidation, confirm a UI path edits it post-."

Slice briefs that propose route consolidations should include
this checklist explicitly. It's not paranoia; it's the durable
discipline that prevents "this never worked since the
consolidation" surfacing months later.

## "Region-scope over trigger-scope when smoke surfaces architectural issues"

When smoke surfaces multiple related issues in the same
architectural region, scope the whole region — don't patch each
trigger in isolation. The trigger that surfaces a bug is rarely
the boundary of the bug; usually it's one symptom of a
structural problem affecting the whole region.

**Reference moment:** Slice RI.8 cost-stack architecture pass.
The first smoke flag was "freight contribution shows 0 in cost
stack." Trigger-scope diagnosis would have been "fix the freight
display." Region-scope diagnosis surfaced:
- CustomsRow orphaning (RI.4 unification regression)
- Domestic-freight fallback gap (cbm-required for all paths)
- D+T folded into FRT bucket; cost-stack D+T row hardcoded zero
- Subtotal vs row-sum mismatch (proportional-share approximation
  vs per-row markup distribution)
- Cost-stack PKG vs Packaging drilldown TOTAL diverge by ~9%
  (different formulas for "similar-labeled" displays)
- Production "services billed separately" silently hides cost
  contribution from PROD column

Five+ commits to the cost math layer (Option A → Option B → Option
2 comprehensive) all addressed one region. Trying to ship each as
a 1-line patch as smoke surfaced them would have produced 5+
incremental shifts in math semantics, with PMs hitting each as a
separate confusion. Region-scoping shipped one comprehensive
math layer extension (per-component marked-up primitives), one
display alignment pass (three surfaces read same source), and
clear UX_BACKLOG entries for the remaining companion work
(RAW + PASS row restoration).

**Trigger for region-scoping:**
- Same smoke surfaces multiple issues in same architectural region
- OR fixing the trigger requires touching shared infrastructure
- OR the trigger's symptom can be reproduced from multiple
  upstream sources

**When NOT to region-scope:**
- Trigger is genuinely isolated (1-line fix with no cross-cutting
  implications)
- Scope creep beyond what's surfaced (don't preemptively rebuild
  adjacent regions just because they're "nearby")

CA's "whack-a-mole" instinct is the signal — when reactive 1-line
patches are accumulating, that's the trigger to step back +
region-scope.

## "Defer-with-rationale beats forcing uniformity"

When something diverges from an established grammar pattern,
evaluate whether the divergence reflects a structural difference
in the underlying data or workflow. If yes, document the
divergence with rationale and accept it. Don't force-fit a
uniform treatment just because adjacent surfaces have it.

**Reference moment:** Slice RI.8 Designer audit M4 — Production
section sublabel ("fees amortized · run locked") doesn't follow
the same content-describing grammar packaging and freight
sublabels use ("4 inventory-eligible · 1 supplier" / "3 lines · 2
bundled, 1 passthrough"). M4 was deferred per Edward + CA
disposition with explicit rationale: production is structurally
different from packaging/freight — a single computed line per
SKU vs an enumerable list of physical components/shipments. The
behavior-describing sublabel ("how the production data is being
treated") may be intentional grammar divergence vs the
content-describing copy used on lists.

**Pattern:** when you spot a divergence, ask:
1. Is the underlying data structurally the same? (List of items
   vs single computed value vs aggregate)
2. If yes → fix the divergence; force-fit was unintentional
3. If no → document the divergence with rationale; don't force-fit
4. Always document the "no, intentional" cases so future audits
   don't re-surface them

This prevents both directions: silently letting drift accumulate
(no documentation) AND forcing uniformity that masks structural
differences (false consistency).

## "Audit rubric coverage gap signaling"

When smoke surfaces an issue the audit didn't catch, the audit's
rubric has a coverage gap. Bank the dimension explicitly so future
audits add it as a sweep criterion.

**Reference moment:** Slice RI.8 step 11 Designer audit verdict
was APPROVE-with-three-MEDIUM-fixes. Step 10 smoke (post-audit
fixes) then surfaced: admin settings icon rendered as
sparkle/asterisk-ray glyph, not a gear. The audit didn't catch
this because iconography wasn't part of its rubric — the audit
focused on layout / typography / token usage / vocabulary
fidelity against R-source.

Bank the dimension: **iconography sweep** as an explicit Designer
audit sweep criterion. Future audits include "does the icon
choice match the surface's role / vocabulary?" as a check.

**Pattern for any audit-surfaced coverage gap:**
1. The miss itself is a 1-line fix; ship it.
2. Separately, bank the dimension as a future audit rubric
   addition. Don't bury it in the fix commit.
3. If the audit framework lives in a doc (e.g.,
   `docs/designer-agent-prompt.md`), update that doc too so
   subsequent invocations carry the expanded rubric.
4. Cross-surface dimensions (icons, motion, density grammar,
   tone-of-voice) are particularly worth banking — they cut
   across surface-specific rubrics.

Banked from Slice RI.8 step 11 smoke (May 2026). Strengthens the
case for RI.9.5 Design Audit Slice scope to include
cross-cutting dimensions, not just per-surface fidelity.

## "R-round prototype state strips are review aids, not production UI"

CD's R-round prototypes use top-of-screen tab/state strips to let
reviewers (Edward, CA, CC) flip between surface variants and
states quickly during prototype review. These strips are **review
chrome**, NOT production UI. Implementation does NOT ship them.

**Reference moments:**
- **R7a** (May 2026, nav IA round): top tab strip
  `R7A SURFACE · HOME · RULE TOUR · SETUP · COST BUILD · COSTING
  · CUSTOMER VIEW · MARK ACCEPTED` lets the reviewer click
  between surfaces in one HTML file. Production navigates via
  outer + inner rail + breadcrumb per surface-render rules.
- **R7b** (May 2026, banner states): state strip toggles between
  default · gated · terminal-muted banner states. Production
  derives state from `surfaceMeta.next_move.gated_label` +
  acceptance status; no toggle UI.
- **R5** earlier prototypes had similar tweaks panels (the
  `__edit_mode_set_keys` postMessage chrome).

**Recognition heuristic:** if a control's purpose is "let me
preview different versions of the same surface" it's review
chrome. Production users don't need that — they're in one state
at a time, driven by data + surface route.

**Production navigation source of truth:** outer rail (workspace)
+ inner rail (within-project) + per-surface chrome (Eyebrow OR
Breadcrumb, never both — R7a's load-bearing rule). Routes derived
from `surface-routes` config table. Surface-state visibility
derived from `surface-render rules` table.

**Future-CC failure mode to recognize:** seeing the strip in the
prototype and porting it as a real component. The fix is to
verify against the designer notes (R7a notes §93 explicitly
rejected a "tabs-style next-move affordance" — the rail does
that job; tabs would duplicate). When in doubt, ask: "is this
control needed for normal use, or only to navigate prototype
states during review?"

Banked from R7b banner-state strip recognition during R7b review
(May 2026); reinforced by R7a surface tab strip during RI.9
kickoff.

## "Design docs may make wishful schema assumptions; verify before encoding DDL"

When a brief references a schema entity (table, column, FK), CC
verifies the entity exists in current schema BEFORE writing
migrations. Designer / CA doesn't always have full repo schema
access at design time — what reads as natural in the design
notes may not map cleanly to v1's actual normalization choices.
Surfacing the mismatch pre-build saves the cost of a broken
migration + refactor.

**Recognition heuristic:** any DDL block in a brief that
references a table you haven't grep'd in `src/db/schema.ts` is
unverified. Cheap to verify; expensive to ship and undo.

**Reference moment:** Slice RI.9 step 0 (May 2026). R7a designer
notes + data-source map assumed a `scenarios` table; current
schema has scenarios denormalized onto `quotes` (`quotes.
scenario_label`, `quotes.scenario_status`, `quotes.
version_number`). The `schema.ts:1158` todo explicitly defers
the scenarios table to Slice 14. CC caught the FK mismatch
pre-build, surfaced to CA, dispositioned option (a) — drop
`scenario_id` from `user_surface_visits`, key on `quote_id`
(which IS a scenario version in v1 schema). Brief + data-source
map patched inline. No code thrown away.

**Surface to CA, don't silently absorb.** The brief might be
right and the schema needs updating; OR the brief might be
slightly wrong and a small adjustment makes the design work
against current schema; OR there's an architectural gap that
needs Edward + CA disposition. CC's job is to flag, not to
guess.

**Tags this pattern applies to:**
- `references <table>(id)` in DDL
- Cross-table joins assumed in data-source maps
- Schema migrations that touch entities not yet in production
- Any "this column exists" claim in brief or designer notes

Banked from RI.9 step 0 schema-mismatch catch (May 2026).
Protocol working as intended — pre-build verification caught
the issue before migration was written.

**Second instance — §6.b step 0 (May 2026).** §6.b brief
referenced four unverified schema entities pre-kickoff:

1. `quote_skus_components` table for assembly drawer's nested
   component rows (§3.3). Doesn't exist. Current schema has
   `quote_skus` as a self-referencing tree (`parent_sku_id`)
   per Slice 5.5 BOM. Per-component cost data is persisted on
   `packaging_inputs` (Cost build's packaging-lines table) —
   columns map nearly 1:1 to brief's nested-component shape
   except no name field; lines identified by line_group_id +
   supplier + category.
2. `quote_meta.{internal,customer_facing}_notes` (§3.6). Should
   be `quotes.{internal,customer_facing}_notes` (`schema.ts:255-256`).
   Notation error.
3. `markup_categories.markup_pct` (§3.3, §7). Should be
   `markup_defaults.markup_pct` (`schema.ts:596`); category is
   text PK on `markup_defaults`, not a separate `markup_categories`
   table.
4. Companion-doc paths assumed `docs/r7b-*.md` at top-level; files
   were at `docs/design-prototypes/dist/docs/`. R7a's location
   referenced in the brief was also incorrect.

Items 2-4 patched inline pre-kickoff. Item 1 escalated to Edward
+ CA for disposition (hybrid path (c) chosen pre-investigation;
sub-case to be confirmed once attachment convention + missing
name field are dispositioned).

**Pattern is paying for itself.** Two slices in a row caught
load-bearing schema mismatches before any DDL was written. If
a third instance lands the same way, consider making the
schema-verification step explicit in slice brief templates —
"§0.5 schema verification" as a named gate before §0 migration
work.

**Third + fourth instances during §6.b prep (same session as #2).**
Counted as three since #2's notation issues (quote_meta,
markup_categories, companion paths) are distinct from the
architectural Mismatch 1:

3. **§6.b architectural mismatch (Mismatch 1):** R7b designer
   notes line 79 claims "the schema is settled, the data is
   already on the SKU row" for the assembly-drawer nested
   component table. False — per-component cost data lives on
   `packaging_inputs` keyed to LEAF SKUs only, not on
   `quote_skus`. Three forks surfaced (add columns to quote_skus;
   route writes to packaging_inputs; carve to follow-up). Edward
   + CA dispositioned carve (option γ) to preserve §6.b
   shipping discipline; inline-edit affordance becomes child-SKU
   navigation list in v1; component-cost-data unification banked
   as `§6.c` candidate slice OR R7c carry-forward.

**Fourth instance — §6.b Step 0 (same prep session).** Brief
proposed adding a new `quote_skus.display_order INTEGER` column.
Pre-DDL grep on `schema.ts` revealed `quote_skus.sort_order
INTEGER NOT NULL DEFAULT 0` already exists at `schema.ts:423`,
seeded by `actions/quotes.ts:436-450` with `max(sort_order) + 1`,
read-ordered via `(sort_order ASC, created_at ASC)` in
`actions/warnings.ts:124`. Same semantics as the brief's
proposed column. Step 0 collapsed to no-op; drag-and-drop in
step 9 writes the existing column.

**Four instances in two slices.** Two pure architectural mismatches
(scenarios table, packaging_inputs/quote_skus split), two notation
errors (quote_meta, markup_categories), one duplicate-column
proposal (display_order vs sort_order). The pattern keeps paying.

**Three instances in two slices is the trigger.** Per the "third
instance" threshold above, the schema-verification step should
now be an explicit named gate in slice brief templates. Future
briefs should include:

```
## §0.5 — Schema verification (pre-DDL)

Before Step 0 (migration), CC verifies every schema entity the
brief references against current schema.ts. Each unmatched
entity is logged; mismatches require disposition before §0
proceeds. Notation errors patched inline; architectural
mismatches escalate to CA.
```

Bank in slice brief template once the next brief is drafted.
The lesson is no longer "remember to verify" — it's "make
verification a structural gate." Pattern 22 has earned its
escalation.

# Single Supabase project — dev and prod share one DB

Nexus v1 runs against **one Supabase project for both dev and prod.**
Local development connects to the same database that Vercel
production reads from. There is no separate dev/staging Supabase
instance.

Implications, all of which need to be held simultaneously when
working on anything DB-touching:

- **Migrations applied locally apply to prod.** `npx drizzle-kit
  migrate` reads `DATABASE_URL` and writes against whichever DB it
  resolves to — which is prod. This caused the Slice 8 production
  crash (digest 2641917463): a migration applied locally landed on
  prod before code deployed; every quote drill-in 500'd until the
  PR merged.
- **Manual SQL applied locally applies to prod.** Same logic for
  `drizzle/manual/*.sql` (Realtime publication ALTER, future RLS
  policies). A "dev-only" experiment via psql hits real data.
- **Realtime publication is shared.** Slice 8.5's `ALTER
  PUBLICATION supabase_realtime ADD TABLE ...` configured
  publication membership for both environments in one statement.
- **Data is shared.** There's no test fixture set distinct from
  production rows. Adding a "test" quote means adding it to the DB
  PMs use.

This is a v1 simplification appropriate for an internal tool with
~12 users; a separate dev project is the right answer once the
team grows past the foot-gun's blast radius (see UX_BACKLOG entry
"manual per-environment ops hygiene"). For now: **assume any DB or
Supabase-config change is a production change.** Treat them with
the same care.

When this stops being true (separate Supabase projects added, or
dev/prod split via Supabase branching feature once GA), this
section gets rewritten and the per-environment ops backlog item
becomes the load-bearing fix.

# Database client singleton (Drizzle + postgres-js)

The Drizzle client and underlying postgres pool are pinned to
`globalThis` in dev mode to survive Next.js HMR. Without this pin,
every code change to a module that touches `src/db/index.ts` creates a
new pool; old pools' connections leak until dev server termination.
After ~20 HMR cycles, Supabase's 200-connection limit is exhausted
(`EMAXCONN` error).

The pattern lives in `src/db/index.ts`. Production cold-starts skip the
pin (no `globalThis` stash) — each Vercel function gets a fresh pool,
which is correct.

Pool max is 10. At Nexus scale (single concurrent user typical), this
is plenty. The `Promise.all` queries in `getCostingBundle` and
`getQuoteCosting` serialize behind these 10 slots; they don't multiply
demand.

If you ever need to debug "out of connections" again, the diagnosis
order is: (1) restart dev server, (2) verify `globalThis` pin still in
place, (3) check for new code paths creating their own postgres
clients or calling `postgres()` directly (`src/db/index.ts:8` should
be the only call site).

Caught Slice 8 sub-step 5 — many file edits during the optimistic
computation work triggered enough HMR cycles to exhaust the pool.

## Dev uses DIRECT_URL (session-mode pooler at :5432), NOT DATABASE_URL

`src/db/index.ts` reads `DIRECT_URL` in dev and `DATABASE_URL` in
production. Both go through Supabase's pooler hostname; the
distinguishing port is `:5432` (session mode) vs `:6543`
(transaction mode).

Why dev uses session mode: Next.js dev (Webpack OR Turbopack) spawns
multiple worker processes (~7 observed). `globalThis` is per-process,
so each worker creates its own postgres-js pool. With many workers
holding pools against transaction-mode pgbouncer, the multiplexing
layer becomes a contention bottleneck — symptoms: requests hang for
60s+ then surface as `PostgresError 57014 statement timeout`. Tuning
postgres-js settings (`max`, `idle_timeout`, `max_lifetime`) doesn't
escape this; if anything, `max_lifetime: 60` makes it worse by
force-closing mid-query.

Session mode binds a Postgres backend per client connection
(no multiplexing complexity). With pool max=5 × ~7 workers = ~35
backends — comfortably under Supabase's free-tier ~60 cap. Slower
on paper than transaction mode; reliable in practice for our scale.

Production stays on `DATABASE_URL` (transaction mode). Vercel
functions are short-lived and benefit from transaction-mode
multiplexing — opposite tradeoff from long-running dev workers.

**Future-CC failure modes to recognize:**
- "GET /cost-build 200 in 100000ms" with no errors → pgbouncer
  saturation. Cure pattern: kill dev, wait 30s for pgbouncer to
  drain, clear `.next` and `node_modules/.cache`, restart.
- "PostgresError: canceling statement due to statement timeout"
  on a fast-looking query → backend never got the slot in time, or
  `max_lifetime` killed the connection mid-query. Don't set
  `max_lifetime` on dev pools.
- "too many connections for role" on direct connections → too many
  workers × pool max for Supabase backend cap. Drop pool max.

Caught Slice RI.4. Tried in order: Turbopack→Webpack (didn't help —
Webpack also spawns workers); pool max=10→5 + idle_timeout (helped
but still timed out); transaction-mode → session-mode pooler
(fixed). The `getCostingBundle` parallel-query discipline below is
the OTHER half of the fix; both were necessary.

## Design prototype source access (rounds 3+)

CD shipped Rounds 1, 2, 2.5 with un-bundled source under
`docs/design-prototypes/dist/source/round-N/` (HTML + JSX + CSS
readable directly). Rounds 3, 4, 5, 6 are bundler-format only —
custom `<script type="__bundler/manifest">` + base64-gzipped
asset chunks. Bundled HTML is opaque to grep / Read / Glob.

**Extraction script:** `scripts/extract-r6-source.mjs` decodes a
bundle's manifest into the same directory shape CD used for the
earlier rounds. Already run for Round 6; output at
`docs/design-prototypes/dist/source/round-6/`.

```
node scripts/extract-r6-source.mjs 5   # extract round-5
```

R6 (and likely R3-R5) actual CSS classes are **unprefixed**
(`.chip`, `.stack`, `.cell`, `.section-row`, `.sku-row`,
`.tier-col`, etc.). Earlier RI.4 work invented `r6-` synthetic
prefixes before extraction was possible — those are obsolete; new
work cites the real class names from the extracted source.

**Working pattern for any "many visual differences" smoke result
or net-new R6 surface:** comprehensive Designer audit against
extracted source → CC implements complete sweep → single smoke at
end. Iterating concern-by-concern is more expensive than the
comprehensive cycle (this was learned the hard way during RI.4
section row refinement; cost was several Designer audits + dev
cycles before the access blocker surfaced).

When CD ships proper un-bundled source for a future round refresh,
the extraction script becomes obsolete for that round.

## getCostingBundle parallel-query discipline

`getCostingBundle` runs an internal `Promise.all` of 8 queries.
**Never call it inside an outer `Promise.all`** — combined demand
balloons past pool capacity (15+ slots from a 5-slot pool is
catastrophic; even from a 10-slot pool it stalls).

Wrong:
```ts
const [skus, tiers, ..., bundle, ...] = await Promise.all([
  db.select()..., // 7 outer queries
  getCostingBundle(quoteId), // ← internally fans out 8 more
  ...
]);
```

Right:
```ts
const bundle = await getCostingBundle(quoteId);
const [skus, tiers, ...] = await Promise.all([
  db.select()..., // outer queries here
]);
```

Sequencing caps peak demand at `max(8 inner, N outer)` instead of
adding them. Page render adds <1s; under contention it's the
difference between "loads in 2s" and "hangs forever."

Pattern applies to any future helper that does its own internal
fan-out parallelism. If a function's body has `Promise.all([...])`
of more than 2-3 queries, document it on the function and don't
nest it inside another `Promise.all` at the call site.

Caught Slice RI.4 cost-build page (`/projects/[id]/quotes/[quoteId]/cost-build`).

# Browser Supabase client singleton (@supabase/supabase-js)

Sister to the Drizzle client above. Different concern: the Drizzle
client is server-side, holds a Postgres connection pool, runs in
RSC + server actions. The browser Supabase client is client-side,
holds a single Realtime WebSocket, used only by the realtime
subscription paths (Slice 8.5).

Same HMR-safe singleton pattern: pinned to `globalThis` in dev so
hot reloads don't leak WebSockets. Without the pin, every code
change touching downstream consumers re-evaluates the module,
creates a fresh `SupabaseClient`, opens a new WebSocket to
Supabase Realtime, and orphans the prior socket. Pattern lives in
`src/lib/supabase-browser.ts`. Production cold-starts skip the pin;
each browser session creates the client exactly once at module load.

Auth posture: anon key only. Read-only event stream. The two
clients are NOT interchangeable — never call `postgres()` from
client code, never call `createClient` (Supabase) from server code
unless adding a separate explicit purpose.

# Realtime ↔ optimistic store contract (Slice 8.5)

The realtime sync introduced in Slice 8.5 is not a standalone
module — it is **two ends of one rope** with the optimistic
costing store from Slice 8 sub-steps 4-6. Debugging anything that
involves "why didn't I see this update" requires understanding
both ends together. Document them together; refactor them
together; never rewrite one without auditing the other.

## The rope

Three trigger sources route into ONE reconcile pipe:

1. **Snapshot prop change** — server revalidation after this
   user's own server action, page re-renders with a fresh
   `HydrateSnapshot` prop.
2. **Per-quote realtime event** — postgres_changes on
   `quotes` / `quote_skus` / `quote_tiers` /
   `packaging_inputs` / `production_inputs` /
   `freight_inputs`. CostingStoreProvider subscribes on mount,
   filters per-input-table events client-side by
   `quote_sku_id` membership in the local store's known SKU
   set.
3. **Global ref-changed CustomEvent** — dispatched on `window`
   by GlobalRealtimeProvider when admin edits
   `firm_settings` or `markup_defaults`. Mounted once per
   session in `src/app/layout.tsx`.

All three call `scheduleReconcile(snap)` in
`costing-store-provider.tsx`. Realtime sources prepend a 250ms
**coalesce window** (bursts of remote writes collapse to one
re-fetch). Inside scheduleReconcile, the **wait-for-quiet (800ms)**
poll defers reconcile if the local user has typed within the
window. When user pauses, reconcile applies the latest snapshot via
`store.reconcile()`.

## What flows where

```
[server save → revalidation]    ──┐
[per-quote postgres_changes]    ──┼──> [250ms coalesce] ──> [getCostingBundle re-fetch] ──┐
[global ref CustomEvent]        ──┘                                                        │
                                                                                            ▼
                                                              [scheduleReconcile(snap)]
                                                                          │
                                                                          ▼
                                                       [100ms initial debounce]
                                                                          │
                                                                          ▼
                                                       [poll until lastUserEditAt ≥ 800ms ago]
                                                                          │
                                                                          ▼
                                                              [store.reconcile(snap)]
                                                                          │
                                                                          ▼
                                              [subscribers re-render: per-tier, breakdown, per-SKU]
```

Note: the snapshot-prop trigger skips the 250ms coalesce because
prop changes already debounce naturally via React. The 100ms
initial debounce inside scheduleReconcile applies to all three.

## What NOT to do

- **No granular row merging.** Realtime triggers do a coarse
  re-fetch via `getCostingBundle` and apply the full snapshot.
  Don't try to apply incoming postgres_changes payloads
  directly to the store. Granular merge is a Slice 14+ problem
  if it ever surfaces.
- **No new reconcile paths.** Adding a new trigger source means
  routing it through `scheduleReconcile`, not inventing a
  parallel pipe. Every trigger gets coalesce + wait-for-quiet
  for free.
- **No presence indicators here.** "Sarah is editing this
  quote" is a different feature, different slice (logged in
  UX_BACKLOG).
- **No conflict resolution UI.** Last-write-wins via the
  reconcile path. The "remote-changed-while-local-edited"
  awareness banner is logged separately for Slice 13.5.

## RLS-off latent dependency

The browser Supabase client uses the anon key. RLS is **off**
across all 8 subscribed tables (see "Single Supabase project"
section above and "Access model" framing). Access control is
Clerk + page/action layer, not DB row level.

If RLS is ever turned on for any subscribed table, the realtime
path silently stops receiving events from that table — events
fire server-side but fail RLS check on subscription delivery.
Symptom: per-quote sync works for some tables and not others, or
admin propagation breaks for `firm_settings` updates after RLS
hits. Diagnosis: check RLS state with
`scripts/verify/realtime-readiness.ts`. Fix: add a Clerk-Supabase
JWT bridge (own infra task; see UX_BACKLOG).

## Reference files

- `src/components/costing-store-provider.tsx` — reconcile pipe,
  per-quote subscription, scheduleReconcile, wait-for-quiet
  polling.
- `src/components/global-realtime-provider.tsx` — global
  reference-data subscription, CustomEvent dispatch.
- `src/lib/costing-store.ts` — Zustand store with
  `lastUserEditAt` tracking; reconcile action.
- `src/lib/supabase-browser.ts` — client singleton.
- `scripts/verify/realtime-readiness.ts` — checks publication
  membership + RLS state.

# HubSpot token model

The codebase uses TWO separate HubSpot private app tokens:

- **`HUBSPOT_ACCESS_TOKEN`** — read-only token for production CRM. Used by Slices 2–11 for deal search, project import, deal context refresh. NEVER used for writes.
- **`HUBSPOT_WRITE_ACCESS_TOKEN`** — write-enabled token, added in Slice 12 only. Used exclusively by the Mark-Accepted writeback flow. Read paths must NOT use this token.

This separation is intentional: it makes accidental writes during development structurally impossible, not just unlikely.

## Customs / landed-cost data (Slice 6.5)

`quote_skus` carries three customs/landed-cost columns: `cbm_per_unit`,
`duty_pct`, `tariff_pct`. **These values are NEVER customer-facing.**
They are internal inputs to Slice 8's landed-freight rollup:

```
container_freight_per_unit = (sku.cbm_per_unit / total_shipment_cbm)
                              × line.total_freight
duty_per_unit              = sku_factory_cost × sku.duty_pct
tariff_per_unit            = sku_factory_cost × sku.tariff_pct
landed_freight_per_unit    = sum of the three above
displayed_freight_per_unit = landed_freight × (1 + line.markup_pct)

where
total_shipment_cbm = sum across SKUs in this freight line of
                     (sku.cbm_per_unit × effective_units_for_this_sku)
effective_units    = freight_inputs.units_in_shipment ?? tier.qty
                     (NULL means "use tier.qty"; documented Slice 7)
```

**Note on the formula:** there is intentionally NO `/ effective_units`
trailing the container-freight expression. The `(cbm/total_cbm) × $`
already has units of `$/unit` (the cbm ratio is per-unit since
`sku.cbm_per_unit` is per-unit). Adding another `/ effective_units`
would double-amortize. An earlier draft of this section had that
typo; corrected Slice 8 when the unit-test tree caught the
discrepancy. See `src/lib/costing.ts` for the canonical implementation.

Where `sku_factory_cost` = packaging unit cost + production amortized
service fees + production raw costs (respecting
`allocate_service_fees_to_cost`).

**Customer-facing visibility rules:**
- Customer PDF (Slice 11): show only "Freight: $X" per tier (with duty
  + tariff embedded silently) when `freight_treatment = pass_through`;
  invisible (folded into unit cost) when `bundled`.
- Internal Costing Sheet (Slice 8): MAY show duty/tariff/CBM
  decomposition for PM debugging.
- **Anywhere these values render in UI, label clearly with
  "Internal — not shown to customer" badge or equivalent visual cue.**
  See `customs-row.tsx` on the `/freight` page for the canonical
  treatment.

**Effective_units convention:** when `units_in_shipment` IS NULL on a
freight row, the cost rollup MUST use `tier.qty` for amortization. NULL
encodes "use tier qty" (the typical case); a value encodes a
yield-mismatch override (ship 10k raws to produce 5k finished). Slice 8
formula: `effective_units = freight_inputs.units_in_shipment ?? tier.qty`.

These three customs fields are populated by PM after confirming with
freight forwarder; often NULL during early quote drafting. Slice 8's
Costing Sheet should surface "incomplete landed cost" state when a SKU
on a freight line has any NULL among the three.

**Percent display convention:** `duty_pct` and `tariff_pct` (and
`markup_pct` on freight + packaging) are `numeric(5,4)` decimals in DB
(0.2500 = 25%). UI shows percent values (25); the action layer
divides/multiplies by 100 at the boundary. Display formatting strips
trailing zeros.

## Assembly rules (added Slice 5.5)

`quote_skus` is a tree, not a flat list. Each SKU has a `sku_role`:

- `leaf` — terminal. Cannot have children. Usually HubSpot-anchored.
- `assembly` — holds child SKUs. Can also be a child of another assembly
  (assembly nesting is supported). Often Nexus-local.

Whether an assembly represents a "formulation," "kit," "gift set," or
finished-goods bundle is captured by `cost_category` (Slice 9), **not**
by `sku_role`. The earlier `umbrella` / `formulation_assembly` split was
a category error and was collapsed before commit.

**Validation lives in `src/lib/sku-tree.ts` (`validateAssemblyOperation`).
All assembly-mutating actions call it.** Never mutate `parent_sku_id`,
`qty_per_parent`, or `sku_role` without going through the validator.

**Transitions:**
- `leaf → assembly`: always allowed (parent state preserved).
- `assembly → leaf`: refused if the SKU has children. PMs detach
  explicitly. No auto-detach.

**Cascade-aware audit:** `deleteSku` snapshots the full subtree (root +
all descendants) and counts cascading packaging_inputs BEFORE the FK
CASCADE fires. Single audit row per user action; `diff_json` carries the
forensic record. Pattern applies to any future action that triggers
cascade.

**HubSpot reference is optional now.** `hubspot_product_id` is nullable
since Slice 5.5. Leaf SKUs are typically HubSpot-anchored; assemblies
often aren't. Slice 12 writeback skips `hubspot_product_id IS NULL` rows.

See `docs/BOM_NOTES.md` for the full transition matrix, validation error
codes, and packaging interaction. See `docs/STRATEGIC_VISION.md` for the
v2 NetSuite-master direction this schema enables.

## audit_log.entity_id is text (added Slice 8, migration 0013)

`audit_log.entity_id` is a `text` column, not `uuid`. Supports both
shapes of PK:

- **UUID-PK entities** (`firm_settings`, `quotes`, `packaging_inputs`,
  `production_inputs`, `freight_inputs`, `quote_skus`, `quote_tiers`,
  `projects`, `users`): UUIDs cast to text losslessly. Existing audit
  rows from before migration 0013 are unchanged in value, just
  re-typed.
- **Text-PK entities** (`markup_defaults.category` today; future
  Slice 13 deal organizer tags, Slice 14 scenario labels): the PK
  value goes directly into `entity_id`.

When auditing a row with a text PK, set `entity_id` to the PK value
directly. Do NOT synthesize a UUID and stash the real key in
`diff_json` — that pattern was the temporary bandaid this migration
made unnecessary, and querying "audit history for category X"
becomes a join-into-jsonb mess.

Compatible with the cascade-aware audit pattern (see Assembly rules
above): cascade snapshot diff_json shapes don't depend on the
entity_id column type.

Caught Slice 8 admin smoke-test 7: `INSERT INTO audit_log` with
`entity_id = 'Test Category'` rejected by the prior `uuid` type.
Migration 0013_wide_cassandra_nova converts via `entity_id::text`.

## Audit source convention (added Slice 9.2)

When multiple distinct origins write the SAME column via DIFFERENT
server actions, they share the same `audit_log.action` value to keep
timeline reads coherent. Disambiguate origins via `diff_json.source`.

Slice 9.2 established the pattern with `quotes.global_price_adj_pct`:

- Manual slider edit (`updateQuoteGlobalPriceAdj`) → `action:
  "global_price_adj_updated"`, no `source` key. Absence = manual.
- One-click apply of coaching banner suggestion
  (`applySuggestedGlobalAdj`) → same `action:
  "global_price_adj_updated"`, with `diff_json.source =
  "system_suggestion"`.

Single timeline of column changes; per-source filter when forensics
need it: `diff_json->>'source' = 'system_suggestion'`.

**Naming rule for new sources:** namespace by surface or origin
class, not by generic word. Use `system_suggestion` (specific),
not `suggestion` (no room to grow). When future paths land —
Slice 9.5 bulk validation engine, scenario apply, AI-assisted
recompute, etc. — each gets its own namespaced value:
`bulk_validation_suggestion`, `scenario_apply`, `ai_recompute`.
Reusing `system_suggestion` for a different surface defeats the
namespace.

**When to add `source` vs use a separate `action`:** if the writes
are the same column with the same semantic effect (PM is changing
the GPA), share `action` and namespace via `source`. If the writes
are semantically different (PM is changing GPA vs PM is changing
target margin), they get distinct `action` values regardless of
column overlap.

**Source flags scope.** `diff_json.source` values are reserved for
marking non-default ORIGIN (system-driven, scenario-applied, bulk-
imported, etc.) — distinguishing where a write came from when
multiple surfaces can produce the same column-state transition.
They are NOT used to mark action variants on a single surface (set
vs revert, update vs replace). Action variant intent is encoded in
the from/to value shape (`to: null` = clear; `from: null` = first-
time set); a source flag would be redundant. The `cell_override_updated`
action in Slice 9.3 is the canonical example of this — one action,
no source flag, set/clear/change all distinguished by from/to.

Reference: `src/app/actions/costing.ts` `applySuggestedGlobalAdj`
vs `updateQuoteGlobalPriceAdj` (cross-surface origin disambiguation),
`updateSellPriceOverride` (single-surface variant via from/to).

## Versioned-table carry-forward audit (added Slice RI.7)

When a versioned table — one where every update is a fresh row
closing the prior via `effective_until` — gains new columns, audit
**every existing update path** for carry-forward. Without carry-forward,
unchanged columns silently null out on each version bump in a path
that doesn't know about them.

`firm_settings` is the canonical example. RI.7 added 9 new columns
(vendor identity + customer-facing commercial defaults). The existing
`updateFirmSettings` action only wrote `target_margin_pct` +
`floor_margin_pct` + versioning fields when inserting the new row —
meaning every margin edit would have nulled out vendor_name +
quote_number_prefix + all the snapshot-default columns from the new
"current" row. Customer view would render empty firm name after any
margin policy change.

Fix pattern: centralize via a helper (`versionedFirmSettingsUpdate`
in `src/app/actions/firm-settings.ts`) that starts from the prior
row's values and overlays the caller's edits. Both update actions
go through it; both stay correct as new columns get added.

**When to audit:** any time a new column lands on a versioned table.
Search for `insert(<table>).values(...)` and verify each call site
either carries forward unchanged columns OR is intentionally
resetting them. Don't trust the action layer — search comprehensively.

**Tables where this rule applies today:** `firm_settings` (versioned
via `effective_from / effective_until`). Add to this list when new
versioned tables land.

Caught Slice RI.7 implementation. Pre-existing `updateFirmSettings`
needed a 30-line refactor to carry-forward all 9 new columns before
the customer-facing-defaults card UI could land — discovered while
working through admin surfaces.

## Suggested-GPA rounding convention (added Slice 9.2)

`computeQuoteSuggestion` uses `Math.ceil(adjNewRaw * 100) / 100` to
round the closed-form raw solve up to the nearest 1pp. The ceil is
intentional and serves as the safety buffer in BELOW_FLOOR state —
no explicit buffer constant.

In BELOW_FLOOR state, the closed-form solve produces a raw `adjNew`
that lands blended exactly at floor. Ceil overshoots by 0–1pp
depending on where the raw value sits in the percent grid: PM
applies → blended lands just-above floor in BELOW_TARGET state,
never exactly-at-floor. Stair-step then proceeds normally (PM
clicks Apply again, suggestion targets effective_target, blended
moves to GOOD).

In BELOW_TARGET state, ceil also overshoots target by 0–1pp. Same
logic: applying lands GOOD with a small headroom buffer, not at
exact-target.

**When to revisit:** if PMs report that applying a suggestion
overshoots target by several pp when they only needed a fraction
of a pp, that's the signal the ceil-as-buffer pattern has outlived
its simplicity. Replace with explicit buffer constant (e.g.,
+0.5pp added to raw, then floor to nearest 1pp) and tune the
buffer to taste. Until that signal surfaces, the ceil approach is
the lower-maintenance choice.

**Smoke verification (Slice 9.2):** at GPA=-20% on a BELOW_FLOOR
quote (blended 6.6%), suggested was +0% (raw -0.4%, ceil bumped to
0%). Apply landed blended at 25.31% — just above floor 25%. Next
suggestion targeted effective_target; second Apply moved blended
to GOOD.

Reference: `src/lib/costing.ts` `computeQuoteSuggestion`
(`adjNewRaw` → `suggestedAdjPct`).

## Sparkline lossiness convention (added Slice 9.4b)

`<MarginSparkline>` (per-SKU all-tiers margin viz on the per-SKU
summary row) is intentionally lossy. The shape carries the
**pattern signal** (flat / step↓ / partial / no-data); the
**quantitative load** lives in the adjacent margin column and the
per-point hover tooltips. Active-tier point is highlighted (indigo
saturated fill) so PMs see "where am I currently looking" against
the variance pattern.

This split is deliberate. Adding axis labels, tick marks, or a
shared y-axis across rows would push the viz toward "small chart"
treatment and re-introduce the chart-library question (recharts
~150KB) without buying enough — PMs read the sparkline for variance
recognition, not absolute values. If a future PM use surfaces
"shape recognition isn't enough; I need to see absolutes at a
glance," that's the signal to revisit (likely toward a column
add — "min/max margin" — rather than a sparkline upgrade).

Reference: `src/components/costing/margin-sparkline.tsx`. No chart
library deps; ~150 LOC inline SVG.

## Verdict surfacing convention (added Slice 9.4b)

When a verdict has multiple semantic pieces (direction +
magnitude, status + count, etc.), **all interpretation pieces
render inline on the surface**. Tooltip carries the underlying
raw values being compared, NOT a re-statement of the
interpretation.

Slice 9.4b's `<CompetitiveIndicator>` established the pattern.
Initial shape carried only direction inline ("under target" /
"over target") with magnitude in the tooltip. Smoke surfaced the
discoverability gap: PMs saw the chip with no signal that
hovering would reveal magnitude — meaning the magnitude was
effectively invisible unless the PM already knew to look.
Reshaped to inline both pieces ("under target by $0.74" / "over
target by $0.74"); tooltip shifted to raw comparison values
("Required sell: $X.XXXX / Client target: $Y.YYYY") at full
4-decimal precision for verification math.

Why this matters as a convention, not just a one-off fix:
hover-to-discover is a navigation pattern, not a presentation
pattern. PMs reading verdict chips at speed don't pause to
explore. Putting the second interpretation piece behind hover
loses it for the workflow. Conversely, putting raw numerics in
the chip would crowd the surface — the chip is for at-a-glance
verdict reading, not analytical comparison. Splitting along
**interpretation vs raw values** is the right axis: chip
surfaces the answer; tooltip surfaces the math.

When the convention applies: any verdict-style chip with a
magnitude, count, or differential. Examples that would follow
the same pattern:
- "3 of 7 cells benchmarked" (Slice 9.4 client benchmark card)
- "blended +2.4pp above target" (Slice 9.2 GOOD verdict context)
- Future "N OVER" / "N UNDER" rollups in Slice 9.5 validation
  engine — chip text carries direction + count; tooltip
  carries the raw cell list or numerator/denominator details.

When it doesn't apply: single-piece status chips (just GOOD /
BELOW_TARGET / BELOW_FLOOR — no magnitude in the verdict
itself). MarginVerdictPill stays single-piece because the
margin % already lives adjacent to the pill on the per-SKU row.
Adding "GOOD by 1.2pp" to the pill would duplicate the adjacent
percent reading.

Reference: `src/components/costing/competitive-indicator.tsx`
for the canonical implementation. CompetitiveIndicator's earlier
shape (tooltip-only-magnitude) is the anti-pattern this convention
prevents.

Three nullable columns sit in the schema awaiting their UI in
later Slice 9 sub-slices. Future engineer reading the schema needs
to know they exist and what they're for, even before they're
populated:

- **`quotes.target_margin_pct numeric(5,4)`** — per-quote override
  of `firm_settings.target_margin_pct`. NULL = use the firm-level
  value (current behavior). Set = replaces the firm-level target
  for that quote's blended margin verdict (GOOD / BELOW_TARGET /
  BELOW_FLOOR thresholds). **Wired up in Slice 9.2** alongside the
  per-tier price adjustment.
- **`quote_tiers.tier_price_adj_pct numeric(5,4)`** — per-tier
  override of `quotes.global_price_adj_pct`. NULL = use the global
  value. Set = REPLACES the global for that tier's costing math
  (not stacks). PMs use this when one tier needs a different markup
  than the quote-level adjustment. **Wired up in Slice 9.2.**
- **`quote_sku_tier_targets.client_target_price_per_unit numeric(10,4) NOT NULL`** —
  PM-entered customer target price per (leaf SKU, tier) cell
  ("client wants $5 landed for THIS SKU at 50k"). Lives on its own
  sparse sister table to `quote_sku_tiers`; lazy-row writes (INSERT
  for set, DELETE for clear). Drives Slice 9.4b's two-axis verdict
  (margin × competitive: COMPETITIVE / OVER_CLIENT_TARGET) and the
  reverse-solve "Apply suggested adj to match client target"
  affordance — note that affordance writes per-tier
  `tier_price_adj_pct`, NOT per-cell `sell_price_override`.
  Originally added at `quote_tiers` in Slice 9.1 migration 0014;
  moved to `quote_sku_tier_targets` in Slice 9.4b migration 0016
  after the IA spec settled per-(SKU, tier) granularity. Zero
  data migration needed (column was speculative + never written).
  **Leaf-only invariant** — matches Slice 9.3 `sell_price_override`
  posture. Customers state targets at SKU level (this surface);
  quote-level negotiation is post-MVP (Slice 9.4c was briefed +
  partially built then pulled back per surface-placement audit
  — see UX_BACKLOG entry "Quote-total client target affordance"
  for the deferral + architectural patterns preserved).
  Assembly-level was scope creep, surfaced and stripped during
  9.4b smoke. Schema accepts any role; runtime guard in
  `updateClientTarget` rejects non-leaf with VALIDATION error.
  Math layer is defense in depth — `rollUpAssemblyPerTier` always
  returns `competitiveStatus: null` regardless of input.cellTargets
  contents. **Wired up in Slice 9.4b.**

The first two columns default to NULL on insert. Existing rows got
NULL on migration. Behavior unchanged until the wiring slices land.
The third row above describes the post-9.4b shape — sparse table,
NOT NULL on the value column, mirrors Slice 9.3's `quote_sku_tiers`
pattern.

**Effective-value pattern when wiring up (Slice 9.2):** the
`quotes.targetMarginPct` and `firmSettings.targetMarginPct`
columns share the same JS property name (Drizzle infers types
per-table so types stay correct, but the namespace collides
visually). Same shape for `quote_tiers.tierPriceAdjPct` vs
`quotes.globalPriceAdjPct`. Wiring code must read the per-row
override first and fall back to the higher-level value:

```ts
const effectiveTarget = quote.targetMarginPct ?? firm.targetMarginPct;
const effectiveAdj    = tier.tierPriceAdjPct  ?? quote.globalPriceAdjPct;
```

Reading just the higher-level value silently ignores the
override. Reading the override without the fallback breaks every
quote that hasn't set one (the common case). Both directions are
foot-guns; the `??` chain is the only correct read pattern.
Surface this in the costing-rollup unit tests when 9.2 ships —
add fixtures that exercise both "override set" and "override
NULL" branches.

## Markup vocabulary decision (Slice 9.1)

The 7-category schedule (Primary, Secondary, Manufacturing,
Tooling, Freight, Soft Goods, Other) **plus** the hybrid workbook
additions (Co-Packing, Filling and Packout, Cards/Booklets,
Logistics, One Time Charges, Passthrough, R&D / Testing, Raw
Ingredients, Secondary - Cards/Booklets, Secondary - Corrugated,
Secondary - Labels, Turnkey) are the actual production vocabulary.
**Not placeholders.** Stable going forward.

The prior plan to redefine these in Slice 9 was based on a
misread that has since been corrected. Earlier comments and
banners that said "categories will be redefined in Slice 9" or
"v1 placeholders" are stale — sweep them out when you encounter
them. Slice 9.1 removed the obvious surfaces (`/admin/markup-
defaults` banner). Code comments referencing "Slice 9 redefines"
in domain files (e.g., `src/db/schema.ts` `quote_skus` block)
should be cleaned opportunistically — they're not actively
misleading anymore but they're also not true.

Default markup % values per category are a separate
data-hygiene exercise: finance reviews and confirms, admin updates
each value via `/admin/markup-defaults` (audit-logs naturally), no
code change required. See SPEC §12 open question #4 and the
matching UX_BACKLOG entry. Not slice-blocking.

## Action result pattern (added Slice 5)

Server actions return structured results, never throw on expected failure
modes (state violations, validation, not-found). Reserve `throw` for
genuine bugs and Next.js intrinsics like `redirect()`.

```ts
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

Server side: use `runAction(async () => {...})` from `@/lib/action-result`
to wrap action bodies. Inside, throw `ActionGuardError(code, message)` on
expected failures — runAction catches those and converts to a structured
`{ok: false, error}` return. Real bugs and `redirect()` propagate through.

Client side: surface `result.error.message` in UI; do not crash the page.
Pages that depend on a quote's editability should also disable inputs
**proactively** when `status !== 'draft'` (read-only mode), not just
react to action rejection. The action layer still validates server-side
(defense in depth — UI state can be stale).

This pattern replaced the older `throw new Error(...)` flow that surfaced
Next.js stack traces to end users.

## Admin role gating: page vs action (added Slice 8)

Same context-shaped split as `ActionResult` itself: page surfaces
redirect, action surfaces return structured errors. Two functions, both
DB-backed against `users.role`, but different failure modes because the
right UX differs by caller.

```ts
// src/lib/admin-guard.ts
requireAdminPage()    // for RSC / layout / page components
requireAdminAction()  // for server action bodies wrapped in runAction
```

`requireAdminPage()` throws `redirect("/?denied=admin")` on role
mismatch. Next intercepts; the browser navigates; the access-denied
banner surfaces on home. Right UX for someone fat-fingering an admin
URL. Use in `app/admin/layout.tsx` and any RSC under `/admin`.

`requireAdminAction()` throws `ActionGuardError(ERR.FORBIDDEN, "Admin
role required.")` which `runAction` converts to
`{ ok: false, error: { code: 'FORBIDDEN', ... } }`. Right UX for a POST
replay against an action endpoint: structured rejection the client can
handle without a forced navigation. Use at the top of every server
action body that mutates admin-managed data.

Why both: the layout-level redirect catches URL navigation; the
action-level gate catches direct POSTs against action IDs from
non-admin sessions (action endpoints are content-hashed but not
secret — anyone with a saved page DOM has the IDs). Both are the
real security boundary; they answer the same question with different
shapes for different callers.

Both functions go through `ensureUser()` and check `user.role` from
the database. `users.role` is the source of truth post-sign-in.
`ADMIN_EMAILS` env only seeds initial role assignment at first
sign-in; promotions/demotions made later don't auto-apply (by design
until Slice 17 ships proper user management).

Reference: `src/lib/admin-guard.ts`. Pattern instances:
`app/admin/layout.tsx` (page), every action in
`src/app/actions/firm-settings.ts` and `src/app/actions/markup-defaults.ts`
(action).

## Role gating — affordance, not architecture

Role checks happen at the cell/section affordance level, not at the
page-component or routing level. Single page renders for everyone in
a given screen; write affordances filter by role.

Example: Cost Build is one page. A PM viewing it sees all cost
groups editable. A Purchasing user viewing the same page sees
Packaging editable, Production and Freight read-only with a subtle
dim treatment and a "read-only · viewing as Purchasing" caption.
Same route, same component tree, same data fetch — the affordance
check is per-section.

This holds at Nexus's scale (5–7 users, role overlap is real,
separate IA per role would be over-engineering). It does NOT scale
to multi-tenant SaaS or large orgs where role-as-architecture buys
real isolation. Nexus is internal-tool small; the affordance
pattern is the right fit.

Distinct from the admin gate above (`requireAdminPage` /
`requireAdminAction`): admin is a hard security boundary checked at
the page + action layer because the surfaces themselves are
admin-only. Role-as-affordance applies to *shared* surfaces where
multiple roles co-edit different sections of one page.

Reference: Claude Design Round 2 pushback #3 (April 2026).

## Customer-view boundary guard — build-time invariant

Anything in the customer-facing render tree (the `<PdfPage>`
component and all descendants) must import zero modules from the
costing surface. Specifically forbidden in this subtree:

- `markup_pct`, `markup_pct_source`, component_markup
- cost_input rows (`packaging_inputs`, `production_inputs`,
  `freight_inputs`)
- `duty_pct`, `tariff_pct`, `sku_total_cbm`
- cost-stack composition (contribution_cost decomposition)
- supplier names (commercial confidence)
- `version_number`, `scenario_label` (internal versioning)
- `audit_log` fields, presence indicators, multi-user state
- any debug or QA affordances

Enforcement: build pipeline asserts the import boundary. Failure
mode: build error at compile time, not runtime check. The visual
"BOUNDARY GUARD" notice in the PM-internal preview is design
rhetoric; the actual enforcement is structural.

The PM-internal preview surface (where PMs review before sending)
renders the same `<PdfPage>` component tree the PDF generator uses.
Same component, two render targets. The PM's preview chrome
(sidebar, header, send button, download button) lives *outside*
`<PdfPage>` and is not included in the PDF render.

Reference: Claude Design Round 3, commitment #23 (April 2026). See
SPEC FR-10 for customer-view scope; UX_BACKLOG entry "Boundary-
guard build invariant" for implementation details.

## Form state pattern (added Slice 5)

All auto-saving forms in Nexus use **controlled inputs + useActionState**,
not uncontrolled forms with onBlur handlers. This avoids React 19's
implicit form-reset behavior racing against RSC updates after server
actions complete.

Server actions that mutate row state return the full updated row, not
void. The client uses the returned row to hydrate controlled state.

This applies to: SKU rows, Tier rows, packaging input rows, production
input rows (Slice 6), freight input rows (Slice 7), Costing Sheet sell
price overrides (Slice 8+), notes textareas, and all settings forms.

Do not introduce uncontrolled forms with onBlur auto-save in any slice.
Same bug pattern, same fix.

## Save handler pattern (added Slice 5)

When a controlled input change triggers a save, the save function must
receive the new value as an explicit parameter from the change event —
NOT read it from a ref or state that may not have committed yet.

Wrong:
```tsx
onChange={(e) => { stateRef.current.category = e.target.value;
                   fireSave(); }}
// fireSave reads stateRef.current.category   // stale!
```

Right:
```tsx
onChange={(e) => { stateRef.current.category = e.target.value;
                   fireSave({ category: e.target.value }); }}
// fireSave uses the parameter directly       // fresh
```

This applies to every controlled input that triggers a save: SKU rows,
tier rows, packaging input rows, production input rows (Slice 6),
freight input rows (Slice 7), and all future cost-input forms.

Why this matters: `setState` is asynchronous and `useRef` reassignment
during render only takes effect on the *next* render. If a change
handler immediately calls a save function that reads from a ref, the
ref will still hold the previous value — producing an "off-by-one"
bug where each save sends the user's *previous* selection. Symptom in
the wild during Slice 5: PM picks Manufacturing → no auto-fill; picks
Primary → markup shows Manufacturing's 0.30; picks Soft Goods → markup
shows Primary's 0.40. Pattern is one step behind.

Fix is one line per onChange: capture `const v = e.target.value;`
before `setState(v)` and pass it as a `{field: v}` override to the
save function. The save merges overrides over the ref:
`const s = { ...stateRef.current, ...overrides };`.

## Never `npm run build` while `npm run dev` is live (added Slice 9.4a)

Both write to `.next/` but with different artifact shapes —
production build emits server-rendered chunks + minified bundles;
dev emits HMR-keyed chunks + sourcemaps. Mixing them corrupts the
vendor-chunk index. The dev server starts hitting
`Cannot find module './vendor-chunks/<package>.js'` errors and the
page renders as plain HTML (no CSS, no client hydration) because
the broken chunk is the one that loads `globals.css` + the React
client tree.

**Symptoms:**
- Page renders as unstyled plain text after a refresh
- Dev server log shows `Cannot find module './vendor-chunks/<x>.js'`
- 500 errors on routes that worked moments ago

**Cause:** running `npm run build` (or any `next build`) at any
point during a `next dev` session, even after a successful build,
leaves the `.next/` directory in a state the dev server's HMR
layer can't reconcile.

**Cure:** `npm run cure` (or the manual 4-step from the next
section). The cache clear is the load-bearing step.

**How to avoid:** if you need to verify a production build, kill
the dev server first (`Ctrl+C`), run `npm run build`, then either
`npm run dev` (which rebuilds the dev cache from scratch) or
`npm run cure` (cleaner). Never overlap the two.

Caught Slice 9.4a smoke setup. Pattern is similar in shape to
"Server action ID invalidation" below — a `.next/` cache
inconsistency with a misleading symptom — but the cause is
different (build/dev artifact mixing, not Next 15 server action
content-hashing).

## Server action ID invalidation after refactors

Next 15's server actions are content-hashed. Refactors that change
function bodies — including mechanical sweeps like swapping
`revalidatePath()` for `revalidateQuoteTree()` — invalidate every
action ID. Open browser tabs hold the old IDs and POST them on the
next edit.

After multiple occurrences across Slices 5.6, 7, 8 sub-steps 4 and 6,
this is the **established cure pattern, not an edge case**. Don't
diagnose; this happens on every meaningful refactor that touches
multiple action files or shared modules. Pattern is unavoidable in
Next 15 dev mode + content-hashed server actions. Production is
unaffected.

**Symptoms:**
- `TypeError: Cannot read properties of undefined (reading 'call')`
- `Failed to find Server Action <hash>` errors
- Stack trace points at any client component import

The TypeError surfaces in `__webpack_exec__` because Next's failure
path hits undefined. Misleading; the root cause is the action lookup
miss, not a real module error.

**Cure (do all four, in order, every time):**
1. `Ctrl+C` the dev server
2. `rm -rf .next node_modules/.cache`
3. `npm run dev`
4. Close ALL browser tabs on dev ports; open fresh tab on new port

**Or one command for steps 1-3:** `npm run cure`. Runs
`scripts/cure.mjs` which kills other node processes (PID-excluded
so it doesn't kill itself), clears caches, starts `next dev -p
3000` with inherited stdio. Step 4 still on you (browser side).
(Note: cure.mjs is currently broken on Node 22.17.0+ due to a
spawn validation tightening — `spawn("npx.cmd", ...)` returns
EINVAL without `shell: true`. Until fixed, run the 4 steps
manually. Tracked in UX_BACKLOG.)

Hard-refresh is NOT enough. Restart-only is NOT enough. Both must
happen.

If after the cure the error persists on a fresh tab in a clean
environment, then it's a real code issue and worth diagnosing.
Otherwise it's the action-ID hash drift and the cure is the answer.

After meaningful action-layer sweeps, warn the user before they hit
this in the browser.

## CTE → JOIN UPDATE → nextval ordering caveat (added Slice RI.7)

PostgreSQL does NOT guarantee that a CTE's `ORDER BY` propagates into
a JOIN UPDATE → `nextval()` row-visit order. The CTE materializes the
row set, but the planner is free to choose how to scan the join, so
sequence values may be assigned in a different order than the CTE's
ORDER BY.

Concrete shape that does NOT strictly enforce order:

```sql
WITH ordered AS (
  SELECT id FROM foo
  WHERE ...
  ORDER BY sent_at ASC NULLS LAST, created_at ASC
)
UPDATE foo f
SET seq_col = nextval('foo_seq')
FROM ordered o
WHERE f.id = o.id;
```

Symptom: numbers come out *mostly* in the intended order but with
occasional swaps between adjacent rows.

**When it matters:** backfilling a sequence-derived identifier across
multiple rows where strict order is semantically important (e.g.,
oldest-first numbering for chronological reading).

**When it doesn't:** rows where the assigned identifier has no prior
external commitment AND order is informational rather than load-
bearing. Slice RI.7's `0021_quote_number_backfill.sql` is in this
category — 3 pre-RI.7 sent quotes whose customers had never seen a
number. The minor swap is acceptable; documented in the migration
itself.

**Strict-order patterns when needed:**

1. `ROW_NUMBER() + arithmetic on a base value` — bypass the sequence,
   compute deterministically:
   ```sql
   WITH base AS (SELECT nextval('foo_seq') AS start),
        ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY ...) AS rn FROM foo WHERE ...
        )
   UPDATE foo f
   SET seq_col = (SELECT start FROM base) + o.rn - 1
   FROM ordered o
   WHERE f.id = o.id;
   -- then bump the sequence: ALTER SEQUENCE foo_seq RESTART WITH ...;
   ```

2. **Per-row UPDATE in a procedural block** (PL/pgSQL):
   ```sql
   DO $$
   DECLARE r RECORD;
   BEGIN
     FOR r IN SELECT id FROM foo WHERE ... ORDER BY ... LOOP
       UPDATE foo SET seq_col = nextval('foo_seq') WHERE id = r.id;
     END LOOP;
   END $$;
   ```

Both patterns strictly enforce order at the cost of more SQL.

Caught Slice RI.7 quote_number backfill smoke (migration 0021).
Three rows; one swap between rows 2 and 3. Edward's disposition (A):
accept as-is. Convention banked here so future-CC encounters it
before tripping on a backfill where order does matter.

## Drizzle aggregation queries

Use Drizzle's column-aware helpers (`count`, `max`, `min`, `sum`,
`avg`) for aggregations whenever possible. Do **NOT** use raw `sql<T>`
templates for aggregations that return non-string types (timestamps,
dates, booleans).

Wrong:
```ts
sql<Date | null>`max(${table.column})`     // type lies; runtime
                                            // returns ISO string
```

Right:
```ts
max(table.column)                          // properly typed Date | null
```

The TypeScript generic on `sql<T>` is an assertion, not a runtime
guarantee. Drizzle's column-aware helpers bind the column type and
return it correctly at runtime. Save raw `sql<T>` for cases the helpers
can't express, and verify the return type matches reality (typically
string from Postgres for non-text types — calling `.getTime()` or
`.toISOString()` on a string at runtime throws and 500s the request).

Discovered Slice 5.6 when `getCacheStatus` used `sql<Date | null>` for
`max(last_synced_at)`; the value came back as a string and crashed
`isStale`/the cache-status route on every populated-cache visit.
