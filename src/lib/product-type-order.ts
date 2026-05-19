import "server-only";
import { sql } from "drizzle-orm";
import { productTypes } from "@/db/schema";

// Phase A.1 v2 impl-5 patch round (Bug #L) — canonical ordering
// expression for product_types result sets that feed UI pickers.
//
// product_types has no `sort_order` column (impl-1 schema). Without
// explicit ORDER BY, Postgres returns rows in implementation-defined
// order — currently incidental insertion-order which matches the
// canonical taxonomy, but fragile against planner / vacuum changes.
//
// This expression encodes Edward §15.1 + §15.2 dispositions as a
// CASE statement; secondary sort by `name` ascending gives stable
// alphabetical fallback for any non-canonical IDs that land via
// future seed updates.
//
// Leaf-scope order (§15.2):
//   1. Primary packaging (PP)
//   2. Secondary packaging (SP)
//   3. Tertiary packaging (TP) — first-class per §15.2
//   4. Soft goods (visible placeholder)
//   5+. (hidden / unknown — alphabetical fallback)
//
// Assembly-scope order (§15.1, all visible):
//   11. Skincare
//   12. Supplement (oral)
//   13. Hair care
//   14. Color cosmetics
//   15. Body care
//   16. Beverage / functional drink
//   17. Pet care
//   18. Household / cleaning
//   19. Other
//
// Numeric gaps between scopes (1-4 / 11-19) leave room for future
// additions without renumbering. Unknown IDs fall to 99 + alphabetic.

export const productTypeOrderExpression = sql`
  case ${productTypes.id}
    when 'leaf_primary_packaging' then 1
    when 'leaf_secondary_packaging' then 2
    when 'leaf_tertiary_packaging' then 3
    when 'leaf_soft_goods' then 4
    when 'asy_skincare' then 11
    when 'asy_supplement' then 12
    when 'asy_haircare' then 13
    when 'asy_colorcosmetics' then 14
    when 'asy_body' then 15
    when 'asy_beverage' then 16
    when 'asy_pet' then 17
    when 'asy_household' then 18
    when 'asy_other' then 19
    else 99
  end
`;
