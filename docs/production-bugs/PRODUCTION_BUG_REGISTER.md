# Production Bug Register

This register records verified production defects separately from Business
Validation decisions, ADRs, and execution plans. A PB entry is complete only
when its governing invariant has permanent regression evidence.

## PB-001 — Canonical lifecycle status consistency

- **Observation:** The Deals Organizer displayed `DRAFT` for a completed,
  frozen quote.
- **Root cause:** Organizer presentation covered only draft, sent, and
  accepted; every unrecognized canonical status fell back to the draft chip.
- **Business impact:** Users could not trust whether an irreversible lifecycle
  action had succeeded or whether a quote remained editable.
- **Governing invariant:** Every Nexus surface displays the same canonical
  quote lifecycle state that controls server-side editability.
- **Fix:** Provide exhaustive presentation for every database quote status and
  fail visibly for unknown future statuses. The badge, filters, selected quote
  ID, scenario, version, and status all come from the same organizer record.
  Latest-quote selection deliberately retains the established `updated_at`
  projection.
- **Future decision:** Nexus has no single immutable chronology that can rank a
  newly created quote in one scenario against an in-place revision in another.
  Authoritative cross-scenario commercial chronology is a separate business
  decision and is not part of PB-001.
- **Regression evidence:** `tests/unit/quote-lifecycle-surfaces.test.ts` and
  `tests/e2e/slice-12/lifecycle-surface-consistency.spec.ts`.
- **Release status:** V1 release blocker; resolved. Focused lifecycle unit and
  browser verification passed on 2026-07-30.

## PB-005 — Home and project cache consistency

- **Observation:** Lifecycle status and audit activity could remain stale on
  the organizer and project-detail surfaces until a hard browser refresh.
- **Root cause:** Lifecycle actions invalidated quote-scoped pages but not the
  page-level consumers at `/` and `/projects/:id`.
- **Business impact:** The UI could appear to contradict a successful,
  persisted lifecycle transition.
- **Governing invariant:** A successful lifecycle mutation is observable on
  every lifecycle/status consumer without a hard browser reload.
- **Fix:** Add lifecycle-specific page invalidation for the quote tree, exact
  project page, and organizer page. Costing autosave continues using only
  quote-tree invalidation.
- **Regression evidence:** `tests/unit/quote-lifecycle-surfaces.test.ts` and
  `tests/e2e/slice-12/lifecycle-surface-consistency.spec.ts`.
- **Release status:** V1 release blocker; resolved. Focused lifecycle unit and
  browser verification passed on 2026-07-30.

## PB-006 — Packaging component identity

- **Observation:** Packaging cost rows presented Pricing Vendor or legacy
  Supplier as the primary row label, obscuring the component being costed.
- **Root cause:** The row label preferred pricing-provenance values even though
  the row already resolves to a cost-bearing `leaves` record.
- **Business impact:** Users could mistake the source of pricing for the
  packaging component itself.
- **Governing invariant:** A packaging cost row identifies what is being costed
  with its governed LEAF name and SKU; Pricing Vendor identifies only where
  that pricing originated.
- **Fix:** Use the existing LEAF name as the primary component label and its SKU
  as supporting identity. Keep Pricing Vendor in its dedicated provenance
  column. No new component-identity field was added:
  existing product/LEAF identity, category, notes, and pricing provenance were
  audited and were sufficient.
- **Regression evidence:** `tests/e2e/costing/basic-quote-persistence.spec.ts`
  (`VAL-104`) and `tests/unit/costing-surface-contract.test.ts`.
- **Release status:** V1 release blocker; resolved.

## PB-008 — Pricing Source experience

- **Observation:** Pricing Vendor search, selected state, repeated guidance,
  Historical Supplier, and Pricing Date competed inside one narrow table cell.
- **Classification:** Product refinement following Visual Design Fidelity and
  Design System Fidelity review; not a pricing-calculation defect.
- **Business impact:** PMs could not immediately distinguish the one governed
  decision from compatibility evidence and contextual guidance.
- **Governing invariant:** A PM makes exactly one V1 pricing-provenance
  decision: who supplied the price.
- **Fix:** Give search, selected, empty, unavailable, and historical states
  distinct hierarchy; move guidance to the column-level information affordance;
  remove Pricing Date from the V1 UI and mutation workflow while leaving its
  nullable production column dormant and existing values untouched.
- **Regression evidence:** `tests/unit/pricing-vendor-contract.test.ts` and
  `tests/e2e/costing/basic-quote-persistence.spec.ts` (`VAL-104`).
- **Release status:** **RESOLVED.** Unit and release-blocking VAL-104 browser
  coverage pass, and the desktop and narrow-desktop visual review confirms the
  governed vendor is primary while legacy evidence remains subordinate.

## PB-004 — Bulk pricing transparency and exact undo

- **Observation:** “Preview” immediately persisted a global adjustment without
  showing tier-level price effects or providing a safe reversal.
- **Business impact:** A commercial pricing mutation could occur before the PM
  understood which tiers and customer prices would change.
- **Governing invariant:** Bulk pricing changes are transparent before
  persistence and exactly reversible immediately afterward.
- **Fix:** Preview is a read-only canonical costing projection showing each
  tier’s current adjustment and price, delta, resulting adjustment, and
  resulting price. Only Apply persists and audits. A bounded in-session Undo
  restores exact prior persisted values from the Apply audit receipt, refuses
  stale receipts, and writes its own audit cascade.
- **Undo boundary:** Undo is available only in the current UI session after a
  successful Apply. Apply survives reload; Undo intentionally does not.
- **Regression evidence:** `tests/unit/pricing-lift.test.ts` and
  `tests/e2e/costing/bulk-pricing-lift.spec.ts`.
- **Release status:** V1 release blocker; resolved.

## PB-007 — Cost-context SKU eligibility

- **Observation:** “Other SKUs in this scenario” included ASY records even
  though this packaging-costing context is backed by LEAF input cells.
- **Root cause:** The anchor was selected from filtered LEAFs, but the remaining
  options were rebuilt from the unfiltered ASY-and-LEAF collection.
- **Business impact:** Users saw non-cost-eligible assembly records alongside
  selectable packaging components.
- **Governing invariant:** A packaging-cost context exposes only cost-bearing
  LEAF junctions; ASYs remain assembly context and are not packaging cells.
- **Fix:** Build both the anchor and remaining SKU list from the same LEAF-only
  collection.
- **Regression evidence:** `tests/e2e/costing/basic-quote-persistence.spec.ts`
  (`VAL-104`) and `tests/unit/costing-surface-contract.test.ts`.
- **Release status:** V1 release blocker; resolved.

## PB-010 — Governed CRM presentation

- **Observation:** Operator surfaces could expose raw HubSpot stage IDs, stale
  hardcoded labels, or omit the Sales Owner when that owner had no Nexus user.
- **Root cause:** Organizer, Project Detail, and Import used three different
  stage presentation paths; Project Detail treated a Nexus user join as the
  source of Sales Owner presentation.
- **Business impact:** CRM-owned identities appeared inconsistent even though
  the stored HubSpot lineage was correct.
- **Governing invariant:** HubSpot Deal Owner and current pipeline metadata are
  authoritative for operator presentation. Nexus user identity is separate.
- **Fix:** Resolve all three surfaces through the provider-backed current stage
  catalog; fail closed for unknown stages; render the cached HubSpot owner name
  against `projects.hubspot_owner_id`, with a matching Nexus identity only as a
  fallback.
- **Regression evidence:** `tests/unit/crm-presentation.test.ts` and
  `tests/e2e/slice-12/workspace-governance.spec.ts` (`VAL-105`).
- **Release status:** V1 release blocker; resolved pending operator approval.

## PB-011 — Undefined project actions exposed in V1

- **Observation:** Project Detail exposed manual `Refresh from HubSpot` and
  `Archive` controls without approved V1 synchronization, authorization,
  lifecycle, reporting, or recovery contracts. Refresh produced an opaque
  production Server Components failure for a legacy sample project whose
  stored deal identifier did not resolve in HubSpot.
- **Root cause:** Engineering utilities for cache refresh and soft-archive
  compatibility were promoted to operator actions before their business
  boundaries were governed.
- **Business impact:** Refresh could rewrite CRM snapshots, Nexus owner linkage,
  and downstream customer-resolution inputs; Archive could hide active work
  without an operator recovery path.
- **Governing invariant:** V1 exposes only governed actions required by
  `Import from HubSpot → Build → Cost → Price → Send → Accept → Complete`.
- **Fix:** Remove both Project Detail controls and any user-facing direction to
  use manual project refresh. Preserve import synchronization, cache/provider
  infrastructure, server actions, project-status schema, audit compatibility,
  and direct-route readability of historical archived records.
- **Regression evidence:** `tests/unit/project-v1-action-surface.test.ts` and
  `tests/e2e/slice-12/workspace-governance.spec.ts` (`VAL-105`).
- **Release status:** V1 production-risk closure; resolved in code pending
  operator approval.

## PB-012 / PVS-017 — Dropped scenario selected as current quote

- **Observation:** Project Detail showed `Alt 1` as `DROPPED`, while the Deals
  Organizer presented that same historical quote as the project's current
  `DRAFT` quote even though active sent scenarios remained.
- **Root cause:** The Organizer selected the latest `quotes.updated_at` across
  every scenario. Dropping a scenario intentionally preserves quote lifecycle
  status but updates `updated_at`, making dropped history win the projection.
- **Business impact:** Historical work could displace the actual current
  commercial proposal and misstate project status and filters.
- **Governing invariant:** Dropped scenarios are historical only. When a
  non-dropped scenario exists, select the most recently updated eligible quote;
  when every scenario is dropped, render `No Active Scenario` without promoting
  history.
- **Fix:** Exclude `scenario_status = 'dropped'` only at the Organizer current-
  quote projection. Preserve existing `updated_at` ordering among eligible
  scenarios and leave every lifecycle and historical record unchanged.
- **Regression evidence:** `tests/unit/quote-lifecycle-surfaces.test.ts` and
  `tests/e2e/slice-12/workspace-governance.spec.ts` (`VAL-105`).
- **Release status:** V1 operator-trust blocker; resolved in code pending
  verification and operator approval.
