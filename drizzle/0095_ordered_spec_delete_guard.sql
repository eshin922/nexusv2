-- Frozen ordered specs are immutable against DIRECT deletion, not only UPDATE.
--
-- 0094 blocked UPDATE and left DELETE open so the snapshot FK could cascade.
-- That quietly redefined "immutable" as "UPDATE-only immutable": any query with
-- write access could erase the record of what was ordered, and the trigger that
-- was supposed to protect it would not fire in a way that mattered.
--
-- WHY A TRIGGER CAN TELL THE TWO APART, AND HOW THAT WAS ESTABLISHED
--
-- `pg_trigger_depth()` reports trigger nesting. A DIRECT delete runs this
-- trigger as the outermost one (depth 1). An FK cascade runs the parent's
-- internal RI trigger FIRST, which then deletes the child — so this trigger
-- fires nested, at depth > 1.
--
-- Verified empirically before this was written, on real tables inside a rolled
-- back transaction, with both cases exercised:
--
--   direct DELETE on child        -> refused
--   parent DELETE cascading down  -> permitted, child removed
--
-- Reputation for this technique is not evidence, and the whole immutability
-- claim rests on it.
CREATE FUNCTION "qsls_forbid_direct_delete"() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION
      'quote_snapshot_leaf_specs is immutable: row % records what was ordered on a sent offer and cannot be deleted directly. It is removed only when its parent snapshot is, by cascade.',
      OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "qsls_no_direct_delete"
  BEFORE DELETE ON "quote_snapshot_leaf_specs"
  FOR EACH ROW EXECUTE FUNCTION "qsls_forbid_direct_delete"();
