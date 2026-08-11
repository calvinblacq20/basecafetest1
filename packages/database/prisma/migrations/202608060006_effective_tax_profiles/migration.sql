CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');
CREATE TYPE "TaxPriceMode" AS ENUM ('INCLUSIVE', 'EXCLUSIVE');
CREATE TYPE "TaxRoundingMode" AS ENUM ('HALF_UP', 'HALF_EVEN', 'DOWN');
CREATE TYPE "TaxRoundingScope" AS ENUM ('LINE', 'INVOICE');
CREATE TYPE "TaxProfileStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ACTIVE');

ALTER TABLE "tax_classes"
  ADD COLUMN "treatment" "TaxTreatment" NOT NULL DEFAULT 'OUT_OF_SCOPE';
ALTER TABLE "tax_classes" ALTER COLUMN "treatment" DROP DEFAULT;

CREATE TABLE "tax_profiles" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "confirmation_recorded_by_id" UUID,
    "activated_by_id" UUID,
    "key" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "status" "TaxProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "price_mode" "TaxPriceMode" NOT NULL,
    "rounding_mode" "TaxRoundingMode" NOT NULL,
    "rounding_scope" "TaxRoundingScope" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "approval_reference" VARCHAR(240),
    "confirmed_at" TIMESTAMPTZ(3),
    "activated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_profiles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_profiles_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "tax_profiles_key_check"
      CHECK ("key" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$'),
    CONSTRAINT "tax_profiles_currency_check"
      CHECK ("currency" ~ '^[A-Z]{3}$'),
    CONSTRAINT "tax_profiles_interval_check"
      CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from"),
    CONSTRAINT "tax_profiles_status_evidence_check" CHECK (
      (
        "status" = 'DRAFT'
        AND "approval_reference" IS NULL
        AND "confirmation_recorded_by_id" IS NULL
        AND "confirmed_at" IS NULL
        AND "activated_by_id" IS NULL
        AND "activated_at" IS NULL
      ) OR (
        "status" = 'CONFIRMED'
        AND "approval_reference" IS NOT NULL
        AND "confirmation_recorded_by_id" IS NOT NULL
        AND "confirmed_at" IS NOT NULL
        AND "activated_by_id" IS NULL
        AND "activated_at" IS NULL
      ) OR (
        "status" = 'ACTIVE'
        AND "approval_reference" IS NOT NULL
        AND "confirmation_recorded_by_id" IS NOT NULL
        AND "confirmed_at" IS NOT NULL
        AND "activated_by_id" IS NOT NULL
        AND "activated_at" IS NOT NULL
      )
    )
);

CREATE TABLE "tax_components" (
    "id" UUID NOT NULL,
    "tax_profile_id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "receipt_label" VARCHAR(80) NOT NULL,
    "rate_ppm" INTEGER NOT NULL,
    "calculation_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_components_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_components_code_check"
      CHECK ("code" ~ '^[A-Z0-9][A-Z0-9._-]{0,79}$'),
    CONSTRAINT "tax_components_rate_ppm_check"
      CHECK ("rate_ppm" BETWEEN 0 AND 1000000),
    CONSTRAINT "tax_components_calculation_order_check"
      CHECK ("calculation_order" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "tax_profiles_branch_id_key_effective_from_key"
  ON "tax_profiles"("branch_id", "key", "effective_from");
CREATE INDEX "tax_profiles_branch_id_status_effective_from_effective_to_idx"
  ON "tax_profiles"("branch_id", "status", "effective_from", "effective_to");
CREATE UNIQUE INDEX "tax_components_tax_profile_id_code_key"
  ON "tax_components"("tax_profile_id", "code");
CREATE UNIQUE INDEX "tax_components_tax_profile_id_calculation_order_key"
  ON "tax_components"("tax_profile_id", "calculation_order");

ALTER TABLE "tax_profiles"
  ADD CONSTRAINT "tax_profiles_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_profiles"
  ADD CONSTRAINT "tax_profiles_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_profiles"
  ADD CONSTRAINT "tax_profiles_confirmation_recorded_by_id_fkey"
  FOREIGN KEY ("confirmation_recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_profiles"
  ADD CONSTRAINT "tax_profiles_activated_by_id_fkey"
  FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_components"
  ADD CONSTRAINT "tax_components_tax_profile_id_fkey"
  FOREIGN KEY ("tax_profile_id") REFERENCES "tax_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "tax_profiles"
  ADD CONSTRAINT "tax_profiles_no_active_interval_overlap"
  EXCLUDE USING gist (
    "branch_id" WITH =,
    tstzrange(
      "effective_from",
      COALESCE("effective_to", 'infinity'::timestamptz),
      '[)'
    ) WITH &&
  ) WHERE ("status" = 'ACTIVE');

CREATE FUNCTION prevent_tax_profile_history_rewrite()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tax profiles cannot be deleted';
  END IF;

  IF OLD."status" = 'ACTIVE' THEN
    RAISE EXCEPTION 'active tax profiles are immutable';
  END IF;

  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'tax profile revisions must increment by exactly one';
  END IF;

  IF OLD."status" = 'CONFIRMED' THEN
    IF NEW."status" <> 'ACTIVE' THEN
      RAISE EXCEPTION 'confirmed tax profiles may only transition to active';
    END IF;
    IF ROW(
      NEW."branch_id",
      NEW."created_by_id",
      NEW."confirmation_recorded_by_id",
      NEW."key",
      NEW."name",
      NEW."price_mode",
      NEW."rounding_mode",
      NEW."rounding_scope",
      NEW."currency",
      NEW."effective_from",
      NEW."effective_to",
      NEW."approval_reference",
      NEW."confirmed_at",
      NEW."created_at"
    ) IS DISTINCT FROM ROW(
      OLD."branch_id",
      OLD."created_by_id",
      OLD."confirmation_recorded_by_id",
      OLD."key",
      OLD."name",
      OLD."price_mode",
      OLD."rounding_mode",
      OLD."rounding_scope",
      OLD."currency",
      OLD."effective_from",
      OLD."effective_to",
      OLD."approval_reference",
      OLD."confirmed_at",
      OLD."created_at"
    ) THEN
      RAISE EXCEPTION 'confirmed tax profile configuration is immutable';
    END IF;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'CONFIRMED') THEN
    RAISE EXCEPTION 'draft tax profiles must be confirmed before activation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tax_profiles_history_guard"
BEFORE UPDATE OR DELETE ON "tax_profiles"
FOR EACH ROW EXECUTE FUNCTION prevent_tax_profile_history_rewrite();

CREATE FUNCTION prevent_frozen_tax_component_change()
RETURNS trigger AS $$
DECLARE
  profile_status "TaxProfileStatus";
  target_profile_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_profile_id := OLD."tax_profile_id";
  ELSE
    target_profile_id := NEW."tax_profile_id";
  END IF;

  SELECT "status" INTO profile_status
  FROM "tax_profiles"
  WHERE "id" = target_profile_id;

  IF profile_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'components of a confirmed tax profile are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tax_components_history_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "tax_components"
FOR EACH ROW EXECUTE FUNCTION prevent_frozen_tax_component_change();
