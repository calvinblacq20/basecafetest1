CREATE TYPE "RefundBalanceStatus" AS ENUM ('NONE','PARTIAL','FULL');
CREATE TYPE "RefundKind" AS ENUM ('REFUND','REVERSAL','CHARGEBACK','DISPUTE');
CREATE TYPE "RefundStatus" AS ENUM ('AWAITING_APPROVAL','PENDING_PROVIDER','CONFIRMED','FAILED','REJECTED');

ALTER TABLE "orders" ADD COLUMN "refund_status" "RefundBalanceStatus" NOT NULL DEFAULT 'NONE';
ALTER TABLE "payments" ADD COLUMN "refund_status" "RefundBalanceStatus" NOT NULL DEFAULT 'NONE';

CREATE TABLE "refunds" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "payment_id" UUID NOT NULL REFERENCES "payments"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "shift_id" UUID NOT NULL REFERENCES "staff_shifts"("id") ON DELETE RESTRICT,
  "requested_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "resolved_by_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  "kind" "RefundKind" NOT NULL DEFAULT 'REFUND',
  "status" "RefundStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
  "fiscal_status" "FiscalDocumentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">0),
  "currency" CHAR(3) NOT NULL,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor">0 AND "amount_minor"<=2000000000),
  "evidence_note" VARCHAR(500) NOT NULL CHECK (length(trim("evidence_note"))>0),
  "provider_reference" VARCHAR(160),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason"))>0),
  "confirmed_at" TIMESTAMPTZ(3), "failed_at" TIMESTAMPTZ(3), "rejected_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refund_status_timestamps" CHECK (
    ("status"='CONFIRMED' AND "confirmed_at" IS NOT NULL AND "failed_at" IS NULL AND "rejected_at" IS NULL)
    OR ("status"='FAILED' AND "failed_at" IS NOT NULL AND "confirmed_at" IS NULL AND "rejected_at" IS NULL)
    OR ("status"='REJECTED' AND "rejected_at" IS NOT NULL AND "confirmed_at" IS NULL AND "failed_at" IS NULL)
    OR ("status" IN ('AWAITING_APPROVAL','PENDING_PROVIDER') AND "confirmed_at" IS NULL AND "failed_at" IS NULL AND "rejected_at" IS NULL)
  ),
  CONSTRAINT "refund_fiscal_disabled" CHECK ("fiscal_status"='NOT_REQUIRED')
);
CREATE INDEX "refunds_branch_status_created_idx" ON "refunds"("branch_id","status","created_at");
CREATE INDEX "refunds_payment_status_idx" ON "refunds"("payment_id","status");
CREATE INDEX "refunds_shift_status_idx" ON "refunds"("shift_id","status");

CREATE TABLE "refund_approvals" (
  "id" UUID PRIMARY KEY, "refund_id" UUID NOT NULL UNIQUE REFERENCES "refunds"("id") ON DELETE RESTRICT,
  "approver_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT, "device_id" UUID NOT NULL,
  "decision" VARCHAR(16) NOT NULL CHECK ("decision" IN ('APPROVE','REJECT')),
  "evidence_note" VARCHAR(500) NOT NULL CHECK (length(trim("evidence_note"))>0),
  "reason" VARCHAR(500) NOT NULL CHECK (length(trim("reason"))>0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "refund_receipts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "refund_id" UUID NOT NULL UNIQUE REFERENCES "refunds"("id") ON DELETE RESTRICT,
  "snapshot" JSONB NOT NULL, "snapshot_hash" VARCHAR(64) NOT NULL CHECK ("snapshot_hash"~'^[a-f0-9]{64}$'),
  "rendered_html" TEXT NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION enforce_refund_scope_and_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "payments"%ROWTYPE; s "staff_shifts"%ROWTYPE; actor_org UUID; branch_org UUID; confirmed BIGINT; reserved BIGINT;
BEGIN
  SELECT * INTO p FROM "payments" WHERE "id"=NEW."payment_id";
  SELECT * INTO s FROM "staff_shifts" WHERE "id"=NEW."shift_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id"=NEW."requested_by_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id"=NEW."branch_id";
  IF p."status"<>'CONFIRMED' OR p."branch_id"<>NEW."branch_id" OR p."order_id"<>NEW."order_id" OR p."currency"<>NEW."currency" OR s."branch_id"<>NEW."branch_id" OR s."status"<>'OPEN' OR actor_org<>branch_org THEN RAISE EXCEPTION 'refund tenant, payment, currency, or shift mismatch' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(SUM("amount_minor"),0) INTO confirmed FROM "refunds" WHERE "payment_id"=NEW."payment_id" AND "status"='CONFIRMED';
  SELECT COALESCE(SUM("amount_minor"),0) INTO reserved FROM "refunds" WHERE "payment_id"=NEW."payment_id" AND "status" IN ('AWAITING_APPROVAL','PENDING_PROVIDER');
  IF confirmed+reserved+NEW."amount_minor">p."amount_minor" THEN RAISE EXCEPTION 'refund exceeds refundable payment amount' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_scope_balance_guard BEFORE INSERT ON "refunds" FOR EACH ROW EXECUTE FUNCTION enforce_refund_scope_and_balance();

CREATE FUNCTION enforce_refund_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision"<>OLD."revision"+1 OR (NEW."id",NEW."branch_id",NEW."payment_id",NEW."order_id",NEW."shift_id",NEW."requested_by_id",NEW."kind",NEW."currency",NEW."amount_minor") IS DISTINCT FROM (OLD."id",OLD."branch_id",OLD."payment_id",OLD."order_id",OLD."shift_id",OLD."requested_by_id",OLD."kind",OLD."currency",OLD."amount_minor") THEN RAISE EXCEPTION 'invalid refund mutation' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD."status"='AWAITING_APPROVAL' AND NEW."status" IN ('PENDING_PROVIDER','CONFIRMED','REJECTED')) OR (OLD."status"='PENDING_PROVIDER' AND NEW."status" IN ('CONFIRMED','FAILED'))) THEN RAISE EXCEPTION 'invalid refund transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_lifecycle_guard BEFORE UPDATE ON "refunds" FOR EACH ROW EXECUTE FUNCTION enforce_refund_lifecycle();

CREATE FUNCTION enforce_confirmed_refund_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total BIGINT; paid INTEGER;
BEGIN
  SELECT "amount_minor" INTO paid FROM "payments" WHERE "id"=NEW."payment_id";
  SELECT COALESCE(SUM("amount_minor"),0) INTO total FROM "refunds" WHERE "payment_id"=NEW."payment_id" AND "status"='CONFIRMED';
  IF total>paid THEN RAISE EXCEPTION 'confirmed refunds exceed payment' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER confirmed_refund_balance_guard AFTER INSERT OR UPDATE OF "status" ON "refunds" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_confirmed_refund_balance();

CREATE TRIGGER refunds_no_delete BEFORE DELETE ON "refunds" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER refund_approvals_append_only BEFORE UPDATE OR DELETE ON "refund_approvals" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER refund_receipts_append_only BEFORE UPDATE OR DELETE ON "refund_receipts" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
