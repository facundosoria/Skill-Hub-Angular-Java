CREATE TYPE "public"."role" AS ENUM('admin', 'maintainer', 'member');--> statement-breakpoint
CREATE TYPE "public"."skill_type" AS ENUM('skill', 'convention', 'reference');--> statement-breakpoint
CREATE TYPE "public"."stack" AS ENUM('angular', 'java', 'shared', 'infra');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('draft', 'published', 'deprecated');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missed_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_text" text NOT NULL,
	"stack" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_related" (
	"skill_id" uuid NOT NULL,
	"related_skill_id" uuid NOT NULL,
	CONSTRAINT "skill_related_skill_id_related_skill_id_pk" PRIMARY KEY("skill_id","related_skill_id")
);
--> statement-breakpoint
CREATE TABLE "skill_tags" (
	"skill_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "skill_tags_skill_id_tag_pk" PRIMARY KEY("skill_id","tag")
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"preview" text,
	"frontmatter" text,
	"changelog" text,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"when_to_use" text NOT NULL,
	"stack" "stack" NOT NULL,
	"type" "skill_type" DEFAULT 'skill' NOT NULL,
	"status" "status" DEFAULT 'draft' NOT NULL,
	"owner_team" text,
	"superseded_by" uuid,
	"duplicate_justification" text,
	"current_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	CONSTRAINT "skills_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"day" date NOT NULL,
	"skill_id" uuid NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"distinct_users" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_day_skill_id_team_pk" PRIMARY KEY("day","skill_id","team")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid,
	"user_id" uuid,
	"team" text,
	"skill_id" uuid,
	"tool" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"team" text,
	"role" "role" DEFAULT 'member' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_related" ADD CONSTRAINT "skill_related_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_related" ADD CONSTRAINT "skill_related_related_skill_id_skills_id_fk" FOREIGN KEY ("related_skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_tags" ADD CONSTRAINT "skill_tags_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_superseded_by_skills_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."skills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "missed_created_idx" ON "missed_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "skill_tags_tag_idx" ON "skill_tags" USING btree ("tag");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_skill_version_idx" ON "skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE INDEX "skills_status_idx" ON "skills" USING btree ("status");--> statement-breakpoint
CREATE INDEX "skills_stack_idx" ON "skills" USING btree ("stack");--> statement-breakpoint
CREATE INDEX "usage_created_idx" ON "usage_events" USING btree ("created_at");