CREATE TABLE "user_surface_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"quote_id" uuid,
	"surface_key" text NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_surface_visits" ADD CONSTRAINT "user_surface_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_surface_visits" ADD CONSTRAINT "user_surface_visits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_surface_visits" ADD CONSTRAINT "user_surface_visits_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_surface_visits_unique_idx" ON "user_surface_visits" USING btree ("user_id","project_id","quote_id","surface_key");--> statement-breakpoint
CREATE INDEX "user_surface_visits_user_visited_idx" ON "user_surface_visits" USING btree ("user_id","visited_at");