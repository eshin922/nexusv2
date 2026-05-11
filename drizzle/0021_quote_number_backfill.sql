-- Slice RI.7 cleanup — backfill quote_number on sent quotes that
-- predate the sendQuote action.
--
-- Context: migration 0020 added quotes.quote_number + the
-- quote_number_seq sequence. RI.7's sendQuote action assigns
-- numbers at the draft → sent transition going forward. But the
-- shared DB had 3 quotes already at status='sent' (and similar
-- non-draft statuses) from before sendQuote existed, with NULL
-- quote_number. Per Edward's call (May 2026): backfill via the
-- sequence so existing sent quotes have customer-facing identifiers
-- consistent with future numbering. Sequence consumption is
-- trivial (3 rows on a v1 tool).
--
-- Order: the CTE orders by sent_at ASC NULLS LAST, then
-- created_at ASC. ⚠ KNOWN CAVEAT: PostgreSQL does NOT strictly
-- guarantee that the CTE's ORDER BY propagates into the JOIN UPDATE
-- → nextval() row-visit order. The CTE materializes the row set,
-- but the planner is free to choose how to scan the join, so
-- nextval() may fire in a different order than the CTE's ORDER BY.
-- In practice the order is mostly preserved (oldest gets lowest
-- number) but not strictly — when this migration ran against the
-- shared DB on 2026-05-11, the 3 rows assigned numbers as:
--    DPS-1000 (created 04:04:25 — oldest ✓)
--    DPS-1001 (created 04:49:16 — should have been DPS-1002)
--    DPS-1002 (created 04:19:59 — should have been DPS-1001)
-- Acceptable for v1 — these 3 quotes had NULL quote_number prior,
-- so customers never saw a number; whatever they get now is the
-- first number they'll ever see. Disposition (A) per Edward.
--
-- For future backfills where strict order matters, use
-- ROW_NUMBER() + arithmetic on a base value, or per-row UPDATE in
-- a procedural block. See CLAUDE.md "CTE → JOIN UPDATE → nextval
-- ordering caveat" for the convention.
--
-- Audit emission intentionally SKIPPED: this is a one-off data
-- retrofit, fully documented here, not a user-triggered write.
-- The action-layer audit pattern (action='quote_sent') doesn't
-- apply because the original send happened before sendQuote
-- existed; back-dating an audit row would be misleading.
--
-- Post-apply: verify:scenario-quote-invariant should return 0
-- violations across I-1/I-2/I-3/I-4 (was 3 I-4 violations
-- pre-backfill). Confirmed 2026-05-11.

WITH ordered AS (
  SELECT id
  FROM "quotes"
  WHERE "quote_number" IS NULL
    AND "status" IN ('sent', 'accepted', 'superseded', 'lost')
  ORDER BY "sent_at" ASC NULLS LAST, "created_at" ASC
)
UPDATE "quotes" q
SET "quote_number" = (
    SELECT "quote_number_prefix"
    FROM "firm_settings"
    WHERE "effective_until" IS NULL
  ) || '-' || nextval('quote_number_seq')
FROM ordered o
WHERE q.id = o.id;
