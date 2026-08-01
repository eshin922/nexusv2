ALTER TABLE "quote_leaves" DROP CONSTRAINT "quote_leaves_assembly_id_assemblies_id_fk";
--> statement-breakpoint
ALTER TABLE "quote_leaves" ALTER COLUMN "assembly_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "assembly_leaves" ADD COLUMN "quote_leaf_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "assemblies_id_quote_idx" ON "assemblies" USING btree ("id","quote_id");
--> statement-breakpoint
ALTER TABLE "assembly_leaves" ADD CONSTRAINT "assembly_leaves_quote_leaf_id_quote_leaves_id_fk" FOREIGN KEY ("quote_leaf_id") REFERENCES "public"."quote_leaves"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_leaves" ADD CONSTRAINT "quote_leaves_assembly_quote_fk" FOREIGN KEY ("assembly_id","quote_id") REFERENCES "public"."assemblies"("id","quote_id") ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
CREATE UNIQUE INDEX "assembly_leaves_quote_leaf_idx" ON "assembly_leaves" USING btree ("quote_leaf_id");
--> statement-breakpoint
CREATE INDEX "quote_leaves_grouped_position_idx" ON "quote_leaves" USING btree ("quote_id","assembly_id","position","id");
--> statement-breakpoint
CREATE INDEX "quote_leaves_direct_position_idx" ON "quote_leaves" USING btree ("quote_id","position","id") WHERE assembly_id IS NULL;
