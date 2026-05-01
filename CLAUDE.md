# Database client singleton (Drizzle + postgres-js)

The Drizzle client and underlying postgres pool are pinned to
`globalThis` in dev mode to survive Next.js HMR. Without this pin,
every code change to a module that touches `src/db/index.ts` creates a
new pool; old pools' connections leak until dev server termination.
After ~20 HMR cycles, Supabase's 200-connection limit is exhausted
(`EMAXCONN` error).

The pattern lives in `src/db/index.ts`. Production cold-starts skip the
pin (no `globalThis` stash) — each Vercel function gets a fresh pool,
which is correct.

Pool max is 10. At Nexus scale (single concurrent user typical), this
is plenty. The `Promise.all` queries in `getCostingBundle` and
`getQuoteCosting` serialize behind these 10 slots; they don't multiply
demand.

If you ever need to debug "out of connections" again, the diagnosis
order is: (1) restart dev server, (2) verify `globalThis` pin still in
place, (3) check for new code paths creating their own postgres
clients or calling `postgres()` directly (`src/db/index.ts:8` should
be the only call site).

Caught Slice 8 sub-step 5 — many file edits during the optimistic
computation work triggered enough HMR cycles to exhaust the pool.

# HubSpot token model

The codebase uses TWO separate HubSpot private app tokens:

- **`HUBSPOT_ACCESS_TOKEN`** — read-only token for production CRM. Used by Slices 2–11 for deal search, project import, deal context refresh. NEVER used for writes.
- **`HUBSPOT_WRITE_ACCESS_TOKEN`** — write-enabled token, added in Slice 12 only. Used exclusively by the Mark-Accepted writeback flow. Read paths must NOT use this token.

This separation is intentional: it makes accidental writes during development structurally impossible, not just unlikely.

## Customs / landed-cost data (Slice 6.5)

`quote_skus` carries three customs/landed-cost columns: `cbm_per_unit`,
`duty_pct`, `tariff_pct`. **These values are NEVER customer-facing.**
They are internal inputs to Slice 8's landed-freight rollup:

```
container_freight_per_unit = (sku.cbm_per_unit / total_shipment_cbm)
                              × line.total_freight
duty_per_unit              = sku_factory_cost × sku.duty_pct
tariff_per_unit            = sku_factory_cost × sku.tariff_pct
landed_freight_per_unit    = sum of the three above
displayed_freight_per_unit = landed_freight × (1 + line.markup_pct)

where
total_shipment_cbm = sum across SKUs in this freight line of
                     (sku.cbm_per_unit × effective_units_for_this_sku)
effective_units    = freight_inputs.units_in_shipment ?? tier.qty
                     (NULL means "use tier.qty"; documented Slice 7)
```

**Note on the formula:** there is intentionally NO `/ effective_units`
trailing the container-freight expression. The `(cbm/total_cbm) × $`
already has units of `$/unit` (the cbm ratio is per-unit since
`sku.cbm_per_unit` is per-unit). Adding another `/ effective_units`
would double-amortize. An earlier draft of this section had that
typo; corrected Slice 8 when the unit-test tree caught the
discrepancy. See `src/lib/costing.ts` for the canonical implementation.

Where `sku_factory_cost` = packaging unit cost + production amortized
service fees + production raw costs (respecting
`allocate_service_fees_to_cost`).

**Customer-facing visibility rules:**
- Customer PDF (Slice 11): show only "Freight: $X" per tier (with duty
  + tariff embedded silently) when `freight_treatment = pass_through`;
  invisible (folded into unit cost) when `bundled`.
- Internal Costing Sheet (Slice 8): MAY show duty/tariff/CBM
  decomposition for PM debugging.
- **Anywhere these values render in UI, label clearly with
  "Internal — not shown to customer" badge or equivalent visual cue.**
  See `customs-row.tsx` on the `/freight` page for the canonical
  treatment.

**Effective_units convention:** when `units_in_shipment` IS NULL on a
freight row, the cost rollup MUST use `tier.qty` for amortization. NULL
encodes "use tier qty" (the typical case); a value encodes a
yield-mismatch override (ship 10k raws to produce 5k finished). Slice 8
formula: `effective_units = freight_inputs.units_in_shipment ?? tier.qty`.

These three customs fields are populated by PM after confirming with
freight forwarder; often NULL during early quote drafting. Slice 8's
Costing Sheet should surface "incomplete landed cost" state when a SKU
on a freight line has any NULL among the three.

**Percent display convention:** `duty_pct` and `tariff_pct` (and
`markup_pct` on freight + packaging) are `numeric(5,4)` decimals in DB
(0.2500 = 25%). UI shows percent values (25); the action layer
divides/multiplies by 100 at the boundary. Display formatting strips
trailing zeros.

## Assembly rules (added Slice 5.5)

`quote_skus` is a tree, not a flat list. Each SKU has a `sku_role`:

- `leaf` — terminal. Cannot have children. Usually HubSpot-anchored.
- `assembly` — holds child SKUs. Can also be a child of another assembly
  (assembly nesting is supported). Often Nexus-local.

Whether an assembly represents a "formulation," "kit," "gift set," or
finished-goods bundle is captured by `cost_category` (Slice 9), **not**
by `sku_role`. The earlier `umbrella` / `formulation_assembly` split was
a category error and was collapsed before commit.

**Validation lives in `src/lib/sku-tree.ts` (`validateAssemblyOperation`).
All assembly-mutating actions call it.** Never mutate `parent_sku_id`,
`qty_per_parent`, or `sku_role` without going through the validator.

**Transitions:**
- `leaf → assembly`: always allowed (parent state preserved).
- `assembly → leaf`: refused if the SKU has children. PMs detach
  explicitly. No auto-detach.

**Cascade-aware audit:** `deleteSku` snapshots the full subtree (root +
all descendants) and counts cascading packaging_inputs BEFORE the FK
CASCADE fires. Single audit row per user action; `diff_json` carries the
forensic record. Pattern applies to any future action that triggers
cascade.

**HubSpot reference is optional now.** `hubspot_product_id` is nullable
since Slice 5.5. Leaf SKUs are typically HubSpot-anchored; assemblies
often aren't. Slice 12 writeback skips `hubspot_product_id IS NULL` rows.

See `docs/BOM_NOTES.md` for the full transition matrix, validation error
codes, and packaging interaction. See `docs/STRATEGIC_VISION.md` for the
v2 NetSuite-master direction this schema enables.

## audit_log.entity_id is text (added Slice 8, migration 0013)

`audit_log.entity_id` is a `text` column, not `uuid`. Supports both
shapes of PK:

- **UUID-PK entities** (`firm_settings`, `quotes`, `packaging_inputs`,
  `production_inputs`, `freight_inputs`, `quote_skus`, `quote_tiers`,
  `projects`, `users`): UUIDs cast to text losslessly. Existing audit
  rows from before migration 0013 are unchanged in value, just
  re-typed.
- **Text-PK entities** (`markup_defaults.category` today; future Slice
  9 cost-categories table, Slice 13 deal organizer tags, Slice 14
  scenario labels): the PK value goes directly into `entity_id`.

When auditing a row with a text PK, set `entity_id` to the PK value
directly. Do NOT synthesize a UUID and stash the real key in
`diff_json` — that pattern was the temporary bandaid this migration
made unnecessary, and querying "audit history for category X"
becomes a join-into-jsonb mess.

Compatible with the cascade-aware audit pattern (see Assembly rules
above): cascade snapshot diff_json shapes don't depend on the
entity_id column type.

Caught Slice 8 admin smoke-test 7: `INSERT INTO audit_log` with
`entity_id = 'Test Category'` rejected by the prior `uuid` type.
Migration 0013_wide_cassandra_nova converts via `entity_id::text`.

## Action result pattern (added Slice 5)

Server actions return structured results, never throw on expected failure
modes (state violations, validation, not-found). Reserve `throw` for
genuine bugs and Next.js intrinsics like `redirect()`.

```ts
type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
```

Server side: use `runAction(async () => {...})` from `@/lib/action-result`
to wrap action bodies. Inside, throw `ActionGuardError(code, message)` on
expected failures — runAction catches those and converts to a structured
`{ok: false, error}` return. Real bugs and `redirect()` propagate through.

Client side: surface `result.error.message` in UI; do not crash the page.
Pages that depend on a quote's editability should also disable inputs
**proactively** when `status !== 'draft'` (read-only mode), not just
react to action rejection. The action layer still validates server-side
(defense in depth — UI state can be stale).

This pattern replaced the older `throw new Error(...)` flow that surfaced
Next.js stack traces to end users.

## Admin role gating: page vs action (added Slice 8)

Same context-shaped split as `ActionResult` itself: page surfaces
redirect, action surfaces return structured errors. Two functions, both
DB-backed against `users.role`, but different failure modes because the
right UX differs by caller.

```ts
// src/lib/admin-guard.ts
requireAdminPage()    // for RSC / layout / page components
requireAdminAction()  // for server action bodies wrapped in runAction
```

`requireAdminPage()` throws `redirect("/?denied=admin")` on role
mismatch. Next intercepts; the browser navigates; the access-denied
banner surfaces on home. Right UX for someone fat-fingering an admin
URL. Use in `app/admin/layout.tsx` and any RSC under `/admin`.

`requireAdminAction()` throws `ActionGuardError(ERR.FORBIDDEN, "Admin
role required.")` which `runAction` converts to
`{ ok: false, error: { code: 'FORBIDDEN', ... } }`. Right UX for a POST
replay against an action endpoint: structured rejection the client can
handle without a forced navigation. Use at the top of every server
action body that mutates admin-managed data.

Why both: the layout-level redirect catches URL navigation; the
action-level gate catches direct POSTs against action IDs from
non-admin sessions (action endpoints are content-hashed but not
secret — anyone with a saved page DOM has the IDs). Both are the
real security boundary; they answer the same question with different
shapes for different callers.

Both functions go through `ensureUser()` and check `user.role` from
the database. `users.role` is the source of truth post-sign-in.
`ADMIN_EMAILS` env only seeds initial role assignment at first
sign-in; promotions/demotions made later don't auto-apply (by design
until Slice 17 ships proper user management).

Reference: `src/lib/admin-guard.ts`. Pattern instances:
`app/admin/layout.tsx` (page), every action in
`src/app/actions/firm-settings.ts` and `src/app/actions/markup-defaults.ts`
(action).

## Form state pattern (added Slice 5)

All auto-saving forms in Nexus use **controlled inputs + useActionState**,
not uncontrolled forms with onBlur handlers. This avoids React 19's
implicit form-reset behavior racing against RSC updates after server
actions complete.

Server actions that mutate row state return the full updated row, not
void. The client uses the returned row to hydrate controlled state.

This applies to: SKU rows, Tier rows, packaging input rows, production
input rows (Slice 6), freight input rows (Slice 7), Costing Sheet sell
price overrides (Slice 8+), notes textareas, and all settings forms.

Do not introduce uncontrolled forms with onBlur auto-save in any slice.
Same bug pattern, same fix.

## Save handler pattern (added Slice 5)

When a controlled input change triggers a save, the save function must
receive the new value as an explicit parameter from the change event —
NOT read it from a ref or state that may not have committed yet.

Wrong:
```tsx
onChange={(e) => { stateRef.current.category = e.target.value;
                   fireSave(); }}
// fireSave reads stateRef.current.category   // stale!
```

Right:
```tsx
onChange={(e) => { stateRef.current.category = e.target.value;
                   fireSave({ category: e.target.value }); }}
// fireSave uses the parameter directly       // fresh
```

This applies to every controlled input that triggers a save: SKU rows,
tier rows, packaging input rows, production input rows (Slice 6),
freight input rows (Slice 7), and all future cost-input forms.

Why this matters: `setState` is asynchronous and `useRef` reassignment
during render only takes effect on the *next* render. If a change
handler immediately calls a save function that reads from a ref, the
ref will still hold the previous value — producing an "off-by-one"
bug where each save sends the user's *previous* selection. Symptom in
the wild during Slice 5: PM picks Manufacturing → no auto-fill; picks
Primary → markup shows Manufacturing's 0.30; picks Soft Goods → markup
shows Primary's 0.40. Pattern is one step behind.

Fix is one line per onChange: capture `const v = e.target.value;`
before `setState(v)` and pass it as a `{field: v}` override to the
save function. The save merges overrides over the ref:
`const s = { ...stateRef.current, ...overrides };`.

## Server action ID invalidation after refactors

Next 15's server actions are content-hashed. Refactors that change
function bodies — including mechanical sweeps like swapping
`revalidatePath()` for `revalidateQuoteTree()` — invalidate every
action ID. Open browser tabs hold the old IDs and POST them on the
next edit.

After multiple occurrences across Slices 5.6, 7, 8 sub-steps 4 and 6,
this is the **established cure pattern, not an edge case**. Don't
diagnose; this happens on every meaningful refactor that touches
multiple action files or shared modules. Pattern is unavoidable in
Next 15 dev mode + content-hashed server actions. Production is
unaffected.

**Symptoms:**
- `TypeError: Cannot read properties of undefined (reading 'call')`
- `Failed to find Server Action <hash>` errors
- Stack trace points at any client component import

The TypeError surfaces in `__webpack_exec__` because Next's failure
path hits undefined. Misleading; the root cause is the action lookup
miss, not a real module error.

**Cure (do all four, in order, every time):**
1. `Ctrl+C` the dev server
2. `rm -rf .next node_modules/.cache`
3. `npm run dev`
4. Close ALL browser tabs on dev ports; open fresh tab on new port

Hard-refresh is NOT enough. Restart-only is NOT enough. Both must
happen.

If after the cure the error persists on a fresh tab in a clean
environment, then it's a real code issue and worth diagnosing.
Otherwise it's the action-ID hash drift and the cure is the answer.

After meaningful action-layer sweeps, warn the user before they hit
this in the browser.

## Drizzle aggregation queries

Use Drizzle's column-aware helpers (`count`, `max`, `min`, `sum`,
`avg`) for aggregations whenever possible. Do **NOT** use raw `sql<T>`
templates for aggregations that return non-string types (timestamps,
dates, booleans).

Wrong:
```ts
sql<Date | null>`max(${table.column})`     // type lies; runtime
                                            // returns ISO string
```

Right:
```ts
max(table.column)                          // properly typed Date | null
```

The TypeScript generic on `sql<T>` is an assertion, not a runtime
guarantee. Drizzle's column-aware helpers bind the column type and
return it correctly at runtime. Save raw `sql<T>` for cases the helpers
can't express, and verify the return type matches reality (typically
string from Postgres for non-text types — calling `.getTime()` or
`.toISOString()` on a string at runtime throws and 500s the request).

Discovered Slice 5.6 when `getCacheStatus` used `sql<Date | null>` for
`max(last_synced_at)`; the value came back as a string and crashed
`isStale`/the cache-status route on every populated-cache visit.
