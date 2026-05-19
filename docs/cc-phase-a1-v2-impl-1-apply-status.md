# Phase A.1 v2 impl-1 — apply status

**Branch:** `slice-phase-a1-v2-impl-1-schema`
**Applied:** 2026-05-19
**Authorizer:** Edward (Pattern 22 backfill disposition + migration apply)

## What landed in the shared DB

### Schema migration (drizzle/0030_phase_a1_v2_schema_create.sql)

```
✓ Tables created (6/6):
  assemblies, assembly_leaves, leaf_specs, leaves,
  product_types, quote_leaves

✓ Enum created (1/1): product_type_scope

✓ Users columns added (2/2):
  can_edit_specs (boolean not null default false)
  can_create_leaves (boolean not null default false)

✓ Existing data integrity:
  quote_skus row count unchanged (30 rows)
```

### Seed SQL (drizzle/manual/0030_phase_a1_v2_seed.sql)

```
✓ product_types seed: 17 rows (9 ASY + 8 LEAF)
  - 3 LEAF first-class (PP, SP, TP)
  - 1 LEAF placeholder (Soft goods)
  - 4 LEAF hidden (migration targets)
  - TP starter field_schema present

⚠ User role grants: 0/7 rows updated (UPDATE no-ops)
  Cause: PMs/Logistics/Sales haven't signed in to the shared DB.
  Only `edward.shin@gmail.com` exists. The seed assumed `@thedps.co`
  domain per §15.3 dispositions; actual sign-in emails differ.
```

## User grants — open follow-up

The seed UPDATEs key on emails (`edward@thedps.co`, `jackie@thedps.co`,
etc.). The actual user emails in the shared DB will be whatever Clerk
maps for each user on first sign-in. Currently only Edward is present
(via gmail).

**Operational impact:** none right now. The
`spec-permission-guard.ts` admin-implicit-pass means Edward bypasses
the flags regardless. Non-admin team members haven't signed in yet;
when they do, they'll be created with default `false` on both flags.

**Resolution paths (pick when actual users sign in):**

(a) **Re-run the seed with corrected emails.** Edward provides the
   real Clerk-mapped emails for each user; CC patches the seed file
   + re-applies. Idempotent; safe to re-run.

(b) **Admin UI grant tool.** Phase A.1 v2 ships a future surface
   (impl-2+ scope) for admins to toggle these flags per user.
   No seed re-run needed; grants happen interactively post-sign-in.

(c) **Sign-in default + email-allowlist hook.** Modify `ensureUser`
   to consult a static `PHASE_A1_V2_GRANTS` map (similar to
   `ADMIN_EMAILS` env var pattern); first sign-in seeds the flags
   from the map. Self-correcting; pre-prod-tolerant.

CC lean: **(a) for v1 launch**, since Microsoft 365 OAuth (v1 path
item 5) hasn't shipped and the team isn't actively using Nexus dev
yet. When that lands, real emails surface; reseed once. (c) is over-
engineering for a 7-user firm; (b) is post-v1 polish.

## Migration apply commands (for ops audit trail)

```bash
# Schema migration
npm run db:migrate
# → drizzle/0030_phase_a1_v2_schema_create.sql applied via drizzle-kit

# Manual seed SQL (psql not on PATH; used Node + postgres-js)
node --env-file=.env.local scripts/apply-manual-sql.mjs \
  drizzle/manual/0030_phase_a1_v2_seed.sql

# Post-apply smoke
node --env-file=.env.local scripts/smoke-phase-a1-v2-apply.mjs
```

## What's NOT in impl-1 (deferred per dispositions)

- **Backfill SQL (§4.2 Steps 2-4)** — deferred to v1.1+ per Pattern
  32 pre-prod tolerance (Edward + CA disposition 2026-05-19).
  No real backfill data at risk; read-path branching in impl-2
  handles legacy quotes via existing `quote_skus`.

- **New write path activation (§4.2 Step 5)** — impl-2 scope.
  Server actions for ASY create / leaf attach / spec edit etc.
  land in `slice-phase-a1-v2-impl-2-setup-ia` (per brief §5
  Phase 2 sequencing).

- **Read-path branching (§4.2 Step 6)** — impl-2 scope. Quote
  rendering decides between legacy `quote_skus` path and new
  `assemblies` + `assembly_leaves` path based on presence of
  matching assemblies rows for the quote_id.

## Brief amendment follow-up

Per Edward's note (2026-05-19): brief v2 §4.2 Steps 2-4 still
reference the phantom `products` table. Strip + replace with:

> Backfill banked for v1.1+ per Pattern 32; new quotes use new
> model from impl-2 onwards via read-path branching.

Not urgent. CA folds into next amendment cycle or post-impl-1 merge.

## Gates for impl-1 merge

Per brief §5 Phase 1:

- [x] Architect §0.5 verification (5 gates resolved; PR #39)
- [x] Migration apply executes cleanly (smoke confirms)
- [x] Existing quotes data integrity preserved (quote_skus row count
      unchanged)
- [x] Typecheck PASS
- [x] Prebuild verify PASS (boundary guard clean; Pattern 47 clean)
- [ ] **Edward approval to open PR / merge**

Estimated v1.1+ work (separate slices, not blocking impl-1 close):
- Backfill SQL (v1.1+; pattern 32 defer)
- User role grants for real emails (resolution path (a) above)
- Brief v2 §4.2 amendment cycle
