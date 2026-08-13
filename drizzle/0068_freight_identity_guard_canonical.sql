-- OD-017 · the freight identity guard validates through the GOVERNED identity.
--
-- `enforce_worksheet_freight_identity()` resolved a shipment member through
-- `NEW.assembly_leaf_id` — the legacy junction — and then required the member's
-- assembly to equal the shipment's assembly. Both halves are pre-OD-017
-- assumptions, and together they made the approved model unreachable at the
-- database layer even after `0066` and `0067`:
--
--   * A Direct Component has NO junction row, so `assembly_leaf_id` is NULL,
--     `related_quote` resolved to NULL, and the guard raised. That blocked a
--     Direct Component from joining ANY shipment — including an existing one,
--     which was believed to work after `0066` and did not.
--   * `sub_assembly <> related_assembly` cannot be satisfied by a MIXED
--     shipment holding both a Finished Product member and a Direct Component,
--     nor by a shipment with no assembly at all.
--
-- WHAT IS PRESERVED. Same-Quote enforcement, which is the guard's real job:
-- membership may never cross Quotes. That check is now made through
-- `quote_leaves.quote_id` — the same identity `freight_subcategory_items`
-- keys on since `0066` — so it validates the column actually being written
-- rather than a compatibility column that may legitimately be NULL.
--
-- WHAT IS DROPPED, and why deliberately. The assembly-equality clause. Under
-- the approved Product Structure model a shipment is a CONTAINER, not an
-- ASY-owned object: membership is quote-scoped, and one shipment may hold
-- governed leaves irrespective of whether they are Finished Product members or
-- Direct Components. The action layer already enforces quote-scoped
-- eligibility; this clause was the same assembly assumption expressed a second
-- time, one layer down, and it contradicted the model rather than defending it.
--
-- The `freight_destination_breaks` and `freight_customs_breaks` branches are
-- UNCHANGED, byte for byte. They validate tier-to-Quote agreement and have
-- nothing to do with product structure.
--
-- No trigger is dropped and no table is altered. Only the function body is
-- replaced, so all three guards keep firing on INSERT and UPDATE.

CREATE OR REPLACE FUNCTION enforce_worksheet_freight_identity() RETURNS trigger AS $$
DECLARE sub_quote uuid; related_quote uuid;
BEGIN
  IF TG_TABLE_NAME = 'freight_subcategory_items' THEN
    SELECT quote_id INTO sub_quote FROM freight_subcategories WHERE id = NEW.freight_subcategory_id;
    -- OD-017: resolve through the governed identity, not the legacy junction.
    SELECT quote_id INTO related_quote FROM quote_leaves WHERE id = NEW.quote_leaf_id;
  ELSIF TG_TABLE_NAME = 'freight_destination_breaks' THEN
    SELECT s.quote_id INTO sub_quote FROM freight_destinations d JOIN freight_subcategories s ON s.id = d.freight_subcategory_id WHERE d.id = NEW.freight_destination_id;
    SELECT quote_id INTO related_quote FROM quote_tiers WHERE id = NEW.tier_id;
  ELSE
    SELECT s.quote_id INTO sub_quote FROM freight_customs_entries e JOIN freight_subcategories s ON s.id = e.freight_subcategory_id WHERE e.id = NEW.freight_customs_entry_id;
    SELECT quote_id INTO related_quote FROM quote_tiers WHERE id = NEW.tier_id;
  END IF;
  IF sub_quote IS NULL OR related_quote IS NULL OR sub_quote <> related_quote THEN
    RAISE EXCEPTION 'worksheet freight identity must resolve to one Quote';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
