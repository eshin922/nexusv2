CREATE TYPE "public"."detail_level" AS ENUM('itemized', 'turnkey_only');--> statement-breakpoint
CREATE TYPE "public"."pdf_layout" AS ENUM('tier_table', 'single_tier');--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "pdf_layout" "pdf_layout";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "detail_level" "detail_level";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "include_spec_addendum" boolean;