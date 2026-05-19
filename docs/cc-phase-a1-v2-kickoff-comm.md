# CC Kickoff — Phase A.1 v2 Impl

**To:** CC (Claude Code)
**From:** CA (Claude Advisory)
**Re:** Phase A.1 v2 implementation — ASY/LEAF/library spec model
**Status:** Pending §0.5 gates + Edward pre-impl dispositions

---

## Headline

Phase A.1 v2 is the next major slice after Pricing reframe wraps. CD shipped the Pattern 30 bundle; CA shipped the impl brief. **Five weeks of work across eight sequenced phases.** Don't open the impl-1 branch yet — there are blocking gates.

Brief at `docs/cc-phase-a1-v2-impl-brief.md`. Full read required before any work begins.

## Why now

Edward promoted product specs from Aisha's 1:1 backlog (originally v1.1) to v1 critical path. Through CD design rounds + Edward dispositions, the scope expanded into the architectural shift the tool needs: **ASY/LEAF/library model**. This isn't a small feature — it's the major DB + IA work for v1.

The Quote umbrella shipped in Phase A. Pricing reframe is wrapping. After this slice + Microsoft OAuth + pre-launch review, **v1 ships**.

## What ships in this slice

- **7 new tables** (`product_types`, `assemblies`, `leaves`, `assembly_leaves`, `leaf_specs`, `quote_leaves`, audit_log namespace additions)
- **2 new RLS permissions** (`can_edit_specs`, `can_create_leaves`)
- **8 new audit log actions** + caused_by_audit_id cascade pattern carryover
- **Setup surface IA shift** (SKUs page becomes tree; Tiers moves below)
- **Spec entry surface** (per leaf, type-aware, with cascade warnings + replenishment)
- **Add Product modal** (ASY/LEAF mode toggle)
- **Library browse + replenishment view** (three-state version stamps)
- **PDF addendum** (per-leaf, grouped by ASY)
- **Audit log export** (CSV, per-quote + per-leaf scopes)
- **NetSuite SO push payload extension** (per Architect Gate 4 resolution)
- **Soft gate at Preview Quote** (non-blocking)

Out-of-scope reminders in §12 of the impl brief. Don't build the deferred items (HubSpot migration, exec gating, flat-leaves view, etc.).

## Sequencing — DO NOT START YET

Three blockers before impl-1 branch opens:

1. **Pricing reframe wraps** — must be merged to main + smoke-tested. Currently in flight on `slice-pricing-reframe-impl`.
2. **Architect §0.5 verification** — five Pattern 25 gates committed at `docs/architect/phase-a1-v2-schema-commit.md`. Triggered in parallel via separate runtime; ETA 1-2 days after invoked.
3. **Edward pre-impl dispositions** — four items still open in §15 of the impl brief (Product Type taxonomies, RLS role assignments, NetSuite path).

When all three resolve, the checklist in §14 of the impl brief gates the impl-1 branch open.

## Phase plan

8 phases, feature-branch-per-phase, sequential merge with smoke tests between:

| # | Branch | Scope | Effort |
|---|---|---|---|
| 1 | `slice-phase-a1-v2-impl-1-schema` | Tables + migration | 4-5d |
| 2 | `slice-phase-a1-v2-impl-2-setup-ia` | SKUs tree, Tiers below, context menus | 5-6d |
| 3 | `slice-phase-a1-v2-impl-3-spec-entry` | Type-aware spec entry surface | 5-6d |
| 4 | `slice-phase-a1-v2-impl-4-add-product` | ASY/LEAF mode toggle modal | 3-4d |
| 5 | `slice-phase-a1-v2-impl-5-library-replenishment` | Library browse + version stamps | 4-5d |
| 6 | `slice-phase-a1-v2-impl-6-pdf-addendum` | Per-leaf PDF render | 4-5d |
| 7 | `slice-phase-a1-v2-impl-7-audit-export` | CSV export endpoints | 3-4d |
| 8 | `slice-phase-a1-v2-impl-8-softgate-netsuite` | Soft gate + NetSuite payload | 3-4d |

**Total: 5-6 weeks CC time.** Each phase's "Gates before merge" criteria in §5 of impl brief — visual diff vs. CD prototype, smoke tests, RLS verification.

## Canonical artifacts (read all before impl-1)

- **CA brief (canonical scope):** `docs/cd-quote-workflow-recalibration-brief.md` — 17 sections, all dispositions locked
- **Impl brief (this slice):** `docs/cc-phase-a1-v2-impl-brief.md` — 15 sections, phase-by-phase scope + gates
- **CD designer notes:** `docs/cd-quote-workflow-a1-v2-designer-notes.md` — design decisions, pushbacks, considered-and-rejected
- **CD data-source map:** `docs/cd-quote-workflow-a1-v2-data-source-map.md` — schema commitments, Pattern 25 verification gate items
- **CD prototype (visual reference):** `dist/Nexus_Quote_Workflow_A_1_v2.html` — 36 scenarios across 8 groups
- **Iter 1 prototype (historical, no longer canonical):** `dist/Nexus_Quote_Workflow_A_1.html` — preserved for visual-shift comparison

## Pre-impl checklist (§14 of impl brief)

Before opening impl-1:

- [ ] Pricing reframe merged + smoke-tested on main
- [ ] All 5 Architect §0.5 gates resolved (commit at `docs/architect/phase-a1-v2-schema-commit.md`)
- [ ] Edward provides exact `product_types` seed data (ASY + LEAF level taxonomies)
- [ ] Edward confirms initial RLS role assignments
- [ ] Edward confirms NetSuite payload path (v1 vs. v1.1)
- [ ] PR comm template ready at `docs/cc-comm-phase-a1-v2-impl-1.md`

CC opens impl-1 when checklist passes — not before.

## Mid-impl coordination patterns

### If you discover schema needs adjustment

Surface to Architect via comm doc at `docs/architect/phase-a1-v2-schema-amendment-N.md`. CA reviews; brief amendments published if needed. Do NOT silently adjust schema mid-impl.

### If you discover UX questions during impl

Surface to CD + CA via comm doc. CA + CD respond. Phase A precedent: three productive pushbacks landed via this pattern.

### If you discover scope expansion needed

Stop and surface to Edward. Do not absorb scope expansions silently. Each new scope item either lands in a follow-up slice or gets explicit Edward sign-off.

### Per-phase merge pattern

Each phase merge requires:
1. PR comm doc at `docs/cc-comm-phase-a1-v2-impl-N.md` summarizing scope shipped
2. Visual diff verification against CD prototype (in PR description with screenshots or side-by-side)
3. Smoke test results
4. Known issues / follow-ups
5. Next phase prerequisites confirmed

## Pattern 25 §0.5 lesson reminder

From the Pricing reframe round: CA propagated phantom column classification without verifying against `schema.ts`. The lesson: **trust nothing about schema without verifying against canonical source.** Architect's §0.5 gate is the formal verification step before impl. CC honors it.

If during impl-1 you find schema decisions in the Architect commit that don't match the impl brief — surface, don't adjust. CA + Architect resolve before impl proceeds.

## Pattern 47 (autosave focus-stability) reminder

Drag-to-reorder on the SKUs tree + spec field edits both use the autosave + focus-stability pattern from PR #32. Same conventions apply.

## Standing expectations

- **One PR per phase.** Don't combine phases into mega-PRs.
- **Standard PR comm pattern.** PR descriptions include scope summary, visual diff, smoke test results, follow-ups.
- **Sequential phases.** No parallel work across phases (schema migration must be live before Phase 2 UI work, etc.).
- **Brief is canonical.** When in doubt, the CA brief at `docs/cd-quote-workflow-recalibration-brief.md` is source of truth for scope.
- **Standing pushback welcome.** Phase A precedent: when something reads wrong during impl, flag it.

## Final note

This is the biggest single slice in v1. CD shipped excellent design work. CA shipped the impl plan. The remaining unknowns are Architect's §0.5 gates and Edward's last dispositions. Once those land, this slice is ready to ship in clean sequence.

Don't open impl-1 until checklist passes. When checklist passes, proceed methodically through the 8 phases. Standing by for PR comms as each phase lands.

— CA
