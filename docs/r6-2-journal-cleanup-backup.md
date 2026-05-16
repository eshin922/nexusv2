# Drizzle journal incident recovery — R6.2 commit 1 (2026-05-15)

## What happened

`npm run db:migrate` after `drizzle-kit generate` of
`0026_r6_2_freight_legs_additive.sql` silently applied nothing —
drizzle's position-based comparison skipped the new entry
because the DB journal table had three extra rows beyond what
on-disk migrations accounted for.

CC's first diagnosis: those three "extra" rows were null-op
orphans (likely from a prior `drizzle-kit push` experiment).
Schema-state inventory (DB tables/columns/enums vs schema.ts)
showed zero drift, which CC took as confirmation. Edward
rubber-stamped the null-op claim. CC ran:

```sql
DELETE FROM drizzle.__drizzle_migrations WHERE id IN (26, 27, 28);
```

That broke `npm run db:migrate` — drizzle started trying to
re-apply migration 0023 (tier_recommended), colliding on the
existing `recommended` column.

## What we learned during recovery

Hash-matching every DB row against the LF-normalized SHA-256
of every on-disk file revealed the real mapping:

```
✓ id 1-18  → 0000-0017 (sequential)
✗ id 19    → orphan (97dd1fc6..., when 1777931859244)
✗ id 20    → orphan (7737b178..., when 1777935600000)
✓ id 21    → 0018_pullback_client_target.sql
✓ id 22    → 0019_ri_1_workspace_scenarios_audit_bulkraw.sql
✓ id 23    → 0020_ri_7_state_machine_admin_extension.sql
✗ id 24    → orphan (d7918d8c..., when 1778538000000)
✓ id 25    → 0022_careful_ogun.sql
✓ id 26    → 0023_tier_recommended.sql           ← DELETED in error
✓ id 27    → 0024_leaf_detach_auto_migrate_artifact.sql  ← DELETED in error
✓ id 28    → 0025_drop_auto_migrate_artifact.sql ← DELETED in error
```

The genuine orphans are ids **19, 20, 24** — not 26/27/28.
File `0021_quote_number_backfill.sql` is also a curiosity: it
exists on disk but no DB row has its hash, suggesting the file
was edited post-application or applied then reverted with
different content.

## Recovery executed

Restored the three deleted rows from this file's captured
values. Verified drizzle hash method = SHA-256 of LF-normalized
file content against three known migrations. Manually applied
`0026_r6_2_freight_legs_additive.sql` by executing its 17
statements in a single transaction and inserting a journal row
with the LF-normalized SHA-256 (`0759729e8d71c03b...`). DB id
of the new row: 29.

## Captured rows (the recovery point)

```
id  hash                                                              created_at
26  db78900f8ef680ea6d6823e5835871a51a70c3e80d98f9e7ccbce149e4e69664  1778651054196
27  bb79d074f9f44225482b89aebd2203c819118bf06f002b7d1b57dd2ca8390421  1778830000000
28  5fcc63cbd814ed376fbedf9a550584da171844141a055008dd962019e06a39eb  1778840000000
```

## Recovery SQL (if ever needed again)

```sql
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (26, 'db78900f8ef680ea6d6823e5835871a51a70c3e80d98f9e7ccbce149e4e69664', 1778651054196);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (27, 'bb79d074f9f44225482b89aebd2203c819118bf06f002b7d1b57dd2ca8390421', 1778830000000);
INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES (28, '5fcc63cbd814ed376fbedf9a550584da171844141a055008dd962019e06a39eb', 1778840000000);
```

## Outstanding cleanup (deferred follow-up)

Three genuine orphans remain in DB (`id IN (19, 20, 24)`).
They cause `npm run db:migrate` to silently skip new
migrations rather than apply them — this is why we had to
hand-apply 0026. To restore normal drizzle-kit migrate
behavior, the genuine orphans need to be deleted.

Before any future delete, the verification protocol is:

1. SELECT * the target rows; capture in a durable doc.
2. Compute LF-normalized SHA-256 of every on-disk migration
   file; confirm none of the target rows' hashes match.
3. Run the DELETE.
4. Verify subsequent `drizzle-kit migrate` operates normally.

Banked alongside in UX_BACKLOG "Drizzle journal hygiene"
entry.
