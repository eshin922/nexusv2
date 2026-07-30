# CC Instructions — Product Modal Rewrite

Companion to `product-modal-brief.md`. The brief is the spec; this is how to execute it.

## Read first
1. `product-modal-brief.md` — the full spec (fields, behaviors, phasing).
2. Current modal component (the one rendering "Add product" with the HubSpot toggle).
3. Any existing HubSpot API client/service module — find and reuse it; do not introduce a second path to HubSpot.
4. The `SURFACE_META` config — check whether product-add is already represented there. If yes, adopt the existing primitive pattern rather than hand-rolling.

## Before writing code
Verify, don't assume:

- **Where the HubSpot writeback currently lives.** The current toggle says it writes in background. Trace that code path — that's the existing integration surface. Confirm credentials/auth flow, error handling, and any retry/queue logic. The new model uses the same outbound path but flips it from optional to mandatory.
- **Existing form primitives.** Use the codebase's existing input, select, toggle, and modal primitives. Do not introduce new ones for this work.
- **Existing duplicate-check or HubSpot-lookup utilities.** The "Pull from HubSpot" button already queries HubSpot Products by SKU/name — the SKU duplicate-check on blur should reuse that query path, not duplicate it.
- **Where line items reference products.** The line item rendering will reference the HubSpot product ID returned from the create call. Confirm the local schema can hold that ID and that line items can resolve through it.

If any of the above can't be found, stop and ask before scaffolding new infrastructure.

## Phase 1 scope (this PR only)

In scope:
- Remove the "Push to HubSpot" toggle entirely. Submit always writes to HubSpot.
- Replace the field set with the full HubSpot schema per the brief.
- Wire submit through the existing HubSpot Products create path (no parallel implementation).
- SKU duplicate check on blur — debounced, reuses the existing Products query.
- `hs_product_type` dropdown with correct label/value mapping (see brief; three values diverge).
- Update modal copy and title to reflect HubSpot-first model.
- No local-only state on failure.

## Out of scope (do NOT touch)
- Tier breakpoint UI — separate spec (Phase 3).
- Line item rendering in quotes.
- The existing Tier 1 / Tier 2 quote table (the manual tier-listing workaround stays put for now).
- The "scenario" concept, the "assembly" concept, the "Leaf · single-line" Type field — pending answers to open questions in the brief.
- Edit-product flow — Phase 2.
- Image upload — Phase 2.
- Bulk import or migration of the 990 existing products.

If a refactor seems necessary outside this scope to make Phase 1 clean, bank it as a finding and surface in the PR; don't expand the diff.

## Implementation guardrails

1. **HubSpot is authoritative.** The local store reflects HubSpot. Never write to the local store before the HubSpot create call succeeds. Never write to the local store on a HubSpot failure.
2. **One HubSpot service module.** All product reads and writes go through one module. If there are currently multiple paths, do not add a third — note the duplication as a finding.
3. **Send values, display labels** for all enum fields. Especially `hs_product_type` — three labels differ from stored values.
4. **Margin is calculated.** Display only. Do not store. Do not send to HubSpot. HubSpot has no `margin` property.
5. **Create date is HubSpot-managed.** Do not expose as user input even though the brief lists it as "optional" (the brief reflects what HubSpot's UI exposes; in our modal it should be display-only on edit and absent on create).
6. **Owner defaults to the current HubSpot user**, fetched at modal open. Editable.
7. **`hs_status`** is not in the create form — new products are created Active by default.

## Gotchas / failure modes to watch

- **SKU race condition.** User enters a SKU, blur check passes, user submits, but someone else created that SKU in HubSpot between blur and submit. HubSpot will reject the create. Handle the rejection gracefully — show the same "SKU exists" warning with Pull existing / Use different SKU CTAs, do not crash the modal.
- **Network failure mid-create.** If the HubSpot call times out, the create may or may not have succeeded. Do not retry blindly — surface the error, instruct the user to refresh and check the product list before retrying. Optionally add a follow-up read to confirm.
- **Owner field empty.** If the current HubSpot user can't be resolved at modal open, the Owner field should be empty (not crash, not fall back to a random user). Submit can succeed with no owner.
- **Markup field semantics.** It's stored as a number in HubSpot (percentage, per the existing quote table showing 32%, 30%, etc.). Confirm whether HubSpot stores `32` or `0.32` before submitting — do not guess. Sample existing records.
- **`fsc_supplier_verified` is a boolean.** The other FSC fields are enums. Don't unify them by accident.

## Acceptance criteria (definition of done)

- [ ] Toggle removed; submit always writes to HubSpot.
- [ ] All 13 fields render and submit correctly per the brief.
- [ ] Required-field validation blocks submit on empty Name, Unit price, or Product type.
- [ ] Entering a SKU that exists in HubSpot triggers the duplicate warning with both CTAs functional.
- [ ] Successful create: product appears in local list with HubSpot product ID attached; verify by opening the record in HubSpot.
- [ ] Failed create: modal stays open, error visible, no local row.
- [ ] `hs_product_type` dropdown sends the correct stored value for Logistics, Primary Packaging, Secondary Packaging.
- [ ] Margin updates live as Unit price / Unit cost change.
- [ ] No console errors. No regression to the existing "Pull from HubSpot" search.

## What to bank / flag

In the audit-bank tradition, surface these in the PR description for future sweeps:

1. **HubSpot writeback adoption sweep.** If multiple HubSpot write paths exist, list every call site so a follow-up can consolidate them.
2. **Local-only state audit.** Search the codebase for any product creation that bypasses HubSpot. The old toggle pattern may have left dead branches.
3. **Schema drift check.** Compare the local product model's fields against the canonical HubSpot property names listed in the brief. Note any mismatches (e.g. `unitPrice` vs `price`).
4. **Open questions from the brief.** Restate questions 1–3 (scenario, leaf-type, units-per-pack) in the PR — these block Phase 4 and need product-owner input.

## PR / commit conventions

Match the existing step-numbered cadence. Title the PR something like *"step N: product modal HubSpot-first rewrite (Phase 1)"*. In the description, list:
- Scope (from this doc)
- Acceptance criteria checked off
- Banked findings (per "What to bank" above)
- Open questions still outstanding

Smoke before PR: create a product end-to-end, verify it lands in HubSpot, refresh, confirm the local list still shows it, then delete the test record from HubSpot.
