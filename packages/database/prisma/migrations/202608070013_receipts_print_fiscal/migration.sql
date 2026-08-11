CREATE TYPE "FiscalDocumentStatus" AS ENUM ('NOT_REQUIRED','PENDING','ISSUED','FAILED','OFFLINE_PENDING','CANCELLED','CREDIT_NOTE','RECONCILED');
CREATE TYPE "PrintJobStatus" AS ENUM ('QUEUED','PRINTING','PRINTED','FAILED','CANCELLED');

CREATE TABLE "branch_receipt_sequences" (
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "business_date" DATE NOT NULL,
  "last_value" INTEGER NOT NULL DEFAULT 0 CHECK ("last_value" >= 0),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("branch_id", "business_date")
);

CREATE TABLE "receipts" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL UNIQUE REFERENCES "orders"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "business_date" DATE NOT NULL,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "receipt_number" VARCHAR(40) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "snapshot_hash" VARCHAR(64) NOT NULL CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$'),
  "rendered_html" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("branch_id", "business_date", "sequence"),
  UNIQUE ("branch_id", "receipt_number")
);
CREATE INDEX "receipts_branch_created_idx" ON "receipts"("branch_id","created_at");

CREATE TABLE "receipt_reprints" (
  "id" UUID PRIMARY KEY,
  "receipt_id" UUID NOT NULL REFERENCES "receipts"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL,
  "copies" INTEGER NOT NULL CHECK ("copies" BETWEEN 1 AND 5),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason")) > 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "receipt_reprints_receipt_created_idx" ON "receipt_reprints"("receipt_id","created_at");

CREATE TABLE "print_jobs" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "receipt_id" UUID NOT NULL REFERENCES "receipts"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'QUEUED',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "copies" INTEGER NOT NULL DEFAULT 1 CHECK ("copies" BETWEEN 1 AND 5),
  "target_printer" VARCHAR(120),
  "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
  "error_code" VARCHAR(80),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason")) > 0),
  "printed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "print_job_status_fields" CHECK (("status"='PRINTED' AND "printed_at" IS NOT NULL AND "error_code" IS NULL) OR ("status"='FAILED' AND "printed_at" IS NULL AND "error_code" IS NOT NULL) OR ("status" IN ('QUEUED','PRINTING','CANCELLED') AND "printed_at" IS NULL))
);
CREATE INDEX "print_jobs_branch_status_created_idx" ON "print_jobs"("branch_id","status","created_at");

CREATE TABLE "fiscal_documents" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "receipt_id" UUID NOT NULL UNIQUE REFERENCES "receipts"("id") ON DELETE RESTRICT,
  "created_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "provider_key" VARCHAR(80), "provider_receipt_no" VARCHAR(160), "provider_serial_no" VARCHAR(160),
  "provider_signature" TEXT, "provider_qr_data" TEXT, "machine_registration" VARCHAR(160),
  "provider_timestamp" TIMESTAMPTZ(3), "request_hash" VARCHAR(64), "response_hash" VARCHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 0 CHECK ("attempt_count" >= 0),
  "last_error_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_official_fields_guard" CHECK (
    ("status"='ISSUED' AND "provider_key" IS NOT NULL AND "provider_receipt_no" IS NOT NULL AND "provider_timestamp" IS NOT NULL)
    OR ("status"<>'ISSUED' AND "provider_receipt_no" IS NULL AND "provider_serial_no" IS NULL AND "provider_signature" IS NULL AND "provider_qr_data" IS NULL AND "machine_registration" IS NULL AND "provider_timestamp" IS NULL)
  )
);
CREATE INDEX "fiscal_documents_branch_status_created_idx" ON "fiscal_documents"("branch_id","status","created_at");

CREATE FUNCTION enforce_receipt_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_row "orders"%ROWTYPE; branch_org UUID; actor_org UUID;
BEGIN
  SELECT * INTO order_row FROM "orders" WHERE "id"=NEW."order_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id"=NEW."branch_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id"=NEW."created_by_id";
  IF order_row."branch_id"<>NEW."branch_id" OR order_row."business_date"<>NEW."business_date" OR order_row."currency"<>NEW."currency" OR order_row."status"<>'COMPLETED' OR branch_org<>actor_org THEN
    RAISE EXCEPTION 'receipt tenant, order, or completion mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipts_scope_guard BEFORE INSERT ON "receipts" FOR EACH ROW EXECUTE FUNCTION enforce_receipt_scope();

CREATE FUNCTION enforce_receipt_child_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_branch UUID; actor_org UUID; branch_org UUID; child_branch UUID;
BEGIN
  SELECT "branch_id" INTO receipt_branch FROM "receipts" WHERE "id"=NEW."receipt_id";
  IF TG_TABLE_NAME='receipt_reprints' THEN
    SELECT "organization_id" INTO actor_org FROM "users" WHERE "id"=NEW."actor_id";
  ELSE
    SELECT "organization_id" INTO actor_org FROM "users" WHERE "id"=NEW."created_by_id";
    child_branch := NEW."branch_id";
  END IF;
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id"=receipt_branch;
  IF receipt_branch IS NULL OR actor_org<>branch_org THEN
    RAISE EXCEPTION 'receipt child tenant mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME<>'receipt_reprints' AND child_branch<>receipt_branch THEN
    RAISE EXCEPTION 'receipt child tenant mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipt_reprints_scope_guard BEFORE INSERT ON "receipt_reprints" FOR EACH ROW EXECUTE FUNCTION enforce_receipt_child_scope();
CREATE TRIGGER print_jobs_scope_guard BEFORE INSERT ON "print_jobs" FOR EACH ROW EXECUTE FUNCTION enforce_receipt_child_scope();
CREATE TRIGGER fiscal_documents_scope_guard BEFORE INSERT ON "fiscal_documents" FOR EACH ROW EXECUTE FUNCTION enforce_receipt_child_scope();

CREATE FUNCTION enforce_print_job_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision"<>OLD."revision"+1 OR (NEW."id",NEW."branch_id",NEW."receipt_id",NEW."created_by_id",NEW."device_id",NEW."copies",NEW."target_printer") IS DISTINCT FROM (OLD."id",OLD."branch_id",OLD."receipt_id",OLD."created_by_id",OLD."device_id",OLD."copies",OLD."target_printer") THEN RAISE EXCEPTION 'invalid print job mutation' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD."status"='QUEUED' AND NEW."status" IN ('PRINTING','CANCELLED')) OR (OLD."status"='PRINTING' AND NEW."status" IN ('PRINTED','FAILED')) OR (OLD."status"='FAILED' AND NEW."status"='QUEUED')) THEN RAISE EXCEPTION 'invalid print job transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER print_jobs_lifecycle_guard BEFORE UPDATE ON "print_jobs" FOR EACH ROW EXECUTE FUNCTION enforce_print_job_lifecycle();

CREATE TRIGGER receipts_append_only BEFORE UPDATE OR DELETE ON "receipts" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER receipt_reprints_append_only BEFORE UPDATE OR DELETE ON "receipt_reprints" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER fiscal_documents_no_delete BEFORE DELETE ON "fiscal_documents" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
