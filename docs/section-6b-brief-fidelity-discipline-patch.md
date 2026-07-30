# Insert into `docs/section-6b-brief.md` after the Companion docs block, before §1 Scope:

---

## §0 · Fidelity Discipline (read before every step)

This brief is a **scope contract**, not a fidelity contract. It specifies WHAT each step implements (column count, drawer behavior, schema commitments) and WHEN (sequencing, dependencies). It does NOT specify visual treatment in implementable detail.

**Visual fidelity lives in:**
- `docs/r7b-designer-notes.md` — canonical visual treatment per primitive (accent borders, chips, subtitles, audience labels, typography, color tokens, layout grammar)
- `Nexus Round 7b.html` — visual reference prototype (4 states: All collapsed · Assembly drawer open · Leaf drawer open · Empty tiers / preset picker)

**Before implementing each step, CC MUST:**

1. Read the brief §X.Y section for the primitive — gets scope, mutability, schema sources
2. Read R7b designer notes section for the corresponding primitive — gets visual treatment, polish layer, audience labels, color/typography decisions
3. Inspect the R7b prototype HTML — gets layout grammar, spacing, side-by-side vs stacked decisions, exact visual states

**Implement BOTH structural primitive AND polish layer.** Structural primitive without polish = visually flat regression from R7b. R7b's value lives in the polish.

**Per-commit fidelity manifest (Pattern 26 + 27 — required in every step commit message):**

```
Step N — [name]

STRUCTURAL MATCHED:
- [primitives implemented this step, e.g., "two-textarea zones"]

POLISH MATCHED (against R7b designer notes §X.Y + prototype):
- [accent borders, chips, subtitles, audience labels, color tokens, typography, layout]
- e.g., "purple --internal left-accent border on Internal card"
- e.g., "INTERNAL chip (purple-soft) top-right of Internal card"
- e.g., "subtitle 'PM-ONLY · NEVER CUSTOMER-VISIBLE' below card title"
- e.g., "audience footer with verbatim copy from R7b designer notes §3.6"
- e.g., "side-by-side layout (not stacked)"

DEFERRED:
- [elements → target step, e.g., "drag-drop handler → Step 10 (column exists now)"]

NOT IN PLAN (flag for carve/amendment):
- [elements neither matched nor explicitly deferred]
```

If POLISH MATCHED section is empty for a step that has polish in R7b, the step is incomplete regardless of structural correctness.

**Pattern 28 (CLAUDE.md):** Briefs are scope contracts; design docs are fidelity contracts. Codified in every brief's opening section to survive context compaction.

**Failure mode this prevents:**

The Notes split shipped at Step 8 (initial) as two stacked textareas with plain labels — structurally correct per brief §3.6, but missing R7b's polish entirely (no purple/green accent borders, no INTERNAL/CUSTOMER chips, no semantic subtitles, no audience footers, stacked instead of side-by-side). R7b designer notes §3.6 specified all of these; CC implemented from brief summary, not designer notes. This section makes the discipline explicit so the failure doesn't repeat across remaining steps.

**Retroactive application:**

For §6.b in flight: every remaining step (Step 1 amendment + Steps 2-11) reads R7b designer notes + prototype HTML per primitive. Notes amendment commit needed before run-through proceeds, with polish layer fully implemented per R7b §3.6.

**Standing protocol going forward:**

Every future slice brief (R7c, §6.c carved component editing, Slice 9, Slice 11, Slice 12, etc.) includes this §0 Fidelity Discipline section at the top. CA writing briefs must enforce this. CC reading briefs must look for this section and follow the discipline.

---
