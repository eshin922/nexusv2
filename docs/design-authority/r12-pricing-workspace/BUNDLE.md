# Bundle: `r12-pricing-workspace`

**Authority scope:** Phase 3 — Pricing Workspace · Phase 4 — approval state model
**Selected variant:** **R12** (`app/r12/pricing-page.jsx`). R10 and R11 are lineage, not alternatives — see below
**Precedence:** Tier 3 (design bundle) — see
[`../../NEXUS_IMPLEMENTATION_STANDARD.md` §2](../../NEXUS_IMPLEMENTATION_STANDARD.md)
**Status:** Governing. **Implementation not started.** Phase 3 is blocked on Phase 2 operator acceptance

| | |
|---|---|
| Intake archive | `../_intake/r12-pricing-workspace.zip` |
| Original filename as received | `Extract file as project (7).zip` |
| Tracked in repository | 2026-08-04 |
| Superseded by | *(nothing)* |

---

## Why this bundle is registered before its phase begins

Phase 3 has not started and will not start until Phase 2 reaches operator
acceptance. The bundle is tracked now for two reasons.

First, it was at the same risk as `freight-1a` — untracked ZIP plus an
extraction inside gitignored `.artifacts/`.

Second, and more specifically: `docs/approval-states-design-position.md` inside
this bundle is cited **by name** as Phase 4's governing authority in
[`../../../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../../../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md).
Until 2026-08-04 that citation resolved only into a disposable directory. A
governing authority for a phase should not be reachable only by an extraction
that a cache sweep would remove.

---

## Files

### The specification

| File | Role |
|---|---|
| `app/r12/pricing-page.jsx` | **The page component.** Supersedes R11's page component |
| `app/r12/styles.css` | Staging vocabulary. An **addendum** — overrides nothing |
| `app/r10/pricing-trace.jsx` | Progressive traceability. Used by R12 **unchanged** |
| `app/r10/styles.css`, `app/r11/styles.css` | Compliance grid and cost-stack vocabulary |
| `app/r10/data.js`, `app/r11/data.js` | Quote-level projections. Illustrative, not authority |
| `styles.css` | Root tokens and resets |
| `tweaks-panel.jsx` | **Review chrome. Not production UI** — see below |
| `Nexus Round 12.html` | Rendered prototype for visual acceptance |

**Stylesheet load order is load-bearing** and specified by the designer notes:

```
styles.css → app/r10/styles.css → app/r11/styles.css → app/r12/styles.css
```

### R10 / R11 / R12 are lineage, not variants

Unlike `freight-1a` — where 1a, 1b and 1c were competing alternatives and only
one was selected — R10, R11 and R12 **compose**. R12 supersedes only R11's page
component and reuses everything else unchanged.

Assembling R10's trace and R11's grid is therefore **correct**, not a fidelity
error. This is the opposite of the `fr1b`/`fr1c` situation and the distinction
matters: an implementer who generalises from the freight bundle would wrongly
discard R10 and R11.

### `tweaks-panel.jsx` is not production UI

Review chrome — it lets a reviewer flip between prototype states. Production
derives state from data. Do not ship it.

This is an instance of a standing convention; see *"R-round prototype state
strips are review aids, not production UI"* in [`../../../CLAUDE.md`](../../../CLAUDE.md).

### Design documents

| File | Governs |
|---|---|
| `docs/r12-designer-notes.md` | The staging model — lifts and adjustments accumulate, preview freely, commit deliberately |
| `docs/r11-designer-notes.md`, `docs/r11-data-source-map.md` | Compliance grid; cost stack as trace level 1 transposed; entry-at-node; reconciliation assertion |
| `docs/r10-designer-notes.md`, `docs/r10-data-source-map.md` | Progressive traceability — any number expands into the operation that produced it |
| `docs/approval-states-design-position.md` | **Phase 4 authority.** The two-axis state model |

---

## The Phase 4 state model

`docs/approval-states-design-position.md` settles a question that Phase 4
cannot be implemented without, and its conclusion is easy to get wrong from
first principles:

> **A cell has a margin state and, independently, an approval state.**

Enumerating the product of the two axes produces a combinatorial list nobody
can hold. Enumerating them separately produces something small:

| Margin state | Approval state |
|---|---|
| above target | none required |
| below target *(reports, does not block)* | awaiting |
| below floor *(mandate breached)* | rejected |
| corrected by lift | invalidated |
| set directly | approved |

The interface consequence — colour encodes margin state, badges encode history,
and approval needs a **third channel** — is design authority, not
implementation preference.

**This document is tier 3 authority for Phase 4's design and does not settle
Phase 4's business contract.** That is
[`../../business-validation/BV-005-below-floor-margin-approval.md`](../../business-validation/BV-005-below-floor-margin-approval.md),
which is approved but **must be amended before Phase 4 implementation begins**
— see [`../../../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md`](../../../CROSS-PHASE-AUTHORITY-DEPENDENCY-MAP.md) §5
and [`../../OPEN_DECISIONS.md`](../../OPEN_DECISIONS.md).

---

## Approved deviations

**None recorded.** Implementation has not begun.

Deviations are recorded here as they are approved. Per
[`../MANIFEST.md`](../MANIFEST.md) rule 3, an undocumented departure from this
bundle is drift, not deviation.

One item is already known to need disposition: Nexus's existing Pricing surface
uses click-to-edit cells where the canonical source may render display-only.
Whether that survives as an accepted Nexus extension is a Phase 3 kickoff
decision, recorded in [`../../OPEN_DECISIONS.md`](../../OPEN_DECISIONS.md).

---

## Relationship to Phase 3 scope

[`../../../PHASE-3-PRICING-WORKSPACE.md`](../../../PHASE-3-PRICING-WORKSPACE.md)
is the **scope contract** — what ships, in what order, with what dependencies.
This bundle is the **fidelity contract** — what it looks like and how it
behaves.

Where the phase specification paraphrases the design, the bundle wins. Where
the bundle implies scope the phase specification excludes, the phase
specification wins. Neither outranks a later business disposition.

Phase 3 also carries a hard contract dependency on Phase 1's pinned commercial
settings: a sent quote resolves thresholds from its pin, not from live
`firm_settings`. Implementing the lift as `cost / (1 − threshold)` against
current firm settings would target a threshold the sent version never consumed.

---

## What would reopen this bundle

- A new CD round superseding R12's page component, arriving whole and
  registered as a superseding bundle
- A BV-005 amendment that changes the approval state model itself, rather than
  its presentation — in which case `approval-states-design-position.md` is
  amended by tier-1 authority
- Operator review of the implemented Phase 3 surface, which under standard §2
  refines this bundle rather than merely reporting defects against it
