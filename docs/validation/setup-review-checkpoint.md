# Setup review checkpoint

The implemented route keeps the current quote graph as the source of truth. A
new Primary draft and its first tier are created atomically; the submission key
is claimed in the same transaction, and a retry of that same form submission
returns the original quote. The project row is locked while the next Primary
version is selected.

Once the draft opens, existing Setup actions continue to save supported
structural changes against that quote. The `Review setup` step is a read-only
checkpoint over the current HubSpot product types, pinned specification state,
groups and member quantities, tiers, owned charge identities, and the two
separate note audiences. It does not submit a second graph, alter costs, or
change charge amounts. An incomplete graph remains an explicitly resumable
draft at its stable `/setup` URL. The older bare quote URL remains a compatibility alias.

This deliberately uses the platform's persisted-draft recovery path rather
than copying the prototype's browser-local state and delayed bulk commit. It
does not recreate product, attachment, charge, spec-pin, or tier identities.
Freight intention is the one new quote-level Setup fact: `quotes.freight_intent`
is persisted by migration `0131_quote_freight_intent.sql` and edited on Setup.
Setup owns only the quote-wide include / exclude / decide-later choice; shipment
contents, destinations, carriers, rates and customs remain owned by Freight.
Review reads the saved choice and has no writer.

New-quote creation, project resume links, Pricing return navigation, the scenario rail, and the surface-route map all use `/setup` as the canonical Setup destination. The `/setup` page resolves to the existing live Setup editor; the bare quote route is retained for older links.

## Verification

- Setup entrypoint and review checkpoint contract: `tests/unit/setup-entrypoint-idempotency.test.ts`.
- HubSpot classification and existing Setup wiring: `tests/unit/hubspot-product-type-fidelity.test.ts`, `tests/unit/product-setup-wiring.test.ts`.
- Setup → Review → Costs → Pricing browser handoff: `tests/e2e/setup/setup-review-handoff.spec.ts` (isolated validation DB; restores the quote's original freight intention).
- Setup tier add/edit/review/open-Costs/remove round trip: the same browser suite adds one temporary tier, confirms it is present in Review and Costs, deletes it through Setup, and verifies that the fixture's original tier IDs, labels, quantities, order, and every existing packaging cost-cell identity/value are unchanged. The new tier receives empty cost cells. A `finally` cleanup removes only the temporary tier if the browser assertion fails.
- Local rendered route checked at `/projects/:id/quotes/:quoteId/setup/review` against the isolated browser-validation database. The browser acceptance temporarily changes freight intent on its validation quote, then restores the original value in `finally`.
- `npm run verify:types` and `npm run verify:boundaries` pass.

This validates the saved freight-intention handoff and the route path, plus a non-destructive tier edit cycle that preserves existing packaging costs. The wider M4 structural-edit scenario matrix and full Setup → Costs → Pricing acceptance across products, groups, services, charges, and retries remain part of the staged implementation gate.
