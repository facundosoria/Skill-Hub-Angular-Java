CREATE TYPE "public"."locale" AS ENUM('es', 'en');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" "theme" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" "locale" DEFAULT 'es' NOT NULL;