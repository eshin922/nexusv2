# Audit log free-text search does not reach the structured details

**Banked 2026-08-21. Traced, not repaired.** Held behind the locked training
sequence; not a blocker.

## Reproduced

Searching `24500` returns nothing, and the value is there:

```
rows matching in the columns searched today   0
rows matching in diff_json                    1
```

## Root cause — the search covers two columns

`src/app/admin/audit-log/page.tsx:55-59`:

```ts
const whereClause = query.length > 0
  ? or(
      ilike(auditLog.summary, `%${query}%`),
      ilike(auditLog.entityLabel, `%${query}%`),
    )
  : undefined;
```

`summary` and `entity_label` only. Not `diff_json`, and also not `entity_type`,
`entity_id`, `action`, or `actor_display_name` — so an operator searching a
quote id, a SKU, an action name, or a person also gets nothing unless the value
happens to appear in the summary prose.

The two searched columns each already carry a GIN trigram index, so the intent
was clearly free-text search; the structured payload was simply never included.

## Measured shape

| | |
|---|---|
| `diff_json` type | **`jsonb`** |
| rows | 3,664 |
| total `diff_json` as text | **607 kB** (avg 170 chars, max 3,536) |
| table total / heap / indexes | 2,672 kB / 1,768 kB / 760 kB |
| `pg_trgm` installed | **yes** — both existing trgm indexes use it |

## Smallest DB-side approach

**Add `diff_json::text` to the ILIKE set, and index that expression:**

```sql
CREATE INDEX audit_log_diff_json_trgm_idx
  ON audit_log USING gin ((diff_json::text) gin_trgm_ops);
```

```ts
or(
  ilike(auditLog.summary, `%${q}%`),
  ilike(auditLog.entityLabel, `%${q}%`),
  ilike(auditLog.entityType, `%${q}%`),
  ilike(auditLog.entityId, `%${q}%`),
  ilike(auditLog.action, `%${q}%`),
  ilike(auditLog.actorDisplayName, `%${q}%`),
  sql`${auditLog.diffJson}::text ILIKE ${`%${q}%`}`,
)
```

**Why the cast, and why an expression index.** A plain `diff_json::text ILIKE`
cannot use any existing index and forces a sequential scan. The expression index
makes exactly that predicate indexable, so the query planner can use it without
the query being rewritten into something cleverer.

**The JSON stays authoritative.** Nothing is serialized into prose and nothing is
denormalized into a display column — the cast happens inside the predicate, at
query time, and no stored representation changes. That was the explicit
constraint and it is also the cheaper design.

**Expected cost.** 607 kB of text; a GIN trigram index over it should land in the
low hundreds of kB against a 2.7 MB table. At this size even the unindexed scan
is a few milliseconds — the index matters for growth, not for today.

**Known limits, stated rather than discovered later:**

- Trigram indexes need **≥3 characters**; shorter queries fall back to a scan.
  Fine at 3,664 rows, worth revisiting past ~500k.
- `::text` searches the JSON *rendering*, so a query can match a **key name**
  (`"amount"`) as well as a value. Matching more than intended is the acceptable
  direction for free text; matching nothing is not.
- Numbers are matched as substrings: `4500` matches `24500`. Correct for
  free-text search, and the reason the separate structured filters must stay.

## Keep the filters distinct

Entity / User / Action / Date remain **exact structured filters**. Free text is
a broad contains-match across everything. Folding one into the other would make
a precise filter behave like a fuzzy one, and an operator narrowing by Action
should get exactly that action.

## Alternatives considered and rejected

- **`jsonb` containment (`@>`) / `jsonb_path_query`** — exact key/value matching,
  not substring. Cannot answer "find 24500 anywhere".
- **`tsvector` full-text** — tokenizes; would match `24500` as a whole token but
  not a substring inside a longer string, and adds a stored column or a heavier
  expression index for less applicable behaviour.
- **Serializing the record into display prose** — explicitly ruled out, and it
  would duplicate the authority into a second representation that can drift.

## Files

- `src/app/admin/audit-log/page.tsx:55-59` — the query.
- `audit_log.diff_json` — `jsonb`, unindexed for text.
- Existing precedent: `audit_log_summary_trgm_idx`,
  `audit_log_entity_label_trgm_idx`.
