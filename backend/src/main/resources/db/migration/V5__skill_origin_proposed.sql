CREATE TYPE "public"."origin" AS ENUM('human', 'agent');--> statement-breakpoint
ALTER TYPE "public"."status" ADD VALUE 'proposed' BEFORE 'published';--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "origin" "origin" DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "proposed_from_query" text;