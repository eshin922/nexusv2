# Validation scenario registry

Status values: `planned`, `unit-protected`, `implemented`, `blocked`.

## VAL-701 — Sales Order accounting payload contract

- Business promise: Nexus sends only approved current Sales Order fields,
  preserves flat-leaf commercial math, and does not activate evidence-gated
  mappings.
- Preconditions: deterministic pure payload input and canonical completion
  source.
- Inputs/actions: map complete and null/optional payloads; vary quote, tier,
  payload, rate, cost, tax, payment text, and project-manager input.
- Visible result: none; this is a server-boundary contract.
- Persisted state: the successful-push uniqueness backstop is structurally
  protected; unit tests perform no database mutation.
- Numerical outcome: rate and unit cost normalize to four decimals; amount is
  omitted and independently reconciles as quantity × rate.
- Audit/artifact/provider: no writes; the protected object is the exact input
  to `NetSuiteOperations.createSalesOrder`.
- Security: historical, SuiteTax, bundle, opportunity, workflow-derived, and
  unknown fields remain absent.
- Failure modes: mapping drift, accidental field activation, inferred project
  manager, standard-terms activation, explicit line amount, nondeterministic
  key, or create-before-prior-success-check.
- Layer/file: registered unit/structural contract,
  `tests/unit/sales-order-accounting-contract.test.ts`.
- Sources: `src/lib/netsuite/sales-orders.ts`,
  `src/lib/netsuite/mark-complete.ts`, and `src/db/schema.ts`.
- Maintenance: update the field universe and evidence classification before
  changing an assertion.
- Status: unit-protected; release-blocking through `npm run test:unit`.

## VAL-101 — Create and persist a basic quote

- Business promise: supported quote setup, cost totals, pricing, and tiers save
  without unit mutation or silent loss.
- Preconditions: isolated draft fixture, editable role, positive tier quantity.
- Inputs/actions: enter packaging per-unit cost, production tier totals, one-time
  fees, save, navigate away, reopen.
- Visible/persisted result: exact entered totals return; derived per-unit values
  recalculate identically.
- Numerical outcome: production totals divide once; packaging does not.
- Audit: one successful field audit per persisted change.
- Artifact/provider: none; no external traffic.
- Failure modes: invalid input remains unsaved and previous value is restored.
- Failure modes also include stale-prop sibling overwrite during sequential
  lazy-row autosaves; each save patches only its named field.
- Layer/file: browser plus action integration,
  `tests/e2e/costing/basic-quote-persistence.spec.ts`.
- Sources: production drilldown, production action, costing engine.
- Maintenance: use audit-friendly values and strict browser diagnostics.
- Status: implemented.

## VAL-103 — Concurrent debounced cost edits persist without save loss

- Business promise: two different autosaved production-cost cells edited
  within one debounce window both reach the server and persist.
- Preconditions: isolated editable draft, existing production row, positive
  quoted tier quantity, production drawer open.
- Inputs: filling/blending changes from $100.00 to $125.00 and CM assembly
  changes from $50.00 to $75.00.
- User actions: edit both real UI cells in immediate succession, observe both
  Server Action responses, and reload.
- Visible result: both cells show database-canonical two-decimal receipts
  before and after reload.
- Persisted state: the same row contains exactly $125.00 and $75.00; neither
  request replaces its persisted sibling with stale server props.
- Numerical result: the 100-unit tier derives $1.25/u and $0.75/u.
- Audit: exactly one `assembly_production_input_updated` row per field with
  canonical `from` and `to` values.
- Customer artifact/provider effects: none; no PDF, provider call, or outbound
  traffic.
- Security: draft and role guards remain active under isolated PM identity.
- Failure modes: quote-tree revalidation remounts and cancels the sibling
  timer; stale whole-row submission overwrites the first save; raw parser
  values appear instead of persisted canonical receipts or audits.
- Layer/file: browser with database and audit verification,
  `tests/e2e/costing/basic-quote-persistence.spec.ts`.
- Sources: production drilldown, production-input action, costing store, audit log.
- Maintenance: retain observable response synchronization; never replace it
  with sleeps. Transport changes must still prove two distinct receipts and
  two exact field audits.
- Status: implemented.

## VAL-102 — Required fields and invalid input

- Promise: malformed, negative, non-finite, over-precision, zero-divisor, and
  overflow input cannot mutate quote state.
- Preconditions: persisted valid draft values.
- Inputs/actions: submit each invalid class through action and UI.
- Visible/persisted/numerical result: field error; prior value and calculations remain.
- Audit/artifact/provider: no success audit, artifact, provider call, or traffic.
- Layer/file: unit parser tests, action integration, focused browser; partially implemented.
- Sources: `numeric-input.ts`, quote cost actions.
- Maintenance: add every new numeric field to a named domain.
- Status: unit-protected; integration/browser pending.

## VAL-201 — Production and packaging calculation

- Promise: packaging is per-unit; filling, CM, and bulk raw are tier totals.
- Preconditions: 100-unit tier and zero markup fixture.
- Inputs: packaging $2 × 3; filling $100; CM $50; bulk raw $200.
- Result: packaging $6/u, production COGS $1.50/u, bulk raw $2/u.
- Persisted state: raw inputs remain unchanged totals.
- Audit/artifact/provider: none for pure unit test.
- Failure modes: double division or missing COGS fails exact assertions.
- Layer/file: unit, `tests/unit/production-costing.test.ts`.
- Sources: `src/lib/costing.ts`.
- Maintenance: browser tests consume output, never copy the formula.
- Status: implemented.

## VAL-202 — One-time fee allocation

- Promise: setup, tooling, R&D, and other services are included in unit pricing
  only when allocated and otherwise appear once as charges.
- Preconditions: four $10 fees, 100-unit tier.
- Actions/results: allocation on adds $0.40/u and no charge rows; allocation off
  adds $0/u and four one-time charge rows.
- Persisted state: fee totals and toggle preserved.
- Audit: policy change and fee edits recorded once.
- Artifact: preview/PDF match and do not double count.
- Provider: none.
- Failure modes: fee present in both unit price and charge block.
- Layer/files: unit plus customer-projection/artifact integration; unit portion implemented.
- Sources: costing, customer resolver, PDF adapter.
- Maintenance: `otherServiceTotal` remains one-time.
- Status: partially implemented.

## VAL-203 — Multiple quantity tiers

- Promise: each tier total uses its own positive quoted denominator; one-time
  policy remains assembly-consistent.
- Preconditions/inputs: at least two tiers with explicit totals and quantities.
- Visible/persisted/numerical result: exact tier totals persist and independently
  derive expected per-unit contributions.
- Audit: changed tier only; policy fan-out separately audited.
- Artifact/provider: tier prices match preview/PDF; no provider.
- Failure modes: cross-tier leakage, arbitrary fee-row selection, zero divisor.
- Layer: unit, integration, browser; planned.
- Sources: costing, production action, customer resolver.
- Maintenance: include tier reorder and null quantity.
- Status: planned.

## VAL-204 — Margin versus markup accuracy

- Promise: markup builds sell from classified component costs; gross margin is
  `(sell-cost)/sell` and is not markup.
- Preconditions: explicit zero/nonzero markup and adjustment cases.
- Inputs/actions: change cost, markup, adjustment, and override independently.
- Results: explicit sell, profit, margin, and reverse-solve outcomes.
- Persisted state: exact decimal domains preserved.
- Audit: markup/adjustment/override events only on success.
- Artifact/provider: customer sees sell only; none.
- Failure modes: markup/margin confusion, stale reverse solve.
- Layer: unit plus action integration; planned.
- Sources: costing and pricing actions.
- Maintenance: rerun whenever cost classification changes.
- Status: unblocked; pending expanded matrix.

## VAL-205 — Save/reopen exact pricing

- Promise: save, refresh, navigation, and reopen preserve entered values and
  reproduce calculations without rounding drift.
- Preconditions: VAL-101 fixture with multiple numeric scales.
- Actions: save, reload, navigate away/back.
- Results: exact persisted strings and expected recalculation.
- Audit: no duplicate audit on no-op reopen.
- Artifact/provider: none.
- Failure modes: silent normalization beyond documented schema scale.
- Layer: action integration and browser; planned.
- Sources: numeric parsers, actions, costing store.
- Maintenance: include null versus explicit zero.
- Status: unblocked after VAL-101 implementation.

## VAL-206 — Customer preview hides internal costs

- Promise: production/packaging COGS, markups, margins, and internal notes never
  enter CustomerView, while allowed separate fees appear once.
- Preconditions: populated internal costs and allocation-off fees.
- Actions: open preview.
- Visible result: customer prices and permitted charges only.
- Persisted/numerical result: no mutation; total equals unit prices plus charges.
- Audit/provider: none.
- Artifact: customer projection inspected structurally.
- Failure modes: internal field leak or duplicate fee.
- Layer: projection integration and browser; planned.
- Sources: customer resolver/types/preview.
- Maintenance: boundary tests must enumerate newly added customer fields.
- Status: unblocked.

## VAL-207 — Preview/PDF pricing and immutability

- Promise: preview and PDF share canonical customer values; sent/accepted
  snapshots and PDF bytes never change after production actuals or draft work.
- Preconditions: deterministic draft, send lifecycle, stored artifact.
- Actions: preview, send, record snapshot/hash, attempt prohibited edits, review PDF.
- Result: values agree before send; historical snapshot/hash remain exact.
- Persisted state: sent snapshot immutable; revisions create new history.
- Audit: send/review events only; rejected cost edit has no success audit.
- Provider: fake HubSpot ledger contains expected send only.
- Artifact: local PDF exists and hash remains stable.
- Failure modes: live recompute of sent content or artifact overwrite.
- Layer: artifact integration and lifecycle browser; planned extension of VAL-601.
- Sources: send action, snapshots, artifact storage, PDF route.
- Maintenance: never regenerate expected historical artifacts.
- Status: partially protected by VAL-601; pricing immutability extension pending.
