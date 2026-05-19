CREATE TYPE "public"."product_type_scope" AS ENUM('assembly', 'leaf');--> statement-breakpoint
CREATE TABLE "assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"pack_label" text,
	"product_type_id" text,
	"description" text,
	"url" text,
	"image_url" text,
	"unit_price" numeric,
	"unit_cost" numeric,
	"margin_pct" numeric,
	"markup_pct" numeric,
	"tax_schedule_id" uuid,
	"owner_id" uuid,
	"fsc_claim" boolean,
	"fsc_status" text,
	"supplier_verified" boolean,
	"internal_notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"leaf_id" uuid NOT NULL,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"parent_assembly_leaf_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaf_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"leaf_id" uuid NOT NULL,
	"spec_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"url" text,
	"image_url" text,
	"product_type_id" text,
	"unit_cost" numeric,
	"fsc_claim" boolean,
	"fsc_status" text,
	"supplier_verified" boolean,
	"owner_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scope" "product_type_scope" NOT NULL,
	"description" text,
	"field_schema" jsonb,
	"placeholder" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quote_id" uuid NOT NULL,
	"assembly_id" uuid NOT NULL,
	"leaf_id" uuid NOT NULL,
	"leaf_spec_version_id" uuid,
	"pinned_at" timestamp with time zone,
	"quantity" numeric DEFAULT '1' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_edit_specs" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_create_leaves" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaves" ADD CONSTRAINT "assembly_leaves_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaves" ADD CONSTRAINT "assembly_leaves_leaf_id_leaves_id_fk" FOREIGN KEY ("leaf_id") REFERENCES "public"."leaves"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_leaves" ADD CONSTRAINT "assembly_leaves_parent_assembly_leaf_id_assembly_leaves_id_fk" FOREIGN KEY ("parent_assembly_leaf_id") REFERENCES "public"."assembly_leaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaf_specs" ADD CONSTRAINT "leaf_specs_leaf_id_leaves_id_fk" FOREIGN KEY ("leaf_id") REFERENCES "public"."leaves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaf_specs" ADD CONSTRAINT "leaf_specs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaf_specs" ADD CONSTRAINT "leaf_specs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_product_type_id_product_types_id_fk" FOREIGN KEY ("product_type_id") REFERENCES "public"."product_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_leaves" ADD CONSTRAINT "quote_leaves_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_leaves" ADD CONSTRAINT "quote_leaves_assembly_id_assemblies_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assemblies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_leaves" ADD CONSTRAINT "quote_leaves_leaf_id_leaves_id_fk" FOREIGN KEY ("leaf_id") REFERENCES "public"."leaves"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_leaves" ADD CONSTRAINT "quote_leaves_leaf_spec_version_id_leaf_specs_id_fk" FOREIGN KEY ("leaf_spec_version_id") REFERENCES "public"."leaf_specs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assemblies_quote_sku_idx" ON "assemblies" USING btree ("quote_id","sku");--> statement-breakpoint
CREATE INDEX "assemblies_quote_position_idx" ON "assemblies" USING btree ("quote_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "assembly_leaves_top_level_unique_idx" ON "assembly_leaves" USING btree ("assembly_id","leaf_id") WHERE parent_assembly_leaf_id IS NULL;--> statement-breakpoint
CREATE INDEX "assembly_leaves_assembly_position_idx" ON "assembly_leaves" USING btree ("assembly_id","position");--> statement-breakpoint
CREATE INDEX "assembly_leaves_leaf_idx" ON "assembly_leaves" USING btree ("leaf_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leaf_specs_current_idx" ON "leaf_specs" USING btree ("leaf_id") WHERE is_current = true;--> statement-breakpoint
CREATE INDEX "leaf_specs_leaf_version_idx" ON "leaf_specs" USING btree ("leaf_id","version_number");--> statement-breakpoint
CREATE INDEX "leaves_product_type_idx" ON "leaves" USING btree ("product_type_id") WHERE archived = false;--> statement-breakpoint
CREATE INDEX "leaves_sku_idx" ON "leaves" USING btree ("sku") WHERE archived = false;--> statement-breakpoint
CREATE INDEX "product_types_scope_idx" ON "product_types" USING btree ("scope") WHERE hidden = false;--> statement-breakpoint
CREATE INDEX "quote_leaves_quote_idx" ON "quote_leaves" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quote_leaves_leaf_version_idx" ON "quote_leaves" USING btree ("leaf_id","leaf_spec_version_id");