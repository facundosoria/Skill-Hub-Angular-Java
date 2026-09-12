CREATE TABLE "catalog_file_blobs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "sha256" char(64) NOT NULL,
    "content" bytea NOT NULL,
    "size_bytes" bigint NOT NULL CHECK ("size_bytes" > 0),
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "catalog_file_blobs_sha256_unique" UNIQUE("sha256")
);

CREATE TABLE "catalog_version_artifacts" (
    "skill_version_id" uuid PRIMARY KEY NOT NULL,
    "blob_id" uuid NOT NULL,
    "file_name" text NOT NULL,
    "content_type" text NOT NULL,
    "created_by" uuid,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "catalog_version_artifacts"
    ADD CONSTRAINT "catalog_version_artifacts_skill_version_id_fk"
    FOREIGN KEY ("skill_version_id") REFERENCES "public"."skill_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "catalog_version_artifacts"
    ADD CONSTRAINT "catalog_version_artifacts_blob_id_fk"
    FOREIGN KEY ("blob_id") REFERENCES "public"."catalog_file_blobs"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "catalog_version_artifacts"
    ADD CONSTRAINT "catalog_version_artifacts_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "catalog_version_artifacts_blob_idx" ON "catalog_version_artifacts" USING btree ("blob_id");
