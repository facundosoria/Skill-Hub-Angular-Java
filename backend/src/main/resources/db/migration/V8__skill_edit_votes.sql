CREATE TABLE "skill_edit_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"voter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_edit_votes" ADD CONSTRAINT "skill_edit_votes_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_edit_votes" ADD CONSTRAINT "skill_edit_votes_version_id_skill_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."skill_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_edit_votes" ADD CONSTRAINT "skill_edit_votes_voter_id_users_id_fk" FOREIGN KEY ("voter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_edit_votes_version_voter_idx" ON "skill_edit_votes" USING btree ("version_id","voter_id");--> statement-breakpoint
CREATE INDEX "skill_edit_votes_version_idx" ON "skill_edit_votes" USING btree ("version_id");