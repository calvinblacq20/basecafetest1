-- Stable external keys allow menu-v1 CSV imports to be safely retried.
ALTER TABLE "categories" ADD COLUMN "external_key" VARCHAR(80);
ALTER TABLE "stations" ADD COLUMN "external_key" VARCHAR(80);
ALTER TABLE "menu_items"
  ADD COLUMN "external_key" VARCHAR(80),
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "menu_variants" ADD COLUMN "external_key" VARCHAR(80);

CREATE UNIQUE INDEX "categories_branch_id_external_key_key"
  ON "categories"("branch_id", "external_key");
CREATE UNIQUE INDEX "stations_branch_id_external_key_key"
  ON "stations"("branch_id", "external_key");
CREATE UNIQUE INDEX "menu_items_branch_id_external_key_key"
  ON "menu_items"("branch_id", "external_key");
CREATE UNIQUE INDEX "menu_variants_menu_item_id_external_key_key"
  ON "menu_variants"("menu_item_id", "external_key");

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_external_key_check"
  CHECK ("external_key" IS NULL OR "external_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$');
ALTER TABLE "stations"
  ADD CONSTRAINT "stations_external_key_check"
  CHECK ("external_key" IS NULL OR "external_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$');
ALTER TABLE "menu_items"
  ADD CONSTRAINT "menu_items_external_key_check"
  CHECK ("external_key" IS NULL OR "external_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$'),
  ADD CONSTRAINT "menu_items_sort_order_check"
  CHECK ("sort_order" BETWEEN 0 AND 100000);
ALTER TABLE "menu_variants"
  ADD CONSTRAINT "menu_variants_external_key_check"
  CHECK ("external_key" IS NULL OR "external_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$');

CREATE TABLE "catalog_imports" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "schema_version" VARCHAR(40) NOT NULL,
    "branch_code" VARCHAR(80) NOT NULL,
    "menu_code" VARCHAR(80) NOT NULL,
    "source_file_name" VARCHAR(255) NOT NULL,
    "source_hash" CHAR(64) NOT NULL,
    "validation_hash" CHAR(64) NOT NULL,
    "row_count" INTEGER NOT NULL,
    "result" JSONB NOT NULL,
    "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalog_imports_row_count_check" CHECK ("row_count" >= 0),
    CONSTRAINT "catalog_imports_source_hash_check" CHECK ("source_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "catalog_imports_validation_hash_check" CHECK ("validation_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "catalog_imports_branch_id_applied_at_idx"
  ON "catalog_imports"("branch_id", "applied_at");
CREATE INDEX "catalog_imports_source_hash_idx"
  ON "catalog_imports"("source_hash");

ALTER TABLE "catalog_imports"
  ADD CONSTRAINT "catalog_imports_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "catalog_imports"
  ADD CONSTRAINT "catalog_imports_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
