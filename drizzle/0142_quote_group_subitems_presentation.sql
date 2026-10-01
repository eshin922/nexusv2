-- Existing quotes keep their itemized member display. A draft can opt to
-- show only the priced group summary while preserving all accounting lines.
ALTER TABLE presentation_profile
  ADD COLUMN show_item_group_members boolean NOT NULL DEFAULT true;
