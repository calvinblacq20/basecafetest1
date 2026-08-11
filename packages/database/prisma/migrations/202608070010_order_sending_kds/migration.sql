ALTER TYPE "OrderLineStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "OrderEventType" ADD VALUE 'SEND_WAVE_CREATED';
ALTER TYPE "OrderEventType" ADD VALUE 'SENT_LINE_CANCELLED';
CREATE TYPE "PreparationTicketStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');
CREATE TYPE "PreparationTicketEntryKind" AS ENUM ('ITEM', 'MODIFIER');

CREATE TABLE "order_send_waves" (
  "id" UUID PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "sent_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "wave_number" INTEGER NOT NULL CHECK ("wave_number" > 0),
  "reason" VARCHAR(500) NOT NULL,
  "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("order_id", "wave_number")
);
CREATE INDEX "order_send_waves_branch_sent_idx" ON "order_send_waves"("branch_id", "sent_at");

ALTER TABLE "order_lines"
  ADD COLUMN "send_wave_id" UUID REFERENCES "order_send_waves"("id") ON DELETE RESTRICT,
  ADD COLUMN "sent_at" TIMESTAMPTZ(3),
  ADD COLUMN "sent_cancelled_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "order_lines_send_pair" CHECK (("send_wave_id" IS NULL) = ("sent_at" IS NULL)),
  ADD CONSTRAINT "order_lines_sent_cancel_pair" CHECK ("sent_cancelled_at" IS NULL OR "sent_at" IS NOT NULL);
CREATE INDEX "order_lines_send_wave_idx" ON "order_lines"("send_wave_id");

CREATE TABLE "order_sent_line_cancellations" (
  "id" UUID PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "order_line_id" UUID NOT NULL UNIQUE REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "approved_by_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "sent_line_cancellations_order_created_idx" ON "order_sent_line_cancellations"("order_id", "created_at");

CREATE TABLE "preparation_tickets" (
  "id" UUID PRIMARY KEY,
  "branch_id" UUID NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,
  "station_id" UUID NOT NULL REFERENCES "stations"("id") ON DELETE RESTRICT,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "send_wave_id" UUID NOT NULL REFERENCES "order_send_waves"("id") ON DELETE RESTRICT,
  "status" "PreparationTicketStatus" NOT NULL DEFAULT 'QUEUED',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "order_number_snapshot" VARCHAR(32) NOT NULL,
  "channel_snapshot" "OrderChannel" NOT NULL,
  "service_reference_snapshot" VARCHAR(160),
  "cashier_name_snapshot" VARCHAR(120) NOT NULL,
  "station_name_snapshot" VARCHAR(100) NOT NULL,
  "business_date" DATE NOT NULL,
  "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "preparing_at" TIMESTAMPTZ(3),
  "ready_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "preparation_ticket_timestamps" CHECK (
    ("status" = 'QUEUED' AND "preparing_at" IS NULL AND "ready_at" IS NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'PREPARING' AND "preparing_at" IS NOT NULL AND "ready_at" IS NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'READY' AND "preparing_at" IS NOT NULL AND "ready_at" IS NOT NULL AND "completed_at" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'COMPLETED' AND "preparing_at" IS NOT NULL AND "ready_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL)
  ),
  UNIQUE ("send_wave_id", "station_id")
);
CREATE INDEX "preparation_tickets_queue_idx" ON "preparation_tickets"("branch_id", "station_id", "status", "queued_at");
CREATE INDEX "preparation_tickets_order_idx" ON "preparation_tickets"("order_id", "queued_at");

CREATE TABLE "preparation_ticket_entries" (
  "id" UUID PRIMARY KEY,
  "ticket_id" UUID NOT NULL REFERENCES "preparation_tickets"("id") ON DELETE RESTRICT,
  "order_line_id" UUID NOT NULL REFERENCES "order_lines"("id") ON DELETE RESTRICT,
  "order_line_modifier_id" UUID REFERENCES "order_line_modifiers"("id") ON DELETE RESTRICT,
  "kind" "PreparationTicketEntryKind" NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "item_name_snapshot" VARCHAR(140) NOT NULL,
  "variant_name_snapshot" VARCHAR(100),
  "modifier_name_snapshot" VARCHAR(100),
  "modifier_group_snapshot" VARCHAR(100),
  "modifier_summary" JSONB,
  "note_snapshot" VARCHAR(500),
  "cancellation_id" UUID REFERENCES "order_sent_line_cancellations"("id") ON DELETE RESTRICT,
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "preparation_entry_kind_fields" CHECK (
    ("kind" = 'ITEM' AND "order_line_modifier_id" IS NULL AND "modifier_name_snapshot" IS NULL)
    OR ("kind" = 'MODIFIER' AND "order_line_modifier_id" IS NOT NULL AND "modifier_name_snapshot" IS NOT NULL)
  ),
  CONSTRAINT "preparation_entry_cancel_pair" CHECK (("cancellation_id" IS NULL) = ("cancelled_at" IS NULL))
);
CREATE UNIQUE INDEX "preparation_ticket_item_entry_unique" ON "preparation_ticket_entries"("ticket_id", "order_line_id") WHERE "order_line_modifier_id" IS NULL;
CREATE UNIQUE INDEX "preparation_ticket_modifier_entry_unique" ON "preparation_ticket_entries"("ticket_id", "order_line_id", "order_line_modifier_id") WHERE "order_line_modifier_id" IS NOT NULL;
CREATE INDEX "preparation_ticket_entries_line_idx" ON "preparation_ticket_entries"("order_line_id", "cancelled_at");

CREATE TABLE "preparation_ticket_events" (
  "id" UUID PRIMARY KEY,
  "ticket_id" UUID NOT NULL REFERENCES "preparation_tickets"("id") ON DELETE RESTRICT,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "device_id" UUID NOT NULL REFERENCES "devices"("id") ON DELETE RESTRICT,
  "from_status" "PreparationTicketStatus",
  "to_status" "PreparationTicketStatus" NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "reason" VARCHAR(500) NOT NULL,
  "data" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "preparation_ticket_events_ticket_idx" ON "preparation_ticket_events"("ticket_id", "occurred_at");

CREATE FUNCTION enforce_send_wave_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_branch UUID; order_device UUID; actor_org UUID; branch_org UUID;
BEGIN
  SELECT "branch_id", "device_id" INTO order_branch, order_device FROM "orders" WHERE "id" = NEW."order_id";
  SELECT "organization_id" INTO actor_org FROM "users" WHERE "id" = NEW."sent_by_id";
  SELECT "organization_id" INTO branch_org FROM "branches" WHERE "id" = NEW."branch_id";
  IF order_branch IS NULL OR order_branch <> NEW."branch_id" OR order_device <> NEW."device_id" OR actor_org <> branch_org THEN
    RAISE EXCEPTION 'send wave tenant, branch, device, or actor mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_send_waves_scope_guard BEFORE INSERT ON "order_send_waves" FOR EACH ROW EXECUTE FUNCTION enforce_send_wave_scope();

CREATE FUNCTION enforce_preparation_ticket_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_branch UUID; wave_order UUID; wave_branch UUID; station_branch UUID;
BEGIN
  SELECT "branch_id" INTO order_branch FROM "orders" WHERE "id" = NEW."order_id";
  SELECT "order_id", "branch_id" INTO wave_order, wave_branch FROM "order_send_waves" WHERE "id" = NEW."send_wave_id";
  SELECT "branch_id" INTO station_branch FROM "stations" WHERE "id" = NEW."station_id";
  IF order_branch IS NULL OR order_branch <> NEW."branch_id" OR wave_order <> NEW."order_id" OR wave_branch <> NEW."branch_id" OR station_branch <> NEW."branch_id" THEN
    RAISE EXCEPTION 'preparation ticket scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_tickets_scope_guard BEFORE INSERT OR UPDATE ON "preparation_tickets" FOR EACH ROW EXECUTE FUNCTION enforce_preparation_ticket_scope();

CREATE FUNCTION enforce_preparation_entry_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ticket_order UUID; line_order UUID; modifier_line UUID;
BEGIN
  SELECT "order_id" INTO ticket_order FROM "preparation_tickets" WHERE "id" = NEW."ticket_id";
  SELECT "order_id" INTO line_order FROM "order_lines" WHERE "id" = NEW."order_line_id";
  IF NEW."order_line_modifier_id" IS NOT NULL THEN
    SELECT "order_line_id" INTO modifier_line FROM "order_line_modifiers" WHERE "id" = NEW."order_line_modifier_id";
  END IF;
  IF ticket_order IS NULL OR ticket_order <> line_order OR (NEW."order_line_modifier_id" IS NOT NULL AND modifier_line <> NEW."order_line_id") THEN
    RAISE EXCEPTION 'preparation entry order or modifier mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_entries_scope_guard BEFORE INSERT OR UPDATE ON "preparation_ticket_entries" FOR EACH ROW EXECUTE FUNCTION enforce_preparation_entry_scope();

CREATE FUNCTION enforce_sent_cancellation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE line_order UUID; sent_time TIMESTAMPTZ; actor_org UUID; order_org UUID;
BEGIN
  SELECT "order_id", "sent_at" INTO line_order, sent_time FROM "order_lines" WHERE "id" = NEW."order_line_id";
  SELECT u."organization_id" INTO actor_org FROM "users" u WHERE u."id" = NEW."approved_by_id";
  SELECT b."organization_id" INTO order_org FROM "orders" o JOIN "branches" b ON b."id" = o."branch_id" WHERE o."id" = NEW."order_id";
  IF line_order IS NULL OR line_order <> NEW."order_id" OR sent_time IS NULL OR actor_org <> order_org THEN
    RAISE EXCEPTION 'sent cancellation scope or lifecycle mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sent_cancellations_scope_guard BEFORE INSERT ON "order_sent_line_cancellations" FOR EACH ROW EXECUTE FUNCTION enforce_sent_cancellation_scope();

CREATE OR REPLACE FUNCTION enforce_order_line_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'DRAFT' THEN
    IF OLD."send_wave_id" IS NULL AND NEW."send_wave_id" IS NOT NULL AND NEW."sent_at" IS NOT NULL AND
       (to_jsonb(NEW) - 'send_wave_id' - 'sent_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'send_wave_id' - 'sent_at') THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - 'net_amount_minor' - 'tax_total_minor' - 'gross_amount_minor') IS NOT DISTINCT FROM
       (to_jsonb(OLD) - 'net_amount_minor' - 'tax_total_minor' - 'gross_amount_minor') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF OLD."status" <> 'DRAFT' OR NEW."status" NOT IN ('REPLACED','REMOVED','CANCELLED') OR NEW."ended_at" IS NULL THEN
    RAISE EXCEPTION 'invalid order line lifecycle transition' USING ERRCODE = '23514';
  END IF;
  IF OLD."sent_at" IS NULL AND (NEW."status" NOT IN ('REPLACED','REMOVED') OR NEW."sent_cancelled_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'unsent line cannot use sent cancellation' USING ERRCODE = '23514';
  END IF;
  IF OLD."sent_at" IS NOT NULL AND (NEW."status" NOT IN ('REPLACED','CANCELLED') OR NEW."sent_cancelled_at" IS NULL) THEN
    RAISE EXCEPTION 'sent line requires explicit cancellation' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'ended_at' - 'sent_cancelled_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'ended_at' - 'sent_cancelled_at') THEN
    RAISE EXCEPTION 'order line snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION enforce_preparation_ticket_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'ticket revision must increment exactly once' USING ERRCODE = '23514'; END IF;
  IF (NEW."id", NEW."branch_id", NEW."station_id", NEW."order_id", NEW."send_wave_id", NEW."order_number_snapshot", NEW."channel_snapshot", NEW."service_reference_snapshot", NEW."cashier_name_snapshot", NEW."station_name_snapshot", NEW."business_date", NEW."queued_at") IS DISTINCT FROM
     (OLD."id", OLD."branch_id", OLD."station_id", OLD."order_id", OLD."send_wave_id", OLD."order_number_snapshot", OLD."channel_snapshot", OLD."service_reference_snapshot", OLD."cashier_name_snapshot", OLD."station_name_snapshot", OLD."business_date", OLD."queued_at") THEN
    RAISE EXCEPTION 'preparation ticket snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT ((OLD."status" = 'QUEUED' AND NEW."status" IN ('PREPARING','CANCELLED')) OR
          (OLD."status" = 'PREPARING' AND NEW."status" IN ('READY','CANCELLED')) OR
          (OLD."status" = 'READY' AND NEW."status" IN ('COMPLETED','CANCELLED'))) THEN
    RAISE EXCEPTION 'invalid preparation ticket transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_ticket_lifecycle_guard BEFORE UPDATE ON "preparation_tickets" FOR EACH ROW EXECUTE FUNCTION enforce_preparation_ticket_lifecycle();

CREATE FUNCTION enforce_preparation_entry_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."cancellation_id" IS NOT NULL OR NEW."cancellation_id" IS NULL OR NEW."cancelled_at" IS NULL OR
     (to_jsonb(NEW) - 'cancellation_id' - 'cancelled_at') IS DISTINCT FROM (to_jsonb(OLD) - 'cancellation_id' - 'cancelled_at') THEN
    RAISE EXCEPTION 'preparation entry snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_entries_immutable_guard BEFORE UPDATE ON "preparation_ticket_entries" FOR EACH ROW EXECUTE FUNCTION enforce_preparation_entry_update();

CREATE TRIGGER order_send_waves_immutable BEFORE UPDATE OR DELETE ON "order_send_waves" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER sent_cancellations_append_only BEFORE UPDATE OR DELETE ON "order_sent_line_cancellations" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER preparation_events_append_only BEFORE UPDATE OR DELETE ON "preparation_ticket_events" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER preparation_entries_no_delete BEFORE DELETE ON "preparation_ticket_entries" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER preparation_tickets_no_delete BEFORE DELETE ON "preparation_tickets" FOR EACH ROW EXECUTE FUNCTION reject_mutation();
