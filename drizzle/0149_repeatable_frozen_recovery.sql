-- Multiple same-type charges on one product must freeze as separate
-- accounting instructions. The old uniqueness grain (snapshot, type, owner,
-- tier) rejected the second instance even though the projection had preserved
-- its charge_instance_id. Historical instructions without an instance retain
-- that original uniqueness rule.
--
-- A frozen instance UUID is provenance, not a live FK. ON DELETE SET NULL
-- would move two modern instructions into the legacy namespace and make later
-- deletion of the second draft charge fail. Keep the frozen UUID unchanged.
ALTER TABLE "quote_snapshot_recovery_instructions"
  DROP CONSTRAINT "quote_snapshot_recovery_instructions_charge_instance_id_fkey";
--> statement-breakpoint
ALTER TABLE "quote_snapshot_recovery_instructions"
  DROP CONSTRAINT "quote_snapshot_recovery_instructions_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_snapshot_recovery_instructions_instance_uq"
  ON "quote_snapshot_recovery_instructions" ("quote_snapshot_id", "charge_instance_id", "tier_id")
  WHERE "charge_instance_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "quote_snapshot_recovery_instructions_legacy_uq"
  ON "quote_snapshot_recovery_instructions" ("quote_snapshot_id", "charge_key", "owner_ref", "tier_id")
  WHERE "charge_instance_id" IS NULL;
