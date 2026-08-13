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

## OW-2 · (reserved)

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
