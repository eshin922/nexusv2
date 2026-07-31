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
