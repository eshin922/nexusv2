-- The DURABLE identity of the customer PDF, on the snapshot that owns it.
--
-- WHY THIS IS NOT ALREADY HERE, AND WHY THAT MATTERS
--
-- `quote_snapshots.pdf_url` is a 30-DAY SIGNED URL, and the code that mints it
-- says so: "internal-only; never handed to customer ... the file itself lives
-- forever". It is a convenience, not an identity.
--
-- The durable path lived ONLY in `audit_log.diff_json.pdf.storagePath`, reached
-- by matching versionNumber, with the existing resolver documenting a fall back
-- to "the most-recent row" when that match fails. An audit log is a record of
-- what happened, not an index for retrieving artifacts, and a packet that hands
-- Accounting the WRONG VERSION's PDF is worse than one that admits it cannot
-- resolve the right one.
--
-- Nullable on purpose. NULL means "this snapshot's artifact identity could not
-- be established", which is a state the packet route reports rather than
-- guesses around. Making it NOT NULL would force a value for the two historical
-- snapshots that have none, and inventing one is the failure this prevents.
ALTER TABLE "quote_snapshots" ADD COLUMN "pdf_storage_path" text;--> statement-breakpoint
ALTER TABLE "quote_snapshots" ADD COLUMN "pdf_storage_bucket" text;--> statement-breakpoint

-- BACKFILL — only where the evidence maps to exactly one snapshot.
--
-- Joined on quote_id AND version_number together. Verified before writing:
--   36 quote_sent rows, 35 carrying a storagePath, 29 carrying a versionNumber
--   0 (quote_id, version) pairs with more than one audit row
--   0 pairs whose rows disagree on the path
--   27 of 29 snapshots resolvable; 2 left NULL
--
-- No "most recent" fallback, by instruction and on merit: the fallback is
-- precisely how a revision's PDF would be attached to the order that preceded
-- it. The two unresolved snapshots stay unresolved.
UPDATE "quote_snapshots" s
   SET "pdf_storage_path"   = e.path,
       "pdf_storage_bucket" = e.bucket
  FROM (
    SELECT a.entity_id::uuid                        AS qid,
           (a.diff_json->>'versionNumber')::int     AS ver,
           a.diff_json->'pdf'->>'storagePath'       AS path,
           a.diff_json->'pdf'->>'bucket'            AS bucket
      FROM "audit_log" a
     WHERE a.action = 'quote_sent'
       AND a.diff_json->'pdf'->>'storagePath' IS NOT NULL
       AND a.diff_json->>'versionNumber'      IS NOT NULL
     GROUP BY 1,2,3,4
    HAVING COUNT(*) = 1
  ) e
 WHERE e.qid = s."quote_id"
   AND e.ver = s."version_number";
