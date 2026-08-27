# Master-spec inheritance walk — Training Finding #2 close

**All five boundaries PASS.** Executed on Production `7eb3d3c` after `#466`
merged. Database values captured before and after at every boundary; nothing
below is read off the page.

**Training Finding #2 closes as an AUTHORIZATION defect. The inheritance
architecture is certified intact and was never at fault.**

| | |
|---|---|
| leaf | `92b7f1f2` · ZZ-VALIDATION Spec Inheritance Walk Bottle · SKU `ZZ-SPEC-WALK-001` · HubSpot product `47334711189` |
| Quote A | `d84212e0` · ZZ-SPEC-WALK-QUOTE-A |
| Quote B | `168b023f` · ZZ-SPEC-WALK-QUOTE-B |
| project | `4e511bfa` (Soak Lineage VIII — spent lineage, no W9 involved) |

## Step 0 · the leaf, created through the ordinary operator path

This also falsifies `#465` end to end, which had only been verified as far as
the control being enabled:

```
Add Product → search "Spec Inheritance Walk" → 0 OF 1,089 MATCH
            → + Create new product (enabled) → Add leaf · specs empty
            → leaf 92b7f1f2 created, HubSpot product 47334711189
```

Baseline captured immediately after: `specs: []`, `attachments: []`. No master,
no quote rows — so every row below was created during the walk.

## Step 1 · author the master

`Product Library → ✎ Edit default specs`. The editor states its own contract:
*"Default specifications — Used as the starting point for future quotes.
Existing quotes are not changed."*

```
AFTER   quote_id       null
        is_current     true
        version_number 1
        spec_values    { pp_size: MASTER-SIZE-30ml,
                         pp_material: MASTER-MATERIAL-glass }
```

**PASS** — `quote_id IS NULL AND is_current = true`, created by the first edit
rather than requiring a row to pre-exist.

## Step 2 · attach to Quote A

```
master  a29fc06b  quote_id null   { pp_size: MASTER-SIZE-30ml, pp_material: MASTER-MATERIAL-glass }
QUOTE A 42d83024  quote_id d84212e0  is_current false
                  { pp_size: MASTER-SIZE-30ml, pp_material: MASTER-MATERIAL-glass }
attachment  quote_leaves 42d433a0 → leaf_spec_version_id 42d83024
```

**PASS** — Quote A got its own row carrying the master's values, and the pin on
`quote_leaves` points at that row rather than at the master. Setup rendered the
inherited values too.

## Step 3 · change Quote A; the master must not move

```
BEFORE  master   pp_size MASTER-SIZE-30ml
        QUOTE A  pp_size MASTER-SIZE-30ml

AFTER   master   pp_size MASTER-SIZE-30ml          UNCHANGED
        QUOTE A  pp_size QUOTE-A-OVERRIDE-50ml     diverged
```

**PASS** — the quote-local edit diverged without mutating the master.

## Step 4 · attach to Quote B

```
QUOTE B a3a4c8a0  quote_id 168b023f  is_current false
                  { pp_size: MASTER-SIZE-30ml, pp_material: MASTER-MATERIAL-glass }
```

**PASS** — B inherited the **master**, not Quote A's `QUOTE-A-OVERRIDE-50ml`.
The two quotes are independent copies of one template, not a chain.

## Step 5 · edit the master again; both quotes must hold

```
AFTER   master   { pp_size: MASTER-SIZE-SECOND-EDIT-100ml,
                   pp_material: MASTER-MATERIAL-SECOND-EDIT-PET }
        QUOTE A  { pp_size: QUOTE-A-OVERRIDE-50ml,
                   pp_material: MASTER-MATERIAL-glass }        UNCHANGED
        QUOTE B  { pp_size: MASTER-SIZE-30ml,
                   pp_material: MASTER-MATERIAL-glass }        UNCHANGED
```

**PASS**, and Quote B is the sharper half of it: B still holds the master's
values *as they were at attachment*, so the later master edit reached neither
quote. That is copy-at-attachment demonstrated rather than asserted — a
reference would have dragged B forward.

No backfill was performed. The 188 pre-existing empty quote-owned rows are
untouched.

---

## What this walk does NOT prove

**It does not prove the authorization repair**, and it would be easy to read it
as if it did.

The walk was driven as `edward@thedps.co` — `role=admin`, `can_edit_specs=false`.
`assertCanEditSpecs` passed admins through on role alone, so **this operator
could always have authored a master.** What the walk establishes is that the
write path, the scope targeting and the inheritance semantics are correct; the
change in *who* may reach them is established by the code branch and its unit
tests, not by this session.

Proving the authorization half end to end needs a non-admin session, which is
not available to me. The claim is therefore split deliberately:

- **certified by this walk** — inheritance architecture, master row shape,
  copy-at-attachment, non-propagation of later master edits
- **certified by code + tests** — library scope now calls `ensureUser()`, quote
  scope keeps `assertCanEditSpecs` and its draft guard, and
  `assertCanEditSpecs` still has exactly one call site

## Artifacts left in place

`ZZ-VALIDATION Spec Inheritance Walk Bottle` remains in the Product Library and
in HubSpot as product `47334711189`, with two scenarios `ZZ-SPEC-WALK-QUOTE-A`
and `-QUOTE-B` on project `4e511bfa`. Named to the existing ZZ-VALIDATION
convention and left rather than deleted, so the evidence above stays
re-checkable. Deleting them is a one-line cleanup whenever that stops being
useful.
