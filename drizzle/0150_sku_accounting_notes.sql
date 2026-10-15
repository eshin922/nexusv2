ALTER TABLE "quote_leaves" ADD COLUMN "accounting_note" text;
--> statement-breakpoint
ALTER TABLE "quote_snapshot_lines" ADD COLUMN "accounting_note" text;
