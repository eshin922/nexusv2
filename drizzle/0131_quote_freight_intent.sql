-- Quote-level Setup decision: whether DPS arranges or quotes freight.
-- The enum is additive and defaults existing drafts to the honest unresolved
-- state. It records no lane, carrier, rate, shipment, or cost data.
--
-- Hand-authored because Drizzle's retained snapshot predates the already
-- journaled item-group-category authority cutover and prompts on that unrelated
-- assembly column when generating. This migration intentionally changes only
-- quotes.freight_intent.

CREATE TYPE "quote_freight_intent" AS ENUM ('undecided', 'include', 'exclude');
--> statement-breakpoint
ALTER TABLE "quotes"
  ADD COLUMN "freight_intent" "quote_freight_intent" NOT NULL DEFAULT 'undecided';
