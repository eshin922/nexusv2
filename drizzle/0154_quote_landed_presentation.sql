CREATE TYPE "public"."quote_landed_presentation" AS ENUM('amortized', 'separate');
ALTER TABLE "quotes" ADD COLUMN "landed_presentation" "quote_landed_presentation" DEFAULT 'amortized' NOT NULL;
