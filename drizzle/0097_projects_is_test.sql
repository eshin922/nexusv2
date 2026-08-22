-- Deal Organizer · governed test-record flag.
--
-- WHY A COLUMN AND NOT A NAME MATCH
--
-- The organizer hides fixture deals by default. Until now the only signal was
-- the `ZZ-VALIDATION` name prefix, which is a heuristic, and widening it is
-- actively unsafe: `MISTR - Sachet Rollstock Test Roll` is a REAL customer deal
-- that any `%test%` match would hide. A queue that silently drops real work is
-- worse than one that shows fixtures.
--
-- So the flag is data, set once here from an explicit list, and read as a
-- column thereafter. No runtime name, prefix, substring or HubSpot-linkage
-- matching after this migration.
--
-- ADDITIVE and safe ahead of the code that reads it: the column has a NOT NULL
-- default, so every existing writer of `projects` continues to succeed without
-- mentioning it. (Deployment order is set by compatibility, not by convention —
-- a tightening migration would need a deployed-writer proof; this one does not.)
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "is_test" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

-- THE THIRTEEN, BY PROJECT ID.
--
-- Enumerated rather than matched, so this migration cannot capture a deal that
-- merely resembles a fixture. Three groups:
--
--   8 · ZZ-VALIDATION certification and UAT lineage projects
--   2 · Nexus-only fixtures with no HubSpot deal behind them
--       (`PSR-SMOKE-FIXTURE`, `SAMPLE-ORDER-AURORA-BOTANICA`; the placeholder
--        ids were used to FIND them, never to classify at runtime)
--   3 · CB walk artefacts named DELETE-ME, which carry real HubSpot ids
--
-- ALL THIRTEEN ARE KEYED ON `projects.id`. A first draft resolved the last five
-- by `hubspot_deal_id`, and a rolled-back dry run flagged 11 instead of 13: two
-- of those ids had been copied from a console listing that truncated them to 14
-- characters. Primary keys cannot be quietly truncated into a near-miss.
--
-- Left deliberately UNFLAGGED: `MISTR - Sachet Rollstock Test Roll`, a real
-- customer deal whose name contains "Test".
UPDATE "projects" SET "is_test" = true WHERE "id" IN (
  -- ZZ-VALIDATION certification lineage
  'd9dc519a-9965-4dd2-8b4a-f48cf2bf5a7a',  -- Nexus Certification Lineage
  '264d6160-e1fa-49ef-9b38-7140bf283c3c',  -- ... II (Direct Service)
  'e3791f00-29e2-494a-b82e-f9a772afceff',  -- ... III (Direct Service)
  '1f0aa7c5-b181-48b8-876c-f9ee9d665f09',  -- ... IV (Terminal Integration)
  '350456fc-f246-4146-91ed-d384332250fc',  -- ... V
  'f9d028b7-5349-40e0-aa7b-fbd114bb97a7',  -- UAT Case 1 (Direct Product)
  'c95e03e6-9582-48e1-aef0-9e27872617fa',  -- UAT Case 5 (Tooling / Artwork split)
  '255652dd-c06a-46c4-92ed-8c08a4448d70',  -- UAT Case 6 (Mixed commercial structure)
  -- Nexus-only fixtures, no HubSpot deal behind them
  'fdda94cd-2c19-45e6-b88e-58f701e64de3',  -- PSR Smoke Test
  'deba55c5-50d4-432e-bf03-37723807111f',  -- SAMPLE - Aurora Botanica
  -- CB walk artefacts
  'c0e59701-9953-4b26-bdd8-2d13ba87bfa2',  -- SMOKE-CB-8B-DELETE-ME
  'c8a97f21-e0e7-4793-98b3-d070b23e2ed5',  -- SMOKE-CB-DELETE-ME
  '4835833e-674d-4814-9838-736e4ec33294'   -- SMOKE-CB-STEP10-DELETE-ME
);
