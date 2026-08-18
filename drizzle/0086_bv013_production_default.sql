-- BV-013 Step 2 · the governed `Production` default, live at 40%.
--
-- ADDITIVE. One row. Nothing reads `Production` yet — Step 3 switches the
-- engine — so this must move NO economics, and the witness asserts that.
--
-- Deliberately its own step rather than folded into the cutover. If adding a
-- default that nothing consumes changes a number, something was already
-- resolving `Production` and the cutover's evidence would be contaminated by
-- it. Separating them makes that detectable instead of absorbed.
--
-- ── WHY 40% AND NOT A RENAME OF Manufacturing ─────────────────────────────
--
-- `Manufacturing` stays at 0.30 and stays live. It is not being renamed:
-- renaming would silently reprice anything still resolving it, and would erase
-- the row the Step 1 pin backfill derived every historical Production rate
-- from. This adds a NEW authority; Step 4 decides, on evidence, whether any
-- consumer of the old one remains.

INSERT INTO "markup_defaults" ("category", "default_markup_pct", "updated_at")
VALUES ('Production', 0.4000, now())
ON CONFLICT ("category") DO NOTHING;

COMMENT ON TABLE "markup_defaults" IS
  'Firm-wide markup by category. BV-013: `Production` is the SINGLE authority for all Production economics — Item Group production, Direct Service production, and Bulk Raw alike. Manufacturing / Raw ingredients are retained as historical and non-Production classifications; see docs/validation/bv-013-production-markup-migration-trace.md.';
