# CD designer notes — Library modal UX redesign

**Surface:** `LibraryBrowseModal` → redesigned as the canonical "+ Add component" entry point
**Prototype:** `Nexus_Library_Modal.html` · sources at `app/library_modal/`
**Date:** 2026-06-15
**Status:** Prototype ship — for CA review per Pattern 30

---

## 1 · The core decision: table-rows, not cards

The current modal renders leaf rows as cards with free-flowing internal layout. At ~30 items that's tolerable; at the eventual ~990-item HubSpot catalog it collapses — every row a different height, chips and buttons floating to different vertical positions, nothing scannable.

**Redesign: fixed-height table rows (56px) with columnar grid discipline.** Five columns, same grid on the header and every row:

```
[rail 4px] [Component (name + sub)] [Type 150px] [Status 120px] [Action 96px]
```

Every cell aligns to its column on every row. Names that would wrap are truncated with ellipsis (full name on hover / in detail). This is the root fix for issues 1, 2, and 9 simultaneously — the action button can't clip off the edge because it lives in a bounded 96px column; vertical float is gone because row height is fixed; readiness state has a dedicated rail + status column.

This resolves the banked Q1 in favor of table-rows.

---

## 2 · Information hierarchy per row

Three tiers, deliberately weighted:

- **Primary** — component name (display face, ink) + the Attach action. This is the attach decision: *what is it, can I add it.*
- **Secondary** — source badge (Nexus / HubSpot), SKU, type, readiness status. Identity + filterable facets.
- **Tertiary** — usage caption ("12 ASYs · 5 scenarios"). Demoted per issue 7: muted, opacity-dropped, tucked at the end of the SKU sub-line. Present for forensic continuity with prior rounds (the data PMs learned to expect), but visually it recedes — it does not compete with the attach decision.

The usage caption resolution (issue 7): **kept inline but demoted to tertiary**, not dropped and not hidden behind hover. Dropping it loses forensic value PMs rely on; hover-only makes it undiscoverable. Muted-inline keeps it glanceable without it shouting.

---

## 3 · ATTACH TARGET — persistent prominent bar

Issues 3 + 4 are the same root problem: the target picker read as instructional placeholder text, and row buttons re-prompted "Pick target ASY" as if no target were chosen.

**Redesign: a persistent, prominent attach-target bar** directly under the header. It always shows the selected ASY as a real, bordered, accent-ringed control — name in display face, `ASY-id · N components` beneath. It reads unmistakably as an active control, not a hint.

Because the target is always visible and always set, **row buttons just say "Attach"** — no per-row re-prompt. The target lives in one place; the rows act on it. This is the disposition for issues 3 and 4 and the banked attach-target question (prominent over contextual).

---

## 4 · Two empty shapes, deliberately different

The functional split (filtered-to-zero vs library-empty) shipped in library-first Step 2. Their visual treatments diverge by *what the forward path is*:

**Filtered-to-zero** (`②`) — the library HAS components; this query just missed.
- Glyph: ∅ (null set — "no match," not "nothing exists")
- Copy names the query back to the PM ("Nothing matches `biodegradable mycelium clamshell`")
- Two CTAs: **Create new product** (primary) + **Clear search** (secondary escape)
- Refresh is *absent* here — refreshing won't help a bad query; offering it would mislead

**Library-empty / first-touch** (`③`) — the library has nothing yet.
- Glyph: ⊹ (a seed/spark — "start here," generative)
- Copy frames a fresh start, not a failed search
- Two CTAs of **equal weight**: **Create new product** + **Refresh from HubSpot** — both are legitimate first moves (build one, or pull the existing catalog)
- This is **the one place Refresh is promoted to primary.** Everywhere else it's forensic.

---

## 5 · Refresh from HubSpot — subtle by default

Banked Q2 resolved: **subtle.** The catalog is usually fresh; refresh is a forensic recovery action, not a daily workflow step. It lives as a quiet bordered control in the header (not filled, not accent). It promotes to a primary CTA only in the library-empty state (§4), where pulling the catalog is a genuine first move.

---

## 6 · Inline pull-progress band

When a refresh is running (`④`), an inline band appears **between the header and the attach-target bar** — a deliberate slot that does not displace the filter row or shift row alignment. The band carries:
- A spinner + "Refreshing catalog from HubSpot… existing components stay usable" (the reassurance matters — the PM shouldn't think the modal is frozen)
- A progress track
- A live count delta (`642 / 990 · 65%`)

Rows below stay fully interactive during the pull. The band's position above the attach bar means the filter row and table never reflow when it appears/disappears — they sit below a region that simply grows/shrinks at the top.

---

## 7 · Row readiness — rail + tint (both)

Issue 9. Three states, distinguished by **both** a left status rail and a row tint (per the answered question), plus an explicit status pill:

| Readiness | Rail | Tint | Pill | Action |
|-----------|------|------|------|--------|
| ready     | none | none | grey "ready" | **Attach** (accent) |
| attached  | green | faint green | green "attached" | "✓ Attached" (no button — already done) |
| archived  | grey-ink | faint grey | muted "archived" | "Restore" (ghost) |

Rail + tint together means state is legible both at the row's edge (rail, good for vertical scanning) and across its body (tint, good when scanning a single row). The pill spells it out for certainty. Attached rows drop the button entirely — there's no action to re-take.

---

## 8 · Copy + defaults

- **Modal title:** "Library · components" — confirms CA lean. "Leaves" was internal jargon (issue 5); "components" is the PM-facing word and matches the "+ Add component" entry trigger.
- **Default Type filter:** "All types" — confirms CA lean (banked Q3). Modal opens showing everything; the PM narrows if they want. No pre-narrow hiding components on open (issue 6).
- **Filter chrome:** collapsed from three control rows to **one** (issue 8) — search + a segmented Type control + a live result count. The scenario filter from the old modal is dropped from the primary row; it was forensic and added chrome weight. (If CC needs it, it belongs in an overflow/advanced affordance, not the default row.)

---

## 9 · Permission gating

When `!canCreateLeaves`, the "+ Create new product" and "↗ Refresh from HubSpot" affordances render **disabled** (reduced opacity, not-allowed cursor) with the tooltip "You don't have permission to create new products. Ask an admin." In the empty states, a permission note renders beneath the CTAs so the dead-end is explained rather than just visually inert. Browse + Attach remain fully available — permission gates creation, not consumption.

---

## 10 · Considered + rejected

- **Hover-only usage caption.** Rejected — undiscoverable. Tertiary-inline keeps it glanceable. (§2)
- **Dropping the usage caption entirely.** Rejected — loses forensic value PMs learned to rely on across rounds. (§2)
- **Contextual (subtle) attach-target.** Rejected — the whole problem was the target reading as a hint. Subtle would re-create issue 4. (§3)
- **Card layout with tighter grid.** Rejected — even disciplined cards waste vertical space at 990 items; table-rows scan faster. (§1)
- **Refresh as a heavy primary affordance.** Rejected outside library-empty — it's forensic, and a loud refresh button competes with search/attach for attention. (§5)
- **Scenario filter in the default filter row.** Rejected — chrome weight for a forensic facet. (§8)

---

## 11 · Open for CA

- Result count reads "16 of 990" — at full catalog, do we want virtualized infinite scroll, pagination, or a "load more"? Out of scope for this visual pass, but the row height is fixed precisely so virtualization is trivial later.
- Archived-but-visible rows currently show "Restore." Confirm that's the right verb (vs "Reactivate" / "Unarchive") — copy call, not layout.
- The attach-target bar shows one target at a time. If multi-target attach ever lands (attach one component to several ASYs at once), the bar needs a multi-select treatment — flagging now, out of scope.
