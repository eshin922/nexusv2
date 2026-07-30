# CC Comm — Slice 12 Step 3: tier-delete-path audit vs RESTRICT

**To:** Edward + CA
**From:** CC
**Re:** Proof that `quotes.accepted_tier_id → quote_tiers.id ON DELETE
RESTRICT` (shipped in PR #134) cannot block any current tier-delete
path.
**Status:** Confirmation memo — no code change. Post-merge audit
per Edward's request.

---

## §1 · TL;DR

**Safe.** Every tier-delete path in the codebase is guarded such that
the accepted_tier_id can only be NULL when the delete fires. RESTRICT
cannot trigger today; it will start protecting real data the moment
Step 8's Tier Selection Advance writes the first non-null
accepted_tier_id.

---

## §2 · Current DB state (baseline)

```
total quotes:                    56
  drafts:                        46
  sent:                          10
  accepted:                       0
  complete:                       0
quotes with accepted_tier_id set: 0
quotes with customer_accepted_tier_id set: 0
```

Zero quotes today have any non-null accepted_tier_id. The tighten
lands on empty territory — no existing row could possibly be blocked.

---

## §3 · All FKs targeting quote_tiers.id

```
assembly_leaf_inputs.tier_id              ON DELETE CASCADE
assembly_leaf_overrides.tier_id           ON DELETE CASCADE
assembly_leaf_targets.tier_id             ON DELETE CASCADE
assembly_production_inputs.tier_id        ON DELETE CASCADE
freight_leg_tiers.tier_id                 ON DELETE CASCADE
quote_warnings.tier_id                    ON DELETE CASCADE
pricing_events.violation_tier_id          ON DELETE SET NULL
quotes.accepted_tier_id                   ON DELETE RESTRICT ← new
quotes.customer_accepted_tier_id          ON DELETE SET NULL
```

Six CASCADEs (fan-out; child rows disappear with the tier — expected
+ correct). One SET NULL on pricing_events (permissive; historical
audit rows lose the tier pointer but the row survives). Two on
quotes: the new RESTRICT + the still-permissive
`customer_accepted_tier_id`.

Only **one** FK could block a tier delete: the new RESTRICT.

---

## §4 · Every quote_tier delete path in `src/`

`grep -rn "db\.delete(quoteTiers)\|delete\(.*quote_tiers"` returns
exactly two callers. Both guarded by `assertDraft`.

### Path A · `deleteTier` (`src/app/actions/quotes.ts:910-927`)

```ts
export async function deleteTier(formData: FormData) {
  ...
  const quote = await loadQuoteOrThrow(tier.quoteId);
  assertDraft(quote);   // ← throws QUOTE_NOT_DRAFT unless status === 'draft'
  await db.delete(quoteTiers).where(eq(quoteTiers.id, tierId));
  ...
}
```

Deletes a single tier by id. Blocked at the app layer for anything
other than draft. Drafts have `accepted_tier_id = NULL` by
construction (accepted_tier_id is only written at Mark Accepted /
Tier Selection Advance, both of which require prior `sent → accepted`
transition). Therefore the RESTRICT cannot fire — the referenced
quote's accepted_tier_id is guaranteed NULL.

### Path B · `applyTierPreset` (`src/app/actions/quotes.ts:1019-1169`)

```ts
export async function applyTierPreset(formData: FormData) {
  ...
  const quote = await loadQuoteOrThrow(quoteId);
  assertDraft(quote);   // ← same guard
  ...
  await tx.delete(quoteTiers).where(eq(quoteTiers.quoteId, quoteId));
  // reseed tiers from preset
  ...
}
```

Bulk-wipes all tiers for a quote then re-seeds from a preset. Same
draft-only invariant → same NULL accepted_tier_id → same immunity.

**No other tier-delete call sites exist.** Grep is exhaustive
(deletes go through Drizzle, not raw SQL, so `db.delete(quoteTiers)`
covers everything).

---

## §5 · Cascade paths that could delete quote_tiers indirectly

`quote_tiers.quoteId → quotes.id ON DELETE CASCADE`. If a quote is
deleted, all its tiers cascade — which could theoretically hit the
same quote's own RESTRICT (`accepted_tier_id → quote_tiers` while
the quote itself is being deleted).

**Ruled out:** `grep -rn "db\.delete(quotes)\|DELETE FROM quotes"`
in `src/` returns **zero results.** No production code path deletes
a quote row today. Admin-only quote deletion isn't wired.

(For completeness: even if this path existed, PG evaluates RESTRICT
at end-of-statement and would need special handling for the circular
same-transaction reference. But since we don't have the path at all,
this is moot.)

---

## §6 · Belt-and-braces

Post-Step-8, when a quote can legitimately have
`accepted_tier_id != NULL`:

- `deleteTier` still refuses via `assertDraft` — no `sent`,
  `accepted`, or `complete` quote can hit the tier-delete path
  through the UI.
- `applyTierPreset` same guard.
- If a future admin-unwind flow ever needs to delete an accepted
  tier row on an accepted/complete quote, RESTRICT is exactly the
  right protection: force the caller to null the accepted_tier_id
  pointer FIRST, then delete the tier. Silent-null-on-delete (the
  old SET NULL behavior) would have silently lost the accepted
  tier's identity — worse failure mode.

The RESTRICT ships as a v1 correctness net that only activates once
the write paths (Step 8) can populate the column.

---

## §7 · Verifier evidence recap

- 2 tier-delete call sites; both `assertDraft`-guarded
- 0 quote-delete call sites
- 0 quotes today with non-null accepted_tier_id
- Only new FK that could block = the RESTRICT we just added

No existing behavior changes; the tighten is inert until Step 8 wires
the writer. When it does, it protects the load-bearing "which tier
did the customer buy?" pointer from silent loss.
