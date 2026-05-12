# RI.8 navigation / workflow audit — scope brief

**Status:** Scope doc for the Designer-agent invocation that
prerequisites RI.8 implementation. Findings disposition is Edward
+ CA's call after audit completes.

**Companion doc:** `docs/ri8-brief-amendment.md` §12 (this audit's
home in the RI.8 brief structure).

---

## 0. Frame

Edward reports navigation feels clunky in actual use after walking
through the full RI.0–RI.7 implementation arc. The redesign work
landed surface-by-surface fidelity (each individual screen audited
against its design round source) but the workflow story
*between* surfaces hasn't been audited as a continuous arc.

This audit identifies friction points in the cross-surface
workflow + proposes specific changes.

**Disposition split (Edward + CA decide post-findings):**
- Small + tactical (move a button, add a missing link, fix a
  back-nav target) → absorbed into RI.8 §11 sequencing
- Large structural (re-architect inner-rail, route hierarchy
  changes, new navigation surface) → spun off as RI.9 navigation
  slice — RI.8 doesn't get bloated with structural rework

---

## 1. Audit scope — surfaces in the IA arc

Full create → send → accept → track arc, in PM workflow order:

| Step | Surface | Route |
|---|---|---|
| 1 | Home / Deal organizer | `/` |
| 2 | Project Detail | `/projects/[id]` |
| 3 | Setup / Quote Builder | `/projects/[id]/quotes/[quoteId]` |
| 4 | Cost Build | `/projects/[id]/quotes/[quoteId]/cost-build` |
| 5 | Costing Sheet | `/projects/[id]/quotes/[quoteId]/costing` |
| 6 | Customer view | `/projects/[id]/quotes/[quoteId]/customer-view` |
| 7 | Mark-Accepted | `/projects/[id]/quotes/[quoteId]/mark-accepted` |
| 8 | Admin (firm-settings / markup-defaults / users / audit-log) | `/admin/*` |

Plus the cross-cutting surfaces:
- Outer rail (`src/components/rails/outer-rail.tsx`) — project list
- Inner rail (`src/components/rails/inner-rail.tsx`) — scenario list
- App shell (`src/components/app-shell.tsx`)
- Sub-rail (if present per RI.3 §3.6 — scenario expand to
  Setup / Cost build / Costing sheet / Customer view links)

---

## 2. Focus areas

### 2.1 Route hierarchy + back-navigation

Audit:
- Is the route depth consistent? `/projects/[id]/quotes/[quoteId]/...`
  is 4 levels deep; does that match PM mental model?
- Back-navigation: which surfaces have explicit "← Quote builder"
  links, which rely on browser back, which have outer/inner rail
  navigation? Inconsistent across RI.6 / RI.7 surfaces (customer
  view + mark-accepted have thin top-strip links; Cost Build
  doesn't).
- Is there a "where am I in the IA" indicator on each surface?
  (Project Detail header has project identity; deeper surfaces
  have lighter identity — does PM lose orientation?)

### 2.2 Action button placement consistency

Audit the action clusters on every surface:
- **Cost Build header (`src/components/cost-build/cost-build-header.tsx`):**
  View as customer / Save draft / WarningSummaryChip
- **Costing Sheet head (`src/components/costing/costing-page-head.tsx`):**
  ← Back to Cost Build / Preview customer quote /
  Customer-accept toggle (sent only) / Mark accepted cluster
  (or strikethrough + override-request for BELOW_FLOOR)
- **Customer view toolbar (`src/components/customer-view/preview-toolbar.tsx`):**
  Send as: tier table | single tier / Download PDF /
  Download + open mail draft / Mark sent (dev — Slice 11
  replaces) — dev-gated
- **Mark-Accepted header:** Mark accepted CTA + cluster
  variations per sub-state

Is the visual hierarchy consistent? Does "primary" action stay
in the same screen-corner across surfaces? Does the
"navigate-away" action (Preview / View as customer) live in the
same position? Do PMs have to relearn button placement per
surface?

### 2.3 Inner-rail routing

`inner-rail.tsx` drives per-project scenario navigation. Which
surfaces should it drive (which surfaces are scenario-scoped vs
quote-scoped vs project-scoped)?

Audit:
- Does inner-rail render on all quote-scoped surfaces (Setup,
  Cost Build, Costing Sheet, Customer view, Mark-Accepted)?
- Does it disappear on Project Detail / Home / Admin?
- Does clicking a scenario in the inner rail navigate to a
  predictable surface (latest version's Cost Build? Costing
  Sheet? Setup?), or does it depend on where you are?
- Sub-rail per RI.3 §3.6 — does it exist? Is it useful? Does
  it duplicate inner-rail content?

### 2.4 Workflow continuity across create → send → accept → track

Audit the canonical PM journey:

1. **Create:** Import deal → Project Detail → new scenario →
   Setup → add SKUs + tiers
2. **Build:** Setup → Cost Build → fill packaging/production/
   freight inputs → Costing Sheet to review margins
3. **Iterate:** Costing Sheet → Cost Build (drilldown) → back
   → tune
4. **Preview:** Costing Sheet → Preview customer quote (read-only
   review) → close, refine, repeat
5. **Send:** Customer view → (Slice 11) Download + mail draft;
   quote transitions to sent + snapshots fire
6. **Receive customer signal:** Costing Sheet → Customer-accept
   toggle → record tier
7. **Finalize:** Mark accepted → review gates → confirm →
   scenario locked, sibling auto-drop
8. **Track:** Project Detail → version chain shows accepted
   state + quote_number

For each transition, audit:
- Is the next-step affordance discoverable on the current
  surface?
- Is the back-step path obvious if PM second-guesses?
- Does any step require browser-history reliance instead of
  in-app navigation?
- Where does PM lose flow / hesitate / consult the URL bar?

---

## 3. Output expected from Designer

**Per-finding format:**

```
F-N: [Finding name]
  Surface(s): [list]
  What: [observation]
  Friction: [low / medium / high — Edward's smoke felt this]
  Proposed change: [specific patch]
  Disposition recommendation: [tactical / structural]
```

**Tactical findings** are small enough to land in an existing
RI.8 step (e.g., "add 'Cost Build →' link in the Costing Sheet
breadcrumb strip" rolls into RI.8 step 7 dark-mode sweep or any
relevant step's polish work).

**Structural findings** require dedicated thought (e.g.,
"inner-rail should drive Customer view too, not just Cost Build /
Costing Sheet" → potentially RI.9 navigation slice).

---

## 4. Known limit of Designer agent — flag if hit

Designer's demonstrated competency pattern (per the agent's own
description + RI.0–RI.7 invocation history):
1. Per-surface visual fidelity audit against design source
2. Vocabulary-consistent extension into novel states the
   prototype didn't sketch
3. Small targeted design rounds for new functional surfaces

**Cross-surface workflow analysis is structurally different.**
It's the kind of audit a human design lead does at IA level, not
visual fidelity at surface level.

If the agent can do this scope cleanly, surface findings.

**If the agent can't:**
- Note specifically WHICH parts of the scope are tractable vs not
- Surface the gap to CC for Edward + CA review
- CC then escalates to human CD R7 ask: "Designer can't do
  cross-surface workflow audit; we need a Round 7 review focused
  on IA, not visual fidelity."

This is a probable outcome per Edward's framing in the RI.8
brief amendment §12. Don't force-fit; honest "this is out of my
competency" is better than weak findings.

---

## 5. Constraints on proposed changes

To save Designer + Edward + CA time, scope guardrails on what
Designer should propose:

- **Don't propose new design vocabulary.** Use existing R3 / R4
  / R5 / R6 register only. Novel grammar = escalate to CD R7.
- **Don't propose schema changes.** Navigation is render-layer +
  route-layer work. Schema work is a separate concern.
- **Don't propose new top-level routes** outside existing IA
  unless absolutely necessary; structural moves are RI.9 work.
- **Bias toward additive changes** (new affordances, missing
  links) over subtractive (removing existing surface elements
  that PMs may rely on).
- **Tactical findings should be implementable in <1 day each.**
  Anything larger → structural.

---

## 6. Output destination

Designer's findings land in CC's response to Edward + CA. CC
formats per §3 above, then routes:
- Tactical → CC absorbs into RI.8 §11 step
- Structural → CC spins off RI.9 navigation slice with the
  findings as kickoff scope

Edward + CA review before disposition decision (per RI.8 §10
checklist item).
