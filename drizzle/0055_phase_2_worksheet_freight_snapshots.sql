CREATE TABLE "quote_snapshot_freight_workbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quote_snapshot_id" uuid NOT NULL REFERENCES "quote_snapshots"("id") ON DELETE CASCADE,
  "workbook" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "quote_snapshot_freight_workbooks_snapshot_idx" UNIQUE("quote_snapshot_id")
);
