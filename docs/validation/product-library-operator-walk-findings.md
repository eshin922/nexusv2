# Product Library — operator walk findings

**Status:** open. Observations only — **nothing repaired.**
**Walk:** Edward, PR #260 head `9ab025e`, production-backed Preview.
**Date:** 2026-08-13

Disposition buckets to be applied after the walk: **V1/sign-off blocker** ·
**V1 improvement** · **deferred**.

---

## OW-1 · A Direct Product attach never flips the row to "✓ Attached"

**Reported:** pressing **Add** adds the product to the SKUs list, but the button
stays "Add" with no change of state. The only feedback that it worked is
pressing Add a second time, which refuses.

**Confirmed not a data defect.** The second press does not attach again. The
server guard in `direct-attachment.ts` holds and returns *"This product is
already attached to this quote."* One press, one attachment.

**Root cause — the readiness model is assembly-scoped and has no
representation for a direct attachment.** Two independent reasons the row can
never reach "attached" in Direct Product mode, either of which alone is
sufficient:

1. `library-browse-modal.tsx:1041-1049` derives readiness as

   ```
   row.archived ? "archived"
     : targetAssemblyId && row.attachedAssemblyIdsInTargetQuote.includes(targetAssemblyId)
       ? "attached" : "ready"
   ```

   In Direct mode there is **no** `targetAssemblyId` — that is the definition of
   the mode — so the branch is unreachable before the membership test is even
   evaluated.

2. `library-browse-loader.ts:259-266` computes
   `attachedAssemblyIdsInTargetQuote` from `assembly_leaves ⋈ assemblies`. A
   direct attach writes `quote_leaves` with `assemblyId = null` and
   deliberately **no** junction row (§9.1 approved structure), so it cannot
   appear in that set under any query.

So the modal's post-attach re-fetch — which exists precisely to flip the row —
runs, succeeds, and returns a row whose attachment is invisible to the
computation. The comment at `handleAttach` ("Refresh the library data so the row
flips to '✓ in scenario'") states an intent the read path cannot satisfy for
this structure.

**Class.** Cross-consumer gap: §9.1 added a new structural state to the WRITE
path and did not extend every consumer of that state. Same shape as the
migration lesson already banked — *"when an identity changes, enumerate every
producer of that identity"* — here a new attachment structure was added and the
readiness consumer was not enumerated.

**Consequence.** Operator trust, not data integrity. The operator cannot tell a
successful attach from a no-op, and the only available confirmation is to
trigger a refusal. On a catalogue this size that invites re-pressing rows and
reading error banners as the success signal, which inverts what the banner
means.

**Notes for disposition.** A repair is bounded and touches both halves of the
gap: the loader needs a per-row direct-attachment flag for the target quote
(`quote_leaves WHERE quote_id = target AND assembly_id IS NULL`), and the
readiness derivation needs to treat that flag as "attached" when `mode ===
"direct"`. Both are additive. The toast already fires and is unaffected. **Not
repaired pending disposition.**

**Adjacent, not yet observed either way — worth checking during the walk:**
whether the Item Group path (walk item 7) flips correctly, which would confirm
the gap is specific to the direct structure rather than to the re-fetch.

---

## OW-2 · The operator walk red-lines the Preview build (Gate 1B S-7)

**Status:** blocking the walk. **Not repaired — the fix is a disposition, not a
code change, and one of the options destroys evidence.**

The Preview build now fails in `verify:s7-preserved`:

```
FAIL  2f29af72-…  Smart Pressed Juice - Juice Cleanse Reorder 2026 / Primary
        skuRollups: length 4 -> 6
A commercial number moved.
```

**It is not a number moving and not caused by the B-1 repair.** It is a
LENGTH change: two products were added to a quote inside the S-7 preservation
basket. Established from the database rather than inferred:

```
2026-08-05 18:15…  grouped  50ml Plastic Stick (50% PCR)
2026-08-05 18:16…  grouped  50ml Plastic Stick (70%PCR)
2026-08-05 18:16…  grouped  75ml Aluminum Wax Stick
2026-08-13 23:46:47  DIRECT  10064-GNX-Box    Genexa - Box - Kids' Cough
2026-08-13 23:46:57  DIRECT  DPS-BOTTLE-0001  Primary - Bottle

audit: 2 x quote_product_attach, edward.shin@gmail.com, 2026-08-13 23:46
```

Both are Direct Product attachments made during the operator walk — walk item 6,
"existing Direct Product attachment." **The gate is working correctly.** It
detected that a baselined quote changed shape.

**The structural tension it exposes.** The S-7 baseline is captured over LIVE
quotes in the shared dev/prod database, so exercising the product-attach
workflow on any baselined quote turns the build red. The operator walk and the
preservation gate are pointed at the same rows. The walk cannot get a new
deployment while this stands — the branch alias still serves `9ab025e`, which
predates the B-1 repair.

**Options, for disposition — I have not chosen one.**

1. **Refresh the S-7 baseline** to absorb the walk's additions. Precedent
   exists (`065aed3`, `d2a9272` — "identity and fixture-content causes recorded
   separately"). Cheapest; requires stating that the delta is operator-walk
   attachment and nothing else.
2. **Walk on a quote outside the basket**, and leave the baseline alone.
   Preserves the reference exactly; costs a fixture.
3. **Detach the two products.** **Not recommended.** `2f29af72` is the Smart
   Pressed Juice quote used for the M1-M4 NetSuite certification, so its state
   is evidence, and detaching would also destroy the walk state that produced
   OW-1. Same reasoning already applied to SO2707: preserve the artifact rather
   than manipulate it back into a fixture.

---

## B-1 · No visually discoverable "Create Item Group" action — **V1 SIGN-OFF BLOCKER**

**Reported:** the quote setup surface gives the operator no discoverable way to
create an Item Group. Direct Product and Item Group are peer structural
choices; the operator should not have to infer that an Item Group must exist,
discover it through a disabled Library state, or know where else to create one.

### What is actually on the surface

A `+ Add Item Group` button **does** exist, as a ghost peer beside the primary
`+ Add Product` (`assembly-tree-view.tsx:115-135`). So the finding is not that
the button is absent. **It is that the button does not create an Item Group.**

It opens the Library browse modal in `group` mode, which can only attach into an
Item Group that already exists. On a quote with none:

- `attachReady = mode === "direct" || Boolean(targetAssemblyId)` is false, so
  **every row's Add button is disabled**;
- the target picker does not render at all — it is gated on
  `assemblies.length > 0` (`library-browse-modal.tsx:752`);
- in its place sits an **inert caption**: *"No item groups in this quote /
  Create an item group before adding products"* — an instruction with no action
  attached to it.

### The only route to creating one

`createAssembly` has exactly **one** caller in the entire client tree:
`add-product-modal.tsx:199`. That modal is reachable only from **inside** the
Library modal, via `+ Create new product`. Its header then reads
**"Add product · ASY"**.

So the operator's actual path is:

> press `+ Add Item Group` → land in a Library that can add nothing → find
> `+ Create new product` → switch a sub-toggle → arrive at a screen labelled
> "Add product · ASY"

Every step of that is the inference chain B-1 says must not exist, and the last
step reintroduces the ASY vocabulary the same slice claimed to have removed from
the operator workflow.

The empty-state copy already promises the model B-1 asks for — *"Nothing on this
quote yet · use Add Product for a single product, or Add Item Group to sell
several together"* (`assembly-tree-body.tsx:117`) — so the surface tells the
operator a peer choice exists that it does not implement.

### Regression, or incorrect prior acceptance?

**Incorrect prior acceptance. Not a regression.**

Before `2f50d22` the surface had a single `+ Add component →` CTA that opened
the same Library, and `createAssembly` had the same single caller inside
`add-product-modal.tsx`. **No create-Item-Group affordance existed to lose.**
`2f50d22` split one attach entry point into two and did not add a create path
for either.

### Why the evidence read as DONE

`2f50d22` shipped 16 wiring regressions. Four bear on this. Read precisely:

| test | what it actually asserts |
|---|---|
| "Setup exposes Add Product and Add Item Group as peers" | `mode="direct"` and `mode="group"` appear in the view — two **props** |
| "each trigger names exactly one structure" | the two **label strings** exist |
| "the two actions route to two different writers" | `attachQuoteProduct` vs `attachAssemblyLeaf` — both are **attach** writers; neither creates |
| "the grouped path still creates the grouped structure" | `assemblies.ts` contains `insert(assemblies)` — the action **exists**, not that anything reaches it |

Every one of them is true, and passes today. **Not one connects the
`+ Add Item Group` button to `createAssembly`.** The suite certified that a
correctly-labelled button exists and that the two attach writers never cross
over — which was the real risk the slice was guarding, grouping being *inferred*
from product count. It never asked whether the grouped path was **reachable from
an empty quote**.

This is the same instrument error twice recorded in this session: *a measurement
that cannot express the failure it is meant to exclude*. A grep for `mode="group"`
cannot fail when the capability behind the mode is missing. The commit's claim of
"two peer operator actions" was true of the buttons and false of the actions.

**Not established:** which quote the prior operator walk used. The dead end
appears **only on a quote with zero Item Groups** — with any existing group the
target picker renders and the grouped flow works normally. A walk conducted on a
quote that already had structure would not have encountered it. That is the
likely explanation for the walk passing, but I have not established it and am
not asserting it.

### Repair shape, for disposition — not implemented

Bounded, and additive only: a `+ Create Item Group` peer action on the setup
surface that invokes the **existing** governed `createAssembly` flow. No second
creation implementation, no change to structural semantics, no Library redesign.
The grouped Library flow continues to handle adding products once a group
exists.

Two adjacent items surfaced by the same trace, recorded separately and **not
repaired**: the `+ Add Item Group` label describes attaching rather than
creating, and `add-product-modal.tsx:280` still renders **"Add product · ASY"**
to the operator.

### B-1 · repair record (2026-08-13)

Three capabilities, separated. The `createAssembly` writer is unchanged — this
moves entry points and vocabulary, not semantics.

| operator intention | entry point | writes |
|---|---|---|
| **Add Product** | `+ Add Product` → Library (direct mode) | `quote_leaves`, `assembly_id = NULL` |
| **Create Item Group** | `+ Create Item Group` → dedicated modal | `createAssembly` — quote-local structure only |
| **Create New Product** | `+ Create new product`, inside the Library | `createLeaf` — library master data only |

- `CreateItemGroupModal` is new and calls the **existing** `createAssembly`. The
  form fields moved out of the shared modal; no second writer exists.
- The ASY branch is **removed** from Create New Product — state, submit handler,
  `createAssembly` import, `AsyFields`, and the ASY/LEAF toggle. That modal can
  no longer produce quote structure.
- `+ Add Item Group` → **`+ Add to Item Group`**, and it now renders **only when
  `assemblyTargets.length > 0`**. The Library attaches into a destination, so it
  is no longer offered as the way to create one.
- `ASY` no longer appears in any operator-facing string on these surfaces; it
  remains in code comments, as the earlier slice explicitly allowed.

**Post-create chaining into the grouped Library was NOT implemented.** It needs
an initial-target prop plus a dependency on `router.refresh()` landing before
the Library reads `assemblies`; until it does, the target id resolves to no
entry and the header renders a blank destination. That is a plausible-but-wrong
intermediate state, so the optimisation was declined as broadening rather than
shipped racy. The operator creates the group, sees it in the tree, and uses
`+ Add to Item Group` — which is now present because a destination exists.

### B-1 · evidence, and what the previous evidence did not establish

The prior tests asserted **labelled peer triggers** and **non-crossing attach
writers**. Both were true, both still pass, and neither could establish
grouped-creation reachability. The earlier operator-walked claim is **not
retained** as covering the zero-group state — it did not.

Replaced with a link-by-link reachability walk from the setup surface to
`createAssembly`, which names the broken link rather than returning a boolean.
It is falsified two ways:

1. **In-test**, against a reconstruction of the pre-repair wiring (setup surface
   offering only the two Library triggers) → rejected,
   *"renders no create-item-group action"*; and against the narrower regression
   of gating the create action on `assemblyTargets.length > 0` → rejected,
   *"gated on an existing Item Group"*.
2. **Against the live repository.** Deleting `<CreateItemGroupTrigger>` from
   `assembly-tree-view.tsx` and re-running produced
   `not ok 1 … broken: 'setup surface renders no create-item-group action'`.
   Restored; suite green again.

Retained coverage: Add Product remains the Direct path; Create Item Group
touches no library writer; Create New Product has no `createAssembly` and no
mode toggle; the grouped Library entry appears only once a destination exists;
structure is never inferred from product count; both governed writers unchanged.

`npx tsc --noEmit` clean · `npm run test:unit` **1171/1171**.

**Operator sign-off remains blocked** pending the repaired walk.


### OW-2 · resolution — isolated first, refreshed second (2026-08-13)

**Option 1 taken.** The two Direct Products were NOT detached and no fixture was
created. Order is the point: **preservation is established by the pre-refresh
diff below.** The refreshed baseline is green by construction and is evidence of
nothing.

`verify:s7-preserved` reports the FIRST difference and stops — right for a gate,
useless for justifying a refresh, because `skuRollups: length 4 -> 6` is equally
consistent with two rows added AND a price moving inside one of the other four.
`scripts/gate-1b/ow-2-isolate.ts` proves the delta narrowly. **5/5:**

```
PASS  the failing quote is the ONLY basket member whose projection changed
        changed: 2f29af72 · basket size 30
PASS  no quote-level value moved — tiers, quoteRollup, quoteSummary, firmSettings
PASS  every pre-existing rollup is identical to the prior baseline
        4 retained rollups compared field-by-field
PASS  the two added rollups correspond exactly to the two operator-walk attach events
        f429f95e @ 23:46:47 · 1d4f658e @ 23:46:57 · edward.shin@gmail.com
PASS  no governed numeric value moved anywhere in the basket
```

**An instrument error found while building the proof, and worth keeping.** The
first version of the isolation screened the gate's POSITIONAL diff and reported
~100 moved prices. Direct Products render FIRST, so inserting two at the head
shifts every array index: the entire rollup array reads as moved. Compared by
`skuId`, all four retained rollups are byte-identical. The positional reading
would have argued for REFUSING a refresh that is in fact justified — the same
class of error as a filter that cannot express its own failure, and the more
dangerous direction of it, because refusing looks like caution.

**Refresh delta, verified rather than assumed** — old vs new baseline:

| | |
|---|---|
| entries | 30 → 33 |
| **changed digests** | **1** — `2f29af72`, the isolated quote |
| removed | 0 |
| globalDigest | `fc89ad0f…` → `08986108…` |

Cause: intentional operator-walk structural attachment of two Direct Products.
**Not a costing or arithmetic change.**

### OW-3 · the refresh enrolled three disposable certification quotes

**Surfaced, not resolved — it needs its own disposition.**

The 3 new baseline entries are certification scratch:

```
a4c36959  Root - 2 Side Seal Sachets      / CERT-MIXED-DELETE-ME-2026-08-13T20-26-37
ad6f7513  Hanks - Hydration Full Retail   / CERT-MIXED-DELETE-ME-2026-08-13T21-26-07
d6a3ba17  Smart Pressed Juice             / CERT-MIXED-DELETE-ME-2026-08-13T22-43-03
```

Before the refresh the verifier listed them as *"new since baseline, not
covered"*. They are now permanent preservation references — quotes whose own
labels say they are to be deleted. **When they are deleted, S-7 will fail with
"in baseline, absent now. Coverage silently shrank"**, which reads as
preservation loss and will not be one.

This is precisely the mechanism `basket.ts` already documents for the validation
namespace: *"the basket is a QUERY rather than a list, so each one joins the
release's governing evidence automatically and silently."* The `ZZ-VALIDATION-`
exclusion gave that convention force for one namespace. `CERT-MIXED-DELETE-ME-`
is a second namespace with the same property — created to be driven and
discarded — and has no exclusion.

Not fixed here: extending the excluded-namespace set is a change to the basket
DEFINITION, which is a governance decision and outside the narrow authorization
to refresh. Recommended follow-up: exclude a certification namespace the same
way, then recapture. Doing so removes the three entries symmetrically, per the
`baselineEntryInBasket` rule that already prevents an exclusion from reading as
shrunken coverage.

### Workflow lesson — do not mutate S-7 baselined quotes during a walk

Use a **non-basket** quote for Product Library validation unless the walk
specifically targets S-7 behaviour. The basket is a live query over
structure-bearing production quotes in the shared dev/prod database, so any
attach, detach, or cost edit during a walk turns the build red and forces a
baseline disposition mid-review. A quote is in the basket if it has at least one
`assembly_leaves` row and its `scenario_label` is outside the excluded
namespaces — which is most real quotes, so the check is worth making before the
walk rather than after the build fails.

---

## B-4 · SKU tree has drifted from the Design Authority — **V1 SIGN-OFF BLOCKER**

**Investigation only. Nothing repaired.**

### The governing source

`src/styles/r-a1v2-setup.css`, imported verbatim under Pattern 30
path-B-default from CD's `docs/design-prototypes/dist/qw_styles.css`. It is the
DA for this tree. Two documented drops (review-chrome state strip, a
`--paper-4` override); no other content modification. The implementation's own
CSS is therefore *not* the reference — the upstream file is.

### What the DA specifies

**Item Group — `.a1v2-asy-row`**

| | |
|---|---|
| grid | `24px 90px 1fr auto auto auto` — **six columns** |
| padding | `14px 16px` |
| left rule | `3px solid transparent`; **`.expanded` → `border-left-color: var(--accent)`** plus an accent-tinted background |
| name | **14px, `var(--display)`, italic**, weight 500 |
| sku pill | accent-tinted fill, `--accent-ink`, weight 600 |

**Member products — `.a1v2-leaves` > `.a1v2-leaf-row`**

| | |
|---|---|
| container | `.a1v2-leaves` — `background: var(--paper-2)`, bottom rule. A **contained block**, not loose rows |
| grid | `60px 110px 1fr auto auto auto`, `padding: 10px 16px 10px 60px` |
| connector | `::before` 1px vertical at `left: 38px`, full height; `::after` 14px horizontal tick at `left: 38px, top: 20px`; **`:last-child::before { bottom: 50% }`** so the spine terminates at the final tick |
| name | **12.5px, regular** — deliberately subordinate to the group's 14px display italic |
| sku | plain mono text, **not** a pill |

**Standalone Product — the DA specifies nothing.** Direct Products are §9.1,
added days ago. There is no canonical treatment to have drifted from; whatever
renders today was invented.

### Difference ledger

**Approved dispositions — preserve**

1. **Direct Product reuses the `.a1v2-asy-row` register.** Recorded as a nexus
   extension with rationale in `r-a1v2-overrides.css`: a Direct Product is a
   *peer* of an Item Group, so same height, rhythm and left rule; the rule is
   set to `--ink-4` because the accent-on-expanded treatment could never fire on
   a row with no children. Pattern 39 shape — documented at the extension site,
   real data behind it.
2. **Drag-handle affordances** on both row types — additive, documented.
3. **`ASY-{quote-short}-{n}` as a generated SKU** is a *placeholder* by design
   (`assemblies.ts:144`), used only when the operator supplies none.

**Unapproved drift**

4. **The peer treatment is now indistinguishable from the group.** The
   disposition says "same register, distinguished by the left rule". In practice
   both rows resolve to the same rule colour in the common case: an Item Group
   turns accent only when `.expanded`, and `isExpanded` is
   `asy.children.length > 0` — so an **empty** Item Group and a Direct Product
   are pixel-identical apart from a non-interactive twirl glyph. The distinction
   was made to rest on a state that does not track the structural difference it
   is being asked to express.
5. **The Item Group grid is overflowing.** `.a1v2-asy-row` defines **six**
   columns; the row now renders **eight** children — twirl, sku-pill, name-cell,
   leaf-count, rollup chip, notes trigger, **`+ Add products`**, context menu.
   The surplus wraps onto an implicit second row, which is why `+ Add products`
   drops beneath the group instead of sitting in the action cluster, and it
   breaks the visual seal between the group header and its `.a1v2-leaves` block.
   **This is mine, introduced in `aa24134`** — and it is the exact failure the
   Direct Product override's own comment describes avoiding ("rather than
   letting the surplus child wrap onto an implicit row"). The grid was restated
   there and not here.
6. **`ASY-*` is operator-visible in the sku pill**, in the highest-contrast
   treatment on the row (accent fill, weight 600). The placeholder predates the
   vocabulary disposition, and the vocabulary sweep covered JSX strings and
   never looked at generated *data*. Operator-visible `ASY` therefore survives a
   test asserting it is gone — the test reads source text, and this string is
   produced at runtime.
7. **Member rows read as detached.** **The canonical member connector was NOT
   shown to be defective** — it is intact and matches `qw_styles.css` exactly.
   The major visual detachment came from the parent grid overflow wrapping
   `+ Add products` onto an implicit row, which breaks the intended seal between
   the Item Group row and `.a1v2-leaves`. Two contributors, both consequences of
   the drifts above rather than of the connector: the
   wrapped grid pushes the group's own content below the connector's origin, and
   `.a1v2-leaves` renders unconditionally while `.expanded` is tied to child
   count, so the container tint that should bind the block to its header is
   present but no longer aligned with an accent-marked header.

### Minimum restoration proposed — not implemented

Ordered by whether it restores canon or completes it. Nothing here is a
redesign, and no capability is removed.

1. **Restate the grid where a cell was added.** `.a1v2-asy-row` carrying the
   `+ Add products` cell gets a seventh column, exactly as `.a1v2-direct-row`
   already does for its actions cluster. Removes the implicit row and reseals
   the group header against its member block. *Restores canon; fixes drift 5 and
   most of 7.*
2. **Bind the group's accent rule to being an Item Group, not to being
   expanded.** Apply the canonical `border-left-color: var(--accent)`
   structurally, and keep the tinted background for the expanded state. Uses the
   DA's own token and treatment; changes only what triggers it. *Fixes drift 4
   without inventing anything.*
3. **Stop rendering the `ASY-` placeholder to the operator.** The stored value
   is referenced by certified NetSuite projection and audit evidence and must
   **not** change; this is a display rule — suppress the pill when the SKU is a
   generated placeholder, or render the group's position instead. *Fixes drift
   6. Data untouched.*
4. **Give the standalone product its own first-level mark.** The only item with
   no canonical source, so the minimum is the smallest thing that carries
   meaning: the DA already reserves the 24px column for a twirl the Direct row
   cannot use. Filling that column with a leaf-level glyph — the DA's own
   `.leaf-icon` register — states "single product, nothing below" in existing
   vocabulary. *Completes canon rather than extending it.*

Recommend CD review before item 4 ships, since it is the one with no upstream
source. Items 1-3 are restoration and can be evidenced against `qw_styles.css`
directly.

---

## B-4B · Broken member action menu — **V1 SIGN-OFF BLOCKER**

**Inventory only. No code changed.** B-4A (structural/visual) is parked; its
item-3 helper is written but unwired and uncommitted.

### Capability matrix

**Item Group member row — the `…` overflow menu (6 items)**

| # | action | reachable | handler | expected | actual | V1 | coverage |
|---|---|---|---|---|---|---|---|
| 1 | Edit specs | **yes** | `<Link>` → `/leaves/{leafId}/specs` → `updateLeafSpec` | navigate, edit spec values | works | **required** | **none** |
| 2 | Move up | **no** — `disabled` | none | — | inert | no | n/a |
| 3 | Move down | **no** — `disabled` | none | — | inert | no | n/a |
| 4 | Move to another item group | **no** — `disabled` | **no writer exists** | — | inert | product call | none |
| 5 | View library record | **no** — `disabled` | none | — | inert | product call | none |
| 6 | Remove from item group | **yes** | `detachAssemblyLeaf` | delete junction, keep library leaf | works | **required** | `product-structure-slice1-compatibility` |

**Direct Product row — inline (2 items)**

| # | action | reachable | handler | expected | actual | V1 | coverage |
|---|---|---|---|---|---|---|---|
| 7 | Edit specs | **yes** | same `<Link>` as #1 | navigate, edit spec values | works | **required** | **none** |
| 8 | Remove | **yes** | `detachQuoteProduct` | delete this quote's `quote_leaves` row | works | **required** | **none** |

**Four of six member-menu items are `disabled` placeholders.** Their `title`
attributes carry the deferral reasons: *"Drag-to-reorder is the primary path
(Step 9)"* (×2), *"Move between item groups — design TBD"*, *"Library browse
surface ships in impl-5"*.

### Mutation scope, per action

| action | tables mutated | scope | can affect another quote? |
|---|---|---|---|
| Edit specs (#1, #7) | `leaf_specs`, `leaves.product_type_id` | **Library / master data** | **YES — see falsification 1** |
| Remove from item group (#6) | `assembly_leaves` + `quote_leaves` (via `detachGroupedMembership`) | quote-local, group-local | no |
| Remove (#8) | `quote_leaves` | quote-local | no |
| drag-reorder (members, working) | `assembly_leaves.sort_order` | group-local | no |

`assertDraft` gates #6 and #8, so neither can touch an accepted or complete
quote.

### Falsification results

**1. "Edit specs cannot unexpectedly mutate other quote usages through shared
Library identity" — FALSIFIED for draft quotes. By design, but undisclosed.**

`leaf_specs` is keyed by `leaf_id` and carries **no `quote_id`** — the schema
comment says so explicitly: *"globally scoped library"*. Between pin events an
edit **UPDATEs the current row in place** (schema §leaf_specs). So editing specs
from inside one quote changes them for **every other draft quote using that
leaf, immediately**.

Sent and accepted quotes are protected: `quote_leaves.leaf_spec_version_id` pins
a specific historical `leaf_specs` row at send.

This is correct library semantics and must not be "fixed" by scoping specs to a
quote. The gap is disclosure: the row already renders the blast radius
(`+15 other uses`, `+23 other uses`) but the menu item next to it says only
"Edit specs", and an operator inside a quote may reasonably read that as
quote-local. **Product disposition, not a defect.**

**2. "Move up/down cannot escape the Item Group or alter economics" — not
applicable; there is no capability to test.** The equivalent *working* path is
drag-to-reorder → `reorderAssemblyLeaves`, which writes `assembly_leaves
.sort_order` only. Junction-scoped, no economics, cannot leave the group. The
two menu items duplicate a path that already works.

**3. "Move to another item group changes attribution only" — no capability
exists to falsify.** No writer anywhere in `src/app/actions/`. `assemblies.ts`
records the intent in a comment: *"Cross-ASY junction moves (reparenting) is a
separate workflow."* The menu item is an unimplemented design note rendered as a
command.

**4. "View library record is navigation/read only" — no capability exists.** No
handler. Its stated blocker — *"Library browse surface ships in impl-5"* — **has
since shipped**; the Library modal exists and is in daily use. The item is stale
rather than blocked.

**5. "Remove from item group detaches membership only" — HOLDS.**
`detachGroupedMembership` deletes the junction and the canonical `quote_leaves`
row. The library leaf is untouched, and `assembly_leaves.leaf_id` is
`ON DELETE RESTRICT`, so a cascade to the library is structurally impossible.
The menu's own caption already says *"library leaf stays"*.

**6. "Direct Remove removes from this quote only" — HOLDS.** Deletes one
`quote_leaves` row, guarded to that `quoteId`.

**7. Do Direct Products have a governed ordering capability? NO —** and the
refusal is deliberate. `direct-product-row.tsx`: *"No drag handle: ordering
among Direct Products is not an operator concern yet, and a handle that
reorders nothing would lie."* `position` is stored at attach (visible in the
attach audit rows) but nothing reorders it.

**8. Does View library record apply equally to Direct Products? It is absent
from both rows.** Neither row can reach the library record.

### The DA for action grammar — partially unrecoverable

`leaf-context-menu.tsx` cites *"docs/design-prototypes/dist/qw_a1v2.jsx
LeafContextMenu (lines 262-276)"* as canonical. **That file is not in the
repository**, and neither is `qw_styles.css`, the stated upstream for
`r-a1v2-setup.css`. `git log --diff-filter=D` shows no deletion, so they were
never committed. Rounds 8 and 9 do not cover this tree.

So the surviving DA is the canonical CSS alone — and it does establish the
grammar, from the grid definitions:

- `.a1v2-leaf-row` — `60px 110px 1fr auto auto auto`, six cells: leaf-icon,
  leaf-sku, name-cell, type-tag, **leaf-refs**, **context-trigger**. No inline
  action cells.
- `.a1v2-asy-row` — six cells likewise ending in `.context-trigger`.

**The DA grammar for both row types is overflow-only.** There is no canonical
inline action button anywhere in this tree. The Direct Product row's inline
`Edit specs` + `Remove` is therefore a nexus invention with no DA — which is
consistent, since Direct Products postdate the DA entirely. No later
disposition intentionally changed the grammar; the inline pair arrived with
§9.1 and was never measured against the DA.

### Recommended disposition — not applied

| action | recommendation | rationale |
|---|---|---|
| Edit specs (#1, #7) | **keep**; disclose library scope at the point of action | works, required; the shared-identity effect is real and currently unstated |
| Move up / Move down | **wire to `reorderAssemblyLeaves`** or remove | the writer exists and works; wiring is cheap and gives a keyboard path to a drag-only capability. Removal is equally defensible |
| Move to another item group | **remove** | no writer, design TBD; a command that has never existed |
| View library record | **wire to the Library modal** or remove | its blocker has shipped, so "remove" would be discarding a now-cheap capability — product call |
| Remove from item group (#6) | keep | works, guarded, covered |
| Remove (#8) | keep, **add coverage** | works and is destructive, with **zero automated evidence** |

**Coverage gap worth naming separately:** `updateLeafSpec` and
`detachQuoteProduct` have no unit coverage at all. One writes shared library
master data; the other is the only destructive action on a Direct Product.

---

## B-5 · The cascade banner states the pre-B-3 model, and is now false — **BLOCKER**

**Observed, not repaired.** Preview `4d052a8`, product `LEAF-GLW-30-PP`. No value
was edited; the walk baseline is untouched.

Both spec pages render this banner:

> ⚠ *30ml Glass Dropper Bottle · Type III soda-lime · matte black is used in 15
> ASYs across 7 scenarios. Editing specs affects referencing quotes per their
> state: **sent quotes stay pinned to v1; draft quotes auto-update to the new
> values.***

followed by 15 rows, each stamped **`DRAFT · WILL UPDATE`** or
**`SENT · STAYS PINNED`**.

**Every clause of that is now false.** After B-3 no existing quote is affected by
a Library-default edit, draft or sent, because each owns its authority. "Draft
quotes auto-update" describes precisely the defect B-3 removed.

**On the Library page it contradicts the page's own header**, which says *"Quotes
that already use this product keep their own specifications and are not
changed."* Two statements about one action, and **the false one is louder** — a
full-width amber banner with 13 rows saying WILL UPDATE, against one line of
body text.

**Why this is a blocker rather than stale copy.** It inverts the operator's
decision. Someone reading "13 draft quotes WILL UPDATE" will not edit the
Library default — the safe-looking choice is now the wrong one, and the isolation
B-3 built is unusable because nothing on screen says it exists. It also means an
operator who *does* edit will believe they changed 13 quotes and may go
"correcting" quotes that were never touched.

## B-6 · The quote page states no scope at all

The asymmetry runs the wrong way. The **Library** page names its scope well: an
eyebrow (`ALL DEALS · PRODUCT LIBRARY`), a distinct title (*Library defaults*),
and an explicit paragraph about future attachments.

The **quote** page has **no scope statement whatsoever**. Below the false banner
it is the product card and spec panel, with nothing saying these values belong
to this quote. The only cue is the left scenario rail showing Alt 4 — which is
navigation chrome, not a statement about what you are editing.

So on the authority boundary you asked me to watch: the Library side reads
clearly, the quote side reads as "editing the product", and the two pages are
otherwise near-identical below the header — same banner, same card, same panel.
An operator who arrives at the quote page from a row action has nothing telling
them this edit is theirs alone.

**Note this cuts against B-3's own vocabulary disposition:** *Library context:
`Edit default specs`; Quote context: `Edit product specs`.* The actions are
named correctly; the destinations are not.

## B-7 · `ASY` is operator-visible on both pages

- banner: *"used in 15 **ASYs** across 7 scenarios"*
- product card: *"Referenced by 15 **ASYs**"*
- row identifiers: `ASY-f88c22e3-1`, `ASY-180e6410-1`, `ASY-9de0a19d-1`

Same class as B-4 drift 6 and the same cause: the vocabulary sweep covered the
Setup tree's JSX and never reached this surface, and the row identifiers are
generated data rather than source strings, so the test asserting `ASY` is gone
cannot see them.

## What the walk still needs

The underlying isolation is proven by the 20/20 falsifications, but **none of
B-5/B-6/B-7 is visible to them** — every one is copy or presentation, which is
exactly the category automated evidence cannot reach. The operator-visible
authority boundary is NOT confirmed, and B-5 is severe enough that walking the
edit sequence would mean acting against on-screen instructions that say the
opposite of what will happen.

Recommend dispositioning B-5 before the value-editing half of the walk, so the
screen and the behaviour agree while you are judging them.

---

## B-3 · OPERATOR-PROVEN (2026-08-13)

Quote-spec / Library-default isolation validated on Preview `f921904`. The
authority model is closed: quote-owned specification from the moment of
attachment, Library defaults as template for future attachments only, neither
reachable from the other. **Not to be reopened on UX grounds.**

Standing evidence: `scripts/verify/b3-spec-authority.ts` 20/20 against the live
database; falsification 11 as a source grep in the unit suite; migration `0071`
with 141 quote-owned rows and 169/169 attachments pinned.

---

## B-8 · SKU tree visual density — DA trace and proposal

**Investigation only. Nothing changed.** Structure is not in scope: the Item
Group / member hierarchy reads correctly after B-4 and is not touched here.

### What the DA specifies for a member row

`.a1v2-leaf-row` — `grid-template-columns: 60px 110px 1fr auto auto auto`, six
cells. The implementation renders exactly six, so **there is no grid overflow
here** — this is not a repeat of B-4 drift 5.

| # | cell | DA register |
|---|---|---|
| 1 | `.leaf-icon` | mono 13px, `--ink-4` |
| 2 | `.leaf-sku` | mono 10.5px, `--ink-3` |
| 3 | `.leaf-name-cell .name` | **12.5px, weight 500, `--ink`** |
| | `.leaf-name-cell .meta` | mono 10px, `--ink-4` — qty · cost |
| 4 | `.type-tag.leaf-type` | mono 9.5px, `--accent-ink`, accent 0.08 fill, **1px accent 0.20 border** |
| 5 | `.leaf-refs` | mono 10px, **`--ink-4`** |
| 6 | `.context-trigger` (+ nexus: `.a1v2-chip`) | chip: mono 10px, uppercase, **soft-filled colour**, pill radius |

**Every one of the six signals is DA-native**, including the readiness chip —
`.a1v2-chip` with all four states (`complete` / `partial` / `empty` / `no_type`)
is in the canonical stylesheet. I initially suspected the chip was a nexus
addition competing with the DA; it is not. The only nexus liberty is that the
chip shares cell 6 with the context trigger rather than holding a column, which
is the same folding `.direct-actions` already uses and causes no wrap.

### So where does the density actually come from

Not from extra elements. **From three elements the DA gives competing emphasis
to at the same time**, in a row whose text is otherwise deliberately quiet:

- **type tag** — outlined *and* filled *and* accent-coloured. The only bordered
  element in the row.
- **readiness chip** — soft-filled colour, uppercase, pill.
- **name** — the largest text, and the only thing at full `--ink`.

Two coloured, enclosed shapes sit adjacent at the row's right edge, and only one
of them is actionable. `.leaf-refs` is already at the DA's quietest register
(mono 10px `--ink-4`, same as the qty·cost meta line), so it contributes little
weight — but it does consume a full grid column, which widens the right cluster
and pushes the name cell narrower on a 15-product quote.

### Minimal proposal — entirely within the DA, nothing invented

**1 · `Used in N other quotes` → the name cell's meta line.**
It is already in the *same* register as `qty · cost` (mono 10px `--ink-4`), so
appending it there costs no new weight and **frees grid column 5**, widening the
1fr identity column across every row. This demotes it substantially without
hiding it, and avoids putting a passive fact behind an interaction. If you want
it gone from the row entirely, the overflow menu is the alternative — but the
meta-line move gets most of the density benefit at none of the discoverability
cost.

**2 · Demote the type tag to the DA's OWN quiet register.**
The DA contains *two* type-tag treatments: the outlined accent one on leaf rows,
and a flat one on assembly rows — `.a1v2-asy-row .type-tag`: mono 9.5px,
`--ink-4`, `--paper-3` fill, **no border**. Applying the assembly register to
member rows is a move *within* the DA rather than an invention, and it leaves
the readiness chip as the row's only coloured, enclosed element.

**Keep `untyped` in the `--bad` register.** "No type set" is actionable, so it
belongs with the readiness signals rather than with the demoted informational
ones — which is the same reason the chip has a `no_type` state.

**3 · Readiness chip unchanged.** It becomes the primary row-level operational
signal by subtraction rather than by amplification — nothing is made louder.

**4 · Name, SKU, qty, cost unchanged.** Already the DA's hierarchy: name at
full ink and largest, SKU and meta demoted beneath it.

### Net effect

Per member row: six competing signals → **one coloured actionable chip**, one
quiet type tag, one identity block, and one overflow. Grid narrows 6 → 5
columns, so identity gets the reclaimed width on every row of a 15-product
quote.

**Not in scope and not touched:** Item Group / member structure, quote-spec
authority, Library-default authority, cost, pricing, projection. This is
row-level CSS and one JSX move.

---

## OW-5 · S-7 baseline refresh — ordering-only drift on Alt 5 (2026-08-13)

**Distinct from OW-2.** That was an attachment cause; this one moved nothing at
all. Characterised as **ordering-only baseline drift**, not identity and not
attachment.

Pre-refresh isolation, which is the evidence — the refreshed green baseline is
not:

- Alt 5 is the only changed basket member (basket 33)
- rollup cardinality unchanged at 21; the rollup SET is identical
- every retained rollup field-for-field identical when matched by `skuId`
- no quote-level governed value moved
- no cost, sell, freight, duty, tariff, margin or quantity moved anywhere
- the sole difference is ordering: six positional entries shifted while
  identity and content stayed put

Refresh delta: 33 → 33 entries, **1** changed digest, 0 new, 0 removed;
`08986108…` → `e60be671…`. Alt 5 was **not** modified to match the old baseline.

### Follow-up, recorded not solved

**S-7 compares rollups positionally, so a reorder reads as movement.** Here it
reported `skuRollups[2].canonicalQuoteLeafId` being replaced — which is the
cascade of a shift, not a value change, and it cost a full isolation pass to
establish that nothing had moved.

The preservation gate should eventually distinguish ordering from content and
identity movement explicitly: match rollups by `skuId` before comparing fields,
and report a pure permutation as its own outcome rather than as a replaced
identity. The isolation script already does exactly this in its retained-rollup
claim, so the technique is proven; it belongs in the gate.

Not in this slice.

---

## OW-6 · S-7 refresh — intentional structural content change on Alt 5 (2026-08-14)

**Distinct from OW-5 (ordering-only) and OW-2 (attachment).** This one really
did change the quote: it lost a product.

Pre-refresh evidence, which is the evidence — the refreshed baseline is not:

- Alt 5 the only changed basket member (33)
- rollup cardinality **21 → 20**; nothing added
- removed identity `4056fe80…`, which post-OD-017 is both `skuId` and
  `canonicalQuoteLeafId`
- product **LEAF-GLW-30-PP** — 30ml Glass Dropper Bottle · Type III soda-lime ·
  matte black — an **Item Group member** under assembly `9dc73ff2…`
  (`skuRole: leaf`, `indentDepth: 1`, `qtyPerParent: 1`)
- `quote_leaves` 0 rows, `assembly_leaves` 0 rows — membership gone
- **library leaf present and unarchived**, per the "library leaf stays" contract
- `assembly_leaf_detach` audited it against the `quote_leaf` identity,
  `edward.shin@gmail.com`, 2026-08-14 03:03:00
- retained rollups preserve their governed economics; no quote-level value moved

Refresh delta: 33 → 33 entries, **1** changed digest, 0 new, 0 removed;
`e60be671…` → `abd7a4cd…`. Nothing was reconstructed or restored.

### Correction to the prior record — there was NO audit defect

An earlier report said the reorder did not explain the removal and the quote's
audit trail was silent about it. **The trail was not silent.** That query
filtered on `diff_json->>'quote_id'` and `entity_id = quote_id`, but
`assembly_leaf_detach` keys on the **`quote_leaf`**, exactly as the audit
namespace in CLAUDE.md specifies. The evidence existed and the instrument could
not express it.

Retrieval scoped to the removed rollup's OWN identities found it immediately.
Same class of error as the grep that could not match numeric differences and the
`catch` that reported "missing" for a read failure: **a measurement taken with an
instrument incapable of representing the thing it was screening for**, and the
third time this session that a filter's silence was nearly read as a finding.

### Alt 5 retired

Two S-7 incidents in two days from routine walk activity. Alt 5 is withdrawn
from Product Library operator mutation. **Every remaining walk quote must be
proven outside the basket before it is mutated** — the basket is
structure-bearing quotes (≥1 `assembly_leaves` row) minus the
`ZZ-VALIDATION-` namespace, so the proof is one query, not an assumption.

---

## OW-7 · Release-process finding — source-backed schema additions ship unpopulated

**Recorded, not solved. Applies to future work, not this release.**

Migration `0070` added `leaves.hubspot_product_type` as a nullable column. Nothing
in the deploy path could fill it, because no deploy step reads HubSpot — and
`getProductsClient()` resolves by `NODE_ENV`, so only a production runtime can
even reach the live portal. The result was a feature whose code was correct and
whose catalogue was **99.4% unclassified** (7 of 1,066 linked leaves) until an
operator discovered a Refresh button.

**The gap is a class, not an instance:** any schema addition backed by an
external source ships empty unless someone separately populates it, and nothing
in the merge gate notices, because every automated check passes on an empty
column.

**For future source-backed additions:** the slice that adds the column owns the
initial population as an explicit, named step — a one-shot post-deploy job
invoking the SAME governed sync path, idempotent, emitting the same audit rows.
It cannot live inside `drizzle-kit migrate`: it needs network egress and a
provider token at deploy time. Manual Refresh then remains what it should be —
ongoing synchronization, never initialization.

**This release:** the completed production pull IS the governed initial
population. 1,037 processed, 5 added, 1,032 updated, typed 7 → 1,039. No
synchronization is being added to normal deployments.

---

## OW-8 · S-7 refresh — three Direct Products added during review (2026-08-14)

Intentional structural content change on the M1–M4 reference quote `2f29af72`.
Pre-refresh isolation is the evidence; the refreshed baseline is not.

- only the reference quote changed (basket 33)
- three Direct Products added: `201299d8…`, `fd4adddd…`, `5d364814…`
- all pre-existing rollups identical, matched by `skuId`
- no quote-level governed value moved
- no cost / sell / freight / duty / tariff / margin / quantity moved anywhere

Delta: 33 → 33, **1** changed digest, 0 new, 0 removed; `abd7a4cd…` →
`22264ba2…`.

**The isolation reported 4/5 and that is not a defect.** Its claim 4 asserts
*two* added rollups matching two attach events — OW-2's shape. This incident has
three, so the claim could not hold and it refused to clear the delta. Failing
closed on a claim that does not apply is the behaviour that check is for, and it
is preserved rather than loosened.

**`2f29af72` is retired from operator/visual mutation.** It is M1–M4
certification evidence and has now been modified twice during review. Future
mutation uses a non-basket, non-certification quote.

## OW-9 · Data governance — Nexus Product Type is sparse by design

**Logged, not solved. Do not close by mapping taxonomies.**

- HubSpot source classification is now broadly populated: **1,039** of 1,066
  linked leaves carry `hubspot_product_type`.
- Nexus `leaves.product_type_id` is null on **~1,051 of 1,077** leaves. It has
  only ever been operator-authored through the TypePicker, and the HubSpot pull
  deliberately does not map one taxonomy into the other.
- B-3 attach-time instantiation copies that null forward correctly, so
  quote-owned authority inherits the absence rather than inventing a value.

So `NO TYPE SET` on those rows is **true**, and the Setup tree is reporting the
data accurately. The gap is that Nexus typing was never populated at catalogue
scale.

**Do not resolve this by mapping `hs_product_type` into `product_type_id`.** The
two vocabularies do not correspond — HubSpot has 15 commercial/service
categories, Nexus has 8 leaf-scope structural ones, and eleven HubSpot values
have no leaf-scope home. Product Type determines the SPEC SCHEMA; a wrong
mapping silently validates spec values against the wrong field set.

This needs its own typing/backfill disposition grounded in Nexus taxonomy rules
— which is a product decision about what the firm's leaf taxonomy means, not a
display fix and not a warning to be suppressed.

## B-16 · Pricing grid does not locate the compliance condition (2026-08-14)

**Status:** LOGGED for the consolidated Pricing/presentation closeout. Not a
standalone patch.

Next Move correctly identifies below-target and below-floor conditions, but the
pricing grid does not show WHERE. The operator reads a verdict and then scans
individual percentages to find the cells it refers to — the surface states the
conclusion without locating the evidence.

**Treatment.**

| Condition | State |
|---|---|
| at/above target | normal / positive |
| below target, at/above floor | amber warning |
| below floor | red, correction required |

Applied to the affected CELL sufficiently to make the grid scannable — not to
the percentage text alone, which is what makes it a scan rather than a read.
Restrained, and within the existing Nexus warning/error vocabulary.

Operator example: target 35%, floor 25% → 33.2 / 33.9 / 34.1 amber; any cell
below 25% red.

**Constraints — these are the part that can go wrong quietly.**

- Derive the visual state from the SAME governed target/floor classification
  that drives Next Move. Do not recompute margin policy in the component.
- No new business logic.
- Selected-cell treatment must COEXIST with compliance state, not hide it. A
  selection that masks a red cell removes the signal at the exact moment the
  operator is acting on it.

**Pattern 50 applies and should be read before implementing.** The classifier is
per-CELL (worst SKU × tier); the suggestion engine is per-TIER (revenue-weighted
blend). They can legitimately disagree, and `suggestion_manual_only` exists to
name that intersection. A grid tinted from one basis while the banner speaks
from the other will look like a defect in whichever one the operator checks
second. Confirm which basis the cell treatment reads from, and say so in the
implementation.

## B-17 · Dark-mode structural contrast (2026-08-14)

**Status:** LOGGED for the consolidated presentation slice. Not a standalone
deploy.

In dark mode, table/card boundaries and row separators sit too close in
luminance to the near-black background. Content is readable; STRUCTURE is not —
the operator cannot perceive where one division ends and the next begins.

Observed on Setup: SKU table outer boundary; SKU row separators; Item
Group/member divisions; Tier table outer boundary; Tier row separators;
adjacent card boundaries.

**Treatment.**

- Raise neutral-gray contrast of structural borders and dividers slightly.
- Outer/container borders stay somewhat stronger than internal row separators —
  the hierarchy between the two is itself the signal.
- Preserve the current near-black surfaces.
- No accent colors for ordinary structural separation.
- Do not make dark mode materially brighter.

**Investigate first, then fix at the level the finding actually lives at.**
Establish whether these surfaces share dark-mode border/divider tokens. If they
do, the fix is the token, not Setup — and the follow-up is a visual check of
representative surfaces for unintended OVER-contrast, since a token change
reaches surfaces this finding never looked at. Patching Setup individually would
leave the same defect everywhere else while appearing resolved.

Goal: make structure easier to SCAN. Not make borders prominent.

## OW-10 · Intentional structural membership change on `2f29af72` (2026-08-14)

**Disposition A applied.** Baseline refreshed
`8d4ab825…88577763` → `84890653…6150a6df`. 33 quotes, 0 failed.

### Recorded rationale — OW-10, intentional structural membership change

- per-SKU attribution moved with membership;
- 11 per-SKU / per-tier paths changed;
- quote-level economics did not move;
- `blendedMarginPct` identical at full precision;
- `quoteRollup` / `quoteSummary` / `tiers` unchanged;
- identity set unchanged;
- no product created or destroyed.

**That is valid Pattern 58 behaviour, not a commercial regression.**

### What the verifier said, and why it was not enough

S-7 reported ONE differing field:
`skuRollups[1].canonicalQuoteLeafId: null -> "fd4adddd"`. Read alone that says
"an identity binding moved", and the first characterization of this delta —
"no commercial number moved" — was taken from it. That reading was imprecise.
The verifier surfaces a located difference, not an exhaustive one.

### What a full characterization showed

`scripts/gate-1b/confirm-s7-delta.ts` compares every numeric leaf as an
ORDER-INDEPENDENT MULTISET, because a pure reorder permutes values without
changing any, and an index-walking comparison cannot tell those two apart.

- Only `2f29af72` changed, of 33.
- No product added or removed; the identity SET is unchanged (8 before, 8 after).
- **Quote-level commercial values are IDENTICAL** — `blendedMarginPct` matches to
  full precision on all three tiers; `quoteRollup`, `quoteSummary` and `tiers`
  produced no differing path at all.
- **Eleven per-SKU per-tier paths DID move**, including `factoryCostPerUnit`,
  `computedSellPerUnit` and `revenue`.

So per-SKU attribution changed while quote-level arithmetic did not. The
`factoryCostPerUnit` multiset makes it explicit:

```
before  … 2.0150  3.1400  4.0000  5.0000 …   sum 45.710000
after   … 2.0000  3.0000  4.1400  5.0150 …   sum 45.710000
```

`0.0150` and `0.1400` each moved from one product to another. Nothing was
created or destroyed.

### Why this is the invariant holding, not breaking

This is Pattern 58 — *membership determines attribution, never arithmetic* —
observed on live data. The operator moved products between structural homes, so
their component costs moved with them. Attribution followed membership; the sum,
the blended margin and every quote-level figure were invariant. A structural
move that did NOT reattribute would be the defect.

### Consequences recorded

1. **`2f29af72` is retired from ALL further writes.** Mutable drag testing uses
   `ZZ-VALIDATION-drag-drop` / `ff90d502-28a1-4a11-bbd5-75e1b5b916e8`, or another
   proven non-basket fixture.
2. **Later harness improvement — logged, NOT to be actioned now.**
   - the S-7 `skuRollups` comparison is position-sensitive;
   - a legitimate reorder can move the digest with no value change;
   - the future improvement keys the comparison by canonical quote-leaf identity
     rather than by array position;
   - **do not redesign it now.** Reordering only became a legitimate operator
     action with #265, so this is a consequence of the new capability rather
     than a latent defect, and changing the instrument during a closeout it is
     currently gating would leave nothing trustworthy to gate with.
3. `confirm-s7-delta.ts` is kept. The next time a digest moves, the first
   question is again "what KIND of movement", and the multiset comparison is the
   instrument that answers it.

## OW-11 · Second authorized S-7 refresh, and the permanent test-surface move (2026-08-14)

**Refreshed** `84890653…6150a6df` → `4361217b…59f3bdcd`. 33 quotes, 0 failed.

**Recorded reason:** OW-10 — additional operator structural movement on retired
basket quote; quote-level economics preserved; attribution followed membership.

Characterized with `confirm-s7-delta.ts` before refreshing, not after:

- only `2f29af72` changed, of 33;
- identity set unchanged, 8 → 8; no product created or destroyed;
- `quoteRollup` / `quoteSummary` / `tiers` produced no differing path;
- quote-level economics held;
- ten per-SKU / per-tier paths moved — attribution following membership;
- Pattern 58 intact.

Note the delta differed from OW-10's in composition: `factoryCostPerUnit` did
NOT move this time, while the sell-side paths and `cost` did. Same class, not
the same numbers — which is why each refresh is characterized rather than
pattern-matched to the previous one.

### Hard testing boundary — in force from this refresh

**`2f29af72` is off-limits for ALL mutation.** No drag/drop, no Pricing/GPA, no
Setup changes, no product add/remove, no write of any kind. Its one remaining
permitted use is the **#266 read-only Client Send presentation check**.

**All #265 drag/drop testing uses the validation fixture:**
`ZZ-VALIDATION-drag-drop` / `ff90d502-28a1-4a11-bbd5-75e1b5b916e8`.

### Why this boundary is now load-bearing rather than advisory

While the walk ran on a basket quote, each successful drag re-reddened S-7 and
re-blocked the Preview the walk depends on. The loop was self-blocking: testing
the feature destroyed the artifact needed to keep testing it.

**S-7 is NOT to be refreshed again for drag testing.** Any subsequent S-7
movement on `2f29af72` is an UNEXPECTED WRITE and is investigated as one — the
operator test surface has moved permanently to the fixture, so a change there
no longer has an authorized explanation waiting for it.

That distinction is the whole reason to write this down. Two refreshes in one
afternoon, each individually justified, is exactly how a gate stops meaning
anything: the third one arrives already framed as routine. The boundary is what
keeps the next movement diagnostic instead of administrative.
