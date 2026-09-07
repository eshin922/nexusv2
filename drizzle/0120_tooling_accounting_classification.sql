-- Component-owned charges reach NetSuite: the accounting authority.
--
-- Their economics were governed all the way through Send and then stopped.
-- `projection-readiness` refused every one with
-- `component_destination_ungoverned` — correctly, because nothing said which
-- BV-011 destination a component charge posts to. O3 was the first order to
-- reach it.
--
-- ── WHY TOOLING NEEDS A COLUMN AND THE OTHER FOUR DO NOT ─────────────────
--
-- Four component charge types name exactly one destination, so they are a code
-- map with nothing to persist. `tooling` is authored as "Tooling & dies" —
-- "cutting die, mould or collar" — and BV-011 governs a cutting die and a mould
-- as DIFFERENT destinations. One map entry would book every die as a mould.
-- That is the shape §4.2 already records for the legacy `Tooling / artwork`
-- column, which is non-elective for exactly this reason.
--
-- So the fact lives on the INSTANCE, recorded by an operator. It is never
-- inferred from the owner, the SKU, the component type, the label or the
-- amount: a bottle's tooling is usually a mould, and "usually" is not an
-- accounting authority.
--
-- ── NULLABLE, AND WHAT NULL MEANS ────────────────────────────────────────
--
-- NULL is "not yet classified", which is a legitimate state for an in-progress
-- charge and the only possible state for every instance that predates this
-- migration. It is never a third classification and never resolves to a
-- destination.
--
-- Whether NULL blocks anything depends on the RECOVERY treatment, which is a
-- separate authority: an `included` charge emits no accounting line, so it
-- needs no destination and is sendable unclassified. A `separate` one is
-- refused until an operator states which it is.
--
-- No backfill. Deriving a classification for the 0 existing Tooling instances
-- would be inventing the fact this column exists to record.

ALTER TYPE "public"."bv011_destination" ADD VALUE IF NOT EXISTS 'otc_mould';--> statement-breakpoint
CREATE TYPE "public"."tooling_classification" AS ENUM ('mould_collar', 'cutting_die');--> statement-breakpoint

ALTER TABLE "quote_charge_instances"
  ADD COLUMN "tooling_classification" "public"."tooling_classification";--> statement-breakpoint

-- Only a Tooling charge may carry one. A classification on a Print plates
-- instance would be a fact about nothing, and would read as authority the next
-- time someone looked for one.
ALTER TABLE "quote_charge_instances"
  ADD CONSTRAINT "quote_charge_instances_tooling_classification_scope"
  CHECK ("tooling_classification" IS NULL OR "charge_key" = 'tooling');
