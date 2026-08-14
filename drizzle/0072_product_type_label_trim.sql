-- B-8 · trim "packaging" from the leaf Product Type labels.
--
--   Primary packaging (PP)   -> Primary (PP)
--   Secondary packaging (SP) -> Secondary (SP)
--   Tertiary packaging (TP)  -> Tertiary (TP)
--
-- Part of the same density reduction: these labels sit in the member row's
-- type cell, and the repeated word is the longest part of each one while
-- carrying no information the parenthesised code does not already carry.
--
-- IDS ARE UNCHANGED. `product_types.id` is the referenced key
-- (leaves.product_type_id, leaf_specs.product_type_id) and stays
-- leaf_primary_packaging etc. This is display text only — no row is
-- re-pointed and no classification changes.
--
-- CUSTOMER-VISIBLE. product_types.name is read by addendum-loader.ts, which
-- builds the customer PDF spec addendum, so this text reaches customers on
-- future renders. Flagged rather than assumed internal.
UPDATE "product_types" SET "name" = 'Primary (PP)'   WHERE "id" = 'leaf_primary_packaging';
UPDATE "product_types" SET "name" = 'Secondary (SP)' WHERE "id" = 'leaf_secondary_packaging';
UPDATE "product_types" SET "name" = 'Tertiary (TP)'  WHERE "id" = 'leaf_tertiary_packaging';
