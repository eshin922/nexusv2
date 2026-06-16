# CD data-source map — Library modal redesign

Same shape as `r6-data-source-map.md` and prior rounds. For each visible element, where the data comes from — so CC wires the prototype to existing server state without guessing.

Legend: `schema:` = existing DB field · `derived:` = computed at render · `client:` = client-side UI state · `server-op:` = triggers a server operation · `perm:` = permission flag.

---

## Header

| Element | Source | Notes |
|---|---|---|
| Title "Library · components" | static | copy change from "reusable leaves" |
| Subtitle `{client} · {qid}` | `schema: quote.client_name`, `quote.id` | current quote context (modal is opened from within a quote) |
| Refresh from HubSpot button | `server-op: POST /library/refresh` + `perm: canCreateLeaves` | disabled when `!canCreateLeaves` or a pull is already running |
| Close (✕) | `client:` | dismiss modal |

---

## Pull-progress band (when a refresh is running)

| Element | Source | Notes |
|---|---|---|
| Band visibility | `client: pullState != null` | driven by the refresh op's lifecycle |
| "Refreshing catalog from HubSpot…" | static | reassurance copy |
| Progress track fill % | `derived: pull.done / pull.total` | from refresh-op progress stream (SSE/poll) |
| Count `done / total · pct` | `server-op: refresh progress` | `done` + `total` reported by the pull operation |

**Integration note:** the band occupies a fixed slot between header and attach-target bar. It must not be rendered inside the filter row or the results region — placing it above the attach bar guarantees the filter row and table never reflow when it mounts/unmounts.

---

## Attach-target bar

| Element | Source | Notes |
|---|---|---|
| Selected ASY name | `schema: assembly.name` | the attach destination |
| `ASY-id · N components` | `schema: assembly.id`, `count(assembly.leaves)` | |
| Target picker menu items | `schema: quote.assemblies[]` | all ASYs in the current quote |
| Selected target | `client:` | defaults to the ASY the PM launched "+ Add component" from; persists in modal state |

**Behavior note:** the selected target is the implicit object of every row's Attach action. Row buttons do NOT carry the target — the bar is the single source of the attach destination.

---

## Filter row

| Element | Source | Notes |
|---|---|---|
| Search input | `client:` → `server-op: GET /library?q=` | search by name, SKU, or factory |
| Type segmented control | `client: typeFilter` | options from `LIBM.types`; default `all` (no pre-narrow) |
| Result count "N of 990" | `derived: filtered.length`, `schema: count(library)` | total reflects full catalog size after pull |

---

## Result row (per component / leaf)

| Element | Source | Notes |
|---|---|---|
| Status rail (color) | `derived: leaf.readiness` | ready / attached / archived |
| Row tint | `derived: leaf.readiness` | paired with rail |
| Icon | static | component glyph |
| Name | `schema: leaf.name` | primary; ellipsis-truncated, full on hover |
| Source badge (Nexus / HubSpot) | `schema: leaf.source` | provenance |
| SKU | `schema: leaf.sku` | secondary |
| Usage caption "N ASYs · M scenarios" | `derived: count(leaf.references by asy)`, `count(... by scenario)` | **tertiary, muted** — same computation as prior rounds' reference rollup |
| Type label | `schema: leaf.product_type_id` → `product_types[].name` | |
| Status pill | `derived: leaf.readiness` | ready / attached / archived |
| Attach button | `server-op: POST /assembly/{target}/attach {leaf}` | shown when readiness === "ready" |
| "✓ Attached" mark | `derived: leaf attached to current target` | replaces button when already attached |
| Restore button | `server-op: PATCH /library/{leaf} {archived:false}` + `perm: canCreateLeaves` | shown when readiness === "archived" |

**Readiness derivation:**
- `attached` — leaf is already in the **currently-selected target ASY** (re-evaluate when target changes)
- `archived` — `schema: leaf.archived === true` (firm chose to keep visible)
- `ready` — everything else

---

## Footer

| Element | Source | Notes |
|---|---|---|
| "N already attached · M shown" | `derived: count(attached in target)`, `filtered.length` | |
| + Create new product | `client:` stacks AddProductModal + `perm: canCreateLeaves` | uses existing `r-a1v2-modal-stacked` z-index handling |
| Done | `client:` | dismiss modal |

---

## Empty states

| Element | Source | Notes |
|---|---|---|
| Filtered-to-zero vs library-empty | `derived: library.length === 0 ? empty : (filtered.length === 0 ? zero : list)` | functional split shipped library-first Step 2 |
| Zero-state query echo | `client: searchQuery` | names the query back to the PM |
| Empty-state CTAs | `server-op` + `perm: canCreateLeaves` | Create disabled + tooltip when no permission; Refresh promoted to primary only in library-empty |
| Permission note | `perm: !canCreateLeaves` | explains the disabled CTAs |

---

## Net-new vs existing

**No new schema.** Every field traces to existing library/assembly/quote state. New *derivations*:
- `leaf.readiness` (ready/attached/archived) — computed from existing `archived` flag + current-target membership
- per-target "attached" evaluation — re-derived when the attach-target bar selection changes

**New client state:** selected attach-target (modal-local), type filter, search query, pull-progress lifecycle.

**Pattern 27 manifest (nexus extensions beyond canonical baseline):**
- `lib-*` class namespace (clean, no synthetic prefix) for all modal-interior chrome
- reuses canonical `.a1v2-modal-backdrop` / `.a1v2-modal` frame verbatim
- reuses `.a1v2-toast` for attach confirmations (not redesigned)
- relies on `r-a1v2-modal-stacked` for the AddProductModal-on-top case (not re-solved here)
