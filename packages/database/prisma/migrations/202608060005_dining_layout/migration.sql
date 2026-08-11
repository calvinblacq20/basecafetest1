CREATE TABLE "dining_areas" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "external_key" VARCHAR(80),
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dining_areas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_areas_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "dining_areas_display_order_check" CHECK ("display_order" BETWEEN 0 AND 100000),
    CONSTRAINT "dining_areas_name_key_check" CHECK ("name_key" = lower(trim("name"))),
    CONSTRAINT "dining_areas_external_key_check"
      CHECK ("external_key" IS NULL OR "external_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$')
);

CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "dining_area_id" UUID NOT NULL,
    "external_key" VARCHAR(80),
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "combinable_group" VARCHAR(80),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "position_x" INTEGER,
    "position_y" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_tables_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "dining_tables_capacity_check" CHECK ("capacity" BETWEEN 1 AND 1000),
    CONSTRAINT "dining_tables_display_order_check" CHECK ("display_order" BETWEEN 0 AND 100000),
    CONSTRAINT "dining_tables_position_check"
      CHECK (
        ("position_x" IS NULL AND "position_y" IS NULL)
        OR ("position_x" BETWEEN 0 AND 10000 AND "position_y" BETWEEN 0 AND 10000)
      ),
    CONSTRAINT "dining_tables_name_key_check" CHECK ("name_key" = lower(trim("name"))),
    CONSTRAINT "dining_tables_external_key_check"
      CHECK ("external_key" IS NULL OR "external_key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$'),
    CONSTRAINT "dining_tables_combinable_group_check"
      CHECK ("combinable_group" IS NULL OR "combinable_group" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$')
);

CREATE UNIQUE INDEX "dining_areas_branch_id_id_key"
  ON "dining_areas"("branch_id", "id");
CREATE UNIQUE INDEX "dining_areas_branch_id_name_key_key"
  ON "dining_areas"("branch_id", "name_key");
CREATE UNIQUE INDEX "dining_areas_branch_id_external_key_key"
  ON "dining_areas"("branch_id", "external_key");
CREATE INDEX "dining_areas_branch_id_is_active_display_order_idx"
  ON "dining_areas"("branch_id", "is_active", "display_order");

CREATE UNIQUE INDEX "dining_tables_branch_id_name_key_key"
  ON "dining_tables"("branch_id", "name_key");
CREATE UNIQUE INDEX "dining_tables_branch_id_external_key_key"
  ON "dining_tables"("branch_id", "external_key");
CREATE INDEX "dining_tables_dining_area_id_is_active_display_order_idx"
  ON "dining_tables"("dining_area_id", "is_active", "display_order");
CREATE INDEX "dining_tables_branch_id_combinable_group_idx"
  ON "dining_tables"("branch_id", "combinable_group");

ALTER TABLE "dining_areas"
  ADD CONSTRAINT "dining_areas_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_branch_id_dining_area_id_fkey"
  FOREIGN KEY ("branch_id", "dining_area_id") REFERENCES "dining_areas"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
