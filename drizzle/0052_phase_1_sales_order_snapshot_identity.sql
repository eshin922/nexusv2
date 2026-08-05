ALTER TABLE "netsuite_so_pushes" ADD COLUMN "quote_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "netsuite_so_pushes" ADD CONSTRAINT "netsuite_so_pushes_quote_snapshot_id_quote_snapshots_id_fk" FOREIGN KEY ("quote_snapshot_id") REFERENCES "public"."quote_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
UPDATE "netsuite_so_pushes" push
SET "quote_snapshot_id" = snapshot."id"
FROM "quote_snapshots" snapshot
WHERE push."quote_id" = snapshot."quote_id"
  AND snapshot."superseded_at" IS NULL
  AND (
    SELECT count(*)
    FROM "quote_snapshots" candidate
    WHERE candidate."quote_id" = push."quote_id"
      AND candidate."superseded_at" IS NULL
  ) = 1;--> statement-breakpoint
DROP INDEX "netsuite_so_pushes_success_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "netsuite_so_pushes_success_unique_idx" ON "netsuite_so_pushes" USING btree ("quote_id") WHERE status = 'succeeded';--> statement-breakpoint
CREATE UNIQUE INDEX "netsuite_so_pushes_snapshot_success_unique_idx" ON "netsuite_so_pushes" USING btree ("quote_snapshot_id") WHERE status = 'succeeded' AND quote_snapshot_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "netsuite_so_pushes_snapshot_attempt_unique_idx" ON "netsuite_so_pushes" USING btree ("quote_snapshot_id") WHERE quote_snapshot_id IS NOT NULL;
