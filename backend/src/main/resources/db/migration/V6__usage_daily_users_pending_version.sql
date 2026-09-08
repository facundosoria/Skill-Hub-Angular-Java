CREATE TABLE "usage_daily_users" (
	"day" date NOT NULL,
	"skill_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "usage_daily_users_day_skill_id_user_id_pk" PRIMARY KEY("day","skill_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "meta_snapshot" text;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "pending_version_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_daily_users" ADD CONSTRAINT "usage_daily_users_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily_users" ADD CONSTRAINT "usage_daily_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_daily_users_skill_day_idx" ON "usage_daily_users" USING btree ("skill_id","day");--> statement-breakpoint
ALTER TABLE "usage_daily" ADD COLUMN IF NOT EXISTS "distinct_users" integer DEFAULT 0 NOT NULL;
