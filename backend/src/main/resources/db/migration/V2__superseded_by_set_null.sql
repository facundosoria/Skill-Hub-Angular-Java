ALTER TABLE "skills" DROP CONSTRAINT "skills_superseded_by_skills_id_fk";
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_superseded_by_skills_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;