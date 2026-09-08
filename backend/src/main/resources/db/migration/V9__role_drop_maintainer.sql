ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'::text;--> statement-breakpoint
-- El rol "maintainer" se elimina: comparte permisos con admin, así que las
-- cuentas que lo tuvieran pasan a member (admin queda como único rol con más
-- permisos que el resto).
UPDATE "users" SET "role" = 'member' WHERE "role" = 'maintainer';--> statement-breakpoint
DROP TYPE "public"."role";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'member');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'::"public"."role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role" USING "role"::"public"."role";