ALTER TABLE "cash_movements"
  ADD COLUMN "corrects_movement_id" UUID;

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_corrects_movement_id_fkey"
  FOREIGN KEY ("corrects_movement_id")
  REFERENCES "cash_movements"("id")
  ON DELETE RESTRICT;

ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movement_correction_reference"
  CHECK (
    (
      "type" = 'CORRECTION'
      AND "corrects_movement_id" IS NOT NULL
      AND "corrects_movement_id" <> "id"
    ) OR (
      "type" <> 'CORRECTION'
      AND "corrects_movement_id" IS NULL
    )
  ) NOT VALID;

CREATE INDEX "cash_movements_corrects_movement_id_idx"
  ON "cash_movements"("corrects_movement_id");

CREATE OR REPLACE FUNCTION enforce_cash_movement_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  shift_row "staff_shifts"%ROWTYPE;
  corrected_row "cash_movements"%ROWTYPE;
  actor_org UUID;
  branch_org UUID;
BEGIN
  SELECT * INTO shift_row FROM "staff_shifts" WHERE "id" = NEW."shift_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."requested_by_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  IF shift_row."id" IS NULL OR shift_row."branch_id" <> NEW."branch_id"
     OR shift_row."status" <> 'OPEN' OR shift_row."currency" <> NEW."currency"
     OR actor_org IS NULL OR actor_org <> branch_org THEN
    RAISE EXCEPTION 'cash movement tenant, currency, or open shift mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."type" = 'CORRECTION' THEN
    SELECT * INTO corrected_row
      FROM "cash_movements"
      WHERE "id" = NEW."corrects_movement_id";
    IF corrected_row."id" IS NULL
       OR corrected_row."branch_id" <> NEW."branch_id"
       OR corrected_row."status" <> 'POSTED'
       OR corrected_row."currency" <> NEW."currency" THEN
      RAISE EXCEPTION 'cash correction must reference a posted movement in the same branch and currency' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION enforce_cash_movement_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" <> OLD."revision" + 1 OR
     (NEW."id", NEW."branch_id", NEW."shift_id", NEW."requested_by_id", NEW."type", NEW."direction",
      NEW."currency", NEW."amount_minor", NEW."corrects_movement_id", NEW."reference", NEW."evidence_note", NEW."reason", NEW."created_at")
     IS DISTINCT FROM
     (OLD."id", OLD."branch_id", OLD."shift_id", OLD."requested_by_id", OLD."type", OLD."direction",
      OLD."currency", OLD."amount_minor", OLD."corrects_movement_id", OLD."reference", OLD."evidence_note", OLD."reason", OLD."created_at") THEN
    RAISE EXCEPTION 'invalid cash movement mutation' USING ERRCODE = '23514';
  END IF;
  IF NOT (OLD."status" = 'AWAITING_APPROVAL' AND NEW."status" IN ('POSTED','REJECTED')) THEN
    RAISE EXCEPTION 'invalid cash movement transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
