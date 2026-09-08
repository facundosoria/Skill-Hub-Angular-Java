ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "skill_versions" DROP CONSTRAINT "skill_versions_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT "skills_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "actor_snapshot" text;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;