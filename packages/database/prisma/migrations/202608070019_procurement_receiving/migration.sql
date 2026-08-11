ALTER TYPE "StockLedgerType" ADD VALUE 'PURCHASE_RECEIPT';
ALTER TYPE "StockLedgerType" ADD VALUE 'PURCHASE_RETURN';
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "suppliers" (
  "id" UUID NOT NULL, "branch_id" UUID NOT NULL, "external_key" VARCHAR(80) NOT NULL,
  "name" VARCHAR(160) NOT NULL, "contact_name" VARCHAR(120), "phone" VARCHAR(40),
  "email" VARCHAR(254), "payment_terms" VARCHAR(240), "lead_time_days" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_values_check" CHECK ("revision" > 0 AND ("lead_time_days" IS NULL OR "lead_time_days" BETWEEN 0 AND 365))
);

CREATE TABLE "supplier_items" (
  "id" UUID NOT NULL, "branch_id" UUID NOT NULL, "supplier_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL, "purchase_unit_id" UUID NOT NULL,
  "supplier_sku" VARCHAR(100), "is_active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "supplier_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_item_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "purchase_orders" (
  "id" UUID NOT NULL, "branch_id" UUID NOT NULL, "supplier_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL, "submitted_by_id" UUID, "cancelled_by_id" UUID,
  "client_reference" VARCHAR(120) NOT NULL, "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1, "currency" CHAR(3) NOT NULL,
  "total_cost_minor" INTEGER NOT NULL, "expected_at" TIMESTAMPTZ(3),
  "reason" VARCHAR(500) NOT NULL, "submitted_at" TIMESTAMPTZ(3), "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_values_check" CHECK ("revision" > 0 AND "total_cost_minor" >= 0 AND length(btrim("reason")) >= 3),
  CONSTRAINT "purchase_order_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "submitted_by_id" IS NULL AND "submitted_at" IS NULL AND "cancelled_by_id" IS NULL AND "cancelled_at" IS NULL) OR
    ("status" IN ('SUBMITTED', 'PARTIALLY_RECEIVED', 'COMPLETED') AND "submitted_by_id" IS NOT NULL AND "submitted_at" IS NOT NULL AND "cancelled_by_id" IS NULL AND "cancelled_at" IS NULL) OR
    ("status" = 'CANCELLED' AND "cancelled_by_id" IS NOT NULL AND "cancelled_at" IS NOT NULL)
  )
);

CREATE TABLE "purchase_order_lines" (
  "id" UUID NOT NULL, "purchase_order_id" UUID NOT NULL, "supplier_item_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL, "purchase_unit_id" UUID NOT NULL,
  "inventory_item_name" VARCHAR(160) NOT NULL, "inventory_item_external_key" VARCHAR(80) NOT NULL,
  "purchase_unit_code" VARCHAR(80) NOT NULL, "ordered_quantity_micros" BIGINT NOT NULL,
  "conversion_numerator" BIGINT NOT NULL, "conversion_denominator" BIGINT NOT NULL,
  "unit_cost_minor" INTEGER NOT NULL, "line_cost_minor" INTEGER NOT NULL,
  CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_line_values_check" CHECK (
    "ordered_quantity_micros" > 0 AND "conversion_numerator" > 0 AND "conversion_denominator" > 0 AND
    "unit_cost_minor" >= 0 AND "line_cost_minor" >= 0
  )
);

CREATE TABLE "goods_receipts" (
  "id" UUID NOT NULL, "branch_id" UUID NOT NULL, "purchase_order_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL, "posted_by_id" UUID NOT NULL, "device_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL, "total_cost_minor" INTEGER NOT NULL,
  "supplier_document_reference" VARCHAR(160), "received_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_values_check" CHECK ("total_cost_minor" >= 0 AND length(btrim("reason")) >= 3)
);

CREATE TABLE "goods_receipt_lines" (
  "id" UUID NOT NULL, "goods_receipt_id" UUID NOT NULL, "purchase_order_line_id" UUID NOT NULL,
  "location_id" UUID NOT NULL, "inventory_item_id" UUID NOT NULL, "purchase_unit_id" UUID NOT NULL,
  "received_quantity_micros" BIGINT NOT NULL, "received_base_micros" BIGINT NOT NULL,
  "unit_cost_minor" INTEGER NOT NULL, "line_cost_minor" INTEGER NOT NULL,
  "lot_reference" VARCHAR(120), "expires_on" DATE,
  CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_line_values_check" CHECK (
    "received_quantity_micros" > 0 AND "received_base_micros" > 0 AND "unit_cost_minor" >= 0 AND "line_cost_minor" >= 0
  )
);

CREATE TABLE "purchase_returns" (
  "id" UUID NOT NULL, "branch_id" UUID NOT NULL, "goods_receipt_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL, "posted_by_id" UUID NOT NULL, "device_id" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL, "total_cost_minor" INTEGER NOT NULL,
  "supplier_document_reference" VARCHAR(160), "returned_at" TIMESTAMPTZ(3) NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "negative_stock_override" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_values_check" CHECK ("total_cost_minor" >= 0 AND length(btrim("reason")) >= 3)
);

CREATE TABLE "purchase_return_lines" (
  "id" UUID NOT NULL, "purchase_return_id" UUID NOT NULL, "goods_receipt_line_id" UUID NOT NULL,
  "location_id" UUID NOT NULL, "inventory_item_id" UUID NOT NULL,
  "returned_quantity_micros" BIGINT NOT NULL, "returned_base_micros" BIGINT NOT NULL,
  "unit_cost_minor" INTEGER NOT NULL, "line_cost_minor" INTEGER NOT NULL,
  CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_line_values_check" CHECK (
    "returned_quantity_micros" > 0 AND "returned_base_micros" > 0 AND "unit_cost_minor" >= 0 AND "line_cost_minor" >= 0
  )
);

CREATE UNIQUE INDEX "suppliers_branch_id_external_key_key" ON "suppliers"("branch_id", "external_key");
CREATE UNIQUE INDEX "suppliers_branch_id_name_key" ON "suppliers"("branch_id", "name");
CREATE UNIQUE INDEX "suppliers_branch_id_id_key" ON "suppliers"("branch_id", "id");
CREATE INDEX "suppliers_branch_id_is_active_idx" ON "suppliers"("branch_id", "is_active");
CREATE UNIQUE INDEX "supplier_items_supplier_id_inventory_item_id_key" ON "supplier_items"("supplier_id", "inventory_item_id");
CREATE UNIQUE INDEX "supplier_items_supplier_id_supplier_sku_key" ON "supplier_items"("supplier_id", "supplier_sku");
CREATE UNIQUE INDEX "supplier_items_branch_id_id_key" ON "supplier_items"("branch_id", "id");
CREATE INDEX "supplier_items_branch_id_is_active_idx" ON "supplier_items"("branch_id", "is_active");
CREATE UNIQUE INDEX "purchase_orders_branch_id_client_reference_key" ON "purchase_orders"("branch_id", "client_reference");
CREATE UNIQUE INDEX "purchase_orders_branch_id_id_key" ON "purchase_orders"("branch_id", "id");
CREATE INDEX "purchase_orders_branch_id_status_created_at_idx" ON "purchase_orders"("branch_id", "status", "created_at");
CREATE UNIQUE INDEX "purchase_order_lines_order_supplier_item_key" ON "purchase_order_lines"("purchase_order_id", "supplier_item_id");
CREATE UNIQUE INDEX "goods_receipts_branch_id_id_key" ON "goods_receipts"("branch_id", "id");
CREATE INDEX "goods_receipts_branch_id_received_at_idx" ON "goods_receipts"("branch_id", "received_at");
CREATE UNIQUE INDEX "goods_receipt_lines_receipt_order_line_key" ON "goods_receipt_lines"("goods_receipt_id", "purchase_order_line_id");
CREATE INDEX "purchase_returns_branch_id_returned_at_idx" ON "purchase_returns"("branch_id", "returned_at");
CREATE UNIQUE INDEX "purchase_return_lines_return_receipt_line_key" ON "purchase_return_lines"("purchase_return_id", "goods_receipt_line_id");

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_supplier_fkey" FOREIGN KEY ("branch_id", "supplier_id") REFERENCES "suppliers"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_inventory_item_fkey" FOREIGN KEY ("branch_id", "inventory_item_id") REFERENCES "inventory_items"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_items" ADD CONSTRAINT "supplier_items_purchase_unit_id_fkey" FOREIGN KEY ("purchase_unit_id") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fkey" FOREIGN KEY ("branch_id", "supplier_id") REFERENCES "suppliers"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_supplier_item_id_fkey" FOREIGN KEY ("supplier_item_id") REFERENCES "supplier_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_fkey" FOREIGN KEY ("branch_id", "purchase_order_id") REFERENCES "purchase_orders"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_supplier_fkey" FOREIGN KEY ("branch_id", "supplier_id") REFERENCES "suppliers"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_goods_receipt_fkey" FOREIGN KEY ("branch_id", "goods_receipt_id") REFERENCES "goods_receipts"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_fkey" FOREIGN KEY ("branch_id", "supplier_id") REFERENCES "suppliers"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_posted_by_id_fkey" FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_purchase_return_id_fkey" FOREIGN KEY ("purchase_return_id") REFERENCES "purchase_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_goods_receipt_line_id_fkey" FOREIGN KEY ("goods_receipt_line_id") REFERENCES "goods_receipt_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "stock_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_purchase_order_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status AND OLD.status = 'PARTIALLY_RECEIVED' THEN RETURN NEW; END IF;
  IF (OLD.status = 'DRAFT' AND NEW.status IN ('SUBMITTED', 'CANCELLED')) OR
     (OLD.status = 'SUBMITTED' AND NEW.status IN ('PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED')) OR
     (OLD.status = 'PARTIALLY_RECEIVED' AND NEW.status = 'COMPLETED') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid purchase order transition' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_order_transition_guard BEFORE UPDATE ON "purchase_orders" FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION enforce_purchase_order_transition();

CREATE FUNCTION prevent_procurement_history_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'procurement history is append-only' USING ERRCODE = '23514'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_order_lines_immutable BEFORE UPDATE OR DELETE ON "purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
CREATE TRIGGER goods_receipts_immutable BEFORE UPDATE OR DELETE ON "goods_receipts" FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
CREATE TRIGGER goods_receipt_lines_immutable BEFORE UPDATE OR DELETE ON "goods_receipt_lines" FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
CREATE TRIGGER purchase_returns_immutable BEFORE UPDATE OR DELETE ON "purchase_returns" FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();
CREATE TRIGGER purchase_return_lines_immutable BEFORE UPDATE OR DELETE ON "purchase_return_lines" FOR EACH ROW EXECUTE FUNCTION prevent_procurement_history_mutation();

CREATE FUNCTION enforce_procurement_line_scope_and_cost() RETURNS trigger AS $$
DECLARE parent_branch UUID; DECLARE parent_supplier UUID; DECLARE expected_item UUID;
DECLARE expected_unit UUID; DECLARE expected_cost INTEGER; DECLARE expected_line_cost NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'purchase_order_lines' THEN
    SELECT o.branch_id, o.supplier_id INTO parent_branch, parent_supplier FROM purchase_orders o WHERE o.id = NEW.purchase_order_id;
    IF NOT EXISTS (SELECT 1 FROM supplier_items s WHERE s.id = NEW.supplier_item_id AND s.branch_id = parent_branch AND s.supplier_id = parent_supplier AND s.inventory_item_id = NEW.inventory_item_id AND s.purchase_unit_id = NEW.purchase_unit_id) THEN
      RAISE EXCEPTION 'purchase order line scope mismatch' USING ERRCODE = '23514'; END IF;
    expected_line_cost := floor((NEW.ordered_quantity_micros::numeric * NEW.unit_cost_minor + 500000) / 1000000);
    IF expected_line_cost <> NEW.line_cost_minor THEN RAISE EXCEPTION 'purchase order line cost mismatch' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'goods_receipt_lines' THEN
    SELECT l.inventory_item_id, l.purchase_unit_id, l.unit_cost_minor INTO expected_item, expected_unit, expected_cost FROM purchase_order_lines l WHERE l.id = NEW.purchase_order_line_id;
    IF NEW.inventory_item_id <> expected_item OR NEW.purchase_unit_id <> expected_unit OR NEW.unit_cost_minor <> expected_cost THEN
      RAISE EXCEPTION 'goods receipt line snapshot mismatch' USING ERRCODE = '23514'; END IF;
    expected_line_cost := floor((NEW.received_quantity_micros::numeric * NEW.unit_cost_minor + 500000) / 1000000);
    IF expected_line_cost <> NEW.line_cost_minor THEN RAISE EXCEPTION 'goods receipt line cost mismatch' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'purchase_return_lines' THEN
    SELECT r.location_id, r.inventory_item_id, r.unit_cost_minor INTO parent_branch, expected_item, expected_cost FROM goods_receipt_lines r WHERE r.id = NEW.goods_receipt_line_id;
    IF NEW.location_id <> parent_branch OR NEW.inventory_item_id <> expected_item OR NEW.unit_cost_minor <> expected_cost THEN
      RAISE EXCEPTION 'purchase return line snapshot mismatch' USING ERRCODE = '23514'; END IF;
    expected_line_cost := floor((NEW.returned_quantity_micros::numeric * NEW.unit_cost_minor + 500000) / 1000000);
    IF expected_line_cost <> NEW.line_cost_minor THEN RAISE EXCEPTION 'purchase return line cost mismatch' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_order_line_guard BEFORE INSERT ON "purchase_order_lines" FOR EACH ROW EXECUTE FUNCTION enforce_procurement_line_scope_and_cost();
CREATE TRIGGER goods_receipt_line_guard BEFORE INSERT ON "goods_receipt_lines" FOR EACH ROW EXECUTE FUNCTION enforce_procurement_line_scope_and_cost();
CREATE TRIGGER purchase_return_line_guard BEFORE INSERT ON "purchase_return_lines" FOR EACH ROW EXECUTE FUNCTION enforce_procurement_line_scope_and_cost();

CREATE FUNCTION enforce_procurement_document_totals() RETURNS trigger AS $$
DECLARE stored_total INTEGER; DECLARE computed_total BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'purchase_order_lines' THEN
    SELECT total_cost_minor INTO stored_total FROM purchase_orders WHERE id = NEW.purchase_order_id;
    SELECT coalesce(sum(line_cost_minor), 0) INTO computed_total FROM purchase_order_lines WHERE purchase_order_id = NEW.purchase_order_id;
  ELSIF TG_TABLE_NAME = 'goods_receipt_lines' THEN
    SELECT total_cost_minor INTO stored_total FROM goods_receipts WHERE id = NEW.goods_receipt_id;
    SELECT coalesce(sum(line_cost_minor), 0) INTO computed_total FROM goods_receipt_lines WHERE goods_receipt_id = NEW.goods_receipt_id;
  ELSE
    SELECT total_cost_minor INTO stored_total FROM purchase_returns WHERE id = NEW.purchase_return_id;
    SELECT coalesce(sum(line_cost_minor), 0) INTO computed_total FROM purchase_return_lines WHERE purchase_return_id = NEW.purchase_return_id;
  END IF;
  IF stored_total <> computed_total THEN RAISE EXCEPTION 'procurement document total mismatch' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER purchase_order_total_guard AFTER INSERT ON "purchase_order_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_procurement_document_totals();
CREATE CONSTRAINT TRIGGER goods_receipt_total_guard AFTER INSERT ON "goods_receipt_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_procurement_document_totals();
CREATE CONSTRAINT TRIGGER purchase_return_total_guard AFTER INSERT ON "purchase_return_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_procurement_document_totals();

CREATE FUNCTION enforce_procurement_quantity_limits() RETURNS trigger AS $$
DECLARE allowed BIGINT; DECLARE used BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'goods_receipt_lines' THEN
    SELECT ordered_quantity_micros INTO allowed FROM purchase_order_lines WHERE id = NEW.purchase_order_line_id;
    SELECT coalesce(sum(received_quantity_micros), 0) INTO used FROM goods_receipt_lines WHERE purchase_order_line_id = NEW.purchase_order_line_id;
    IF used > allowed THEN RAISE EXCEPTION 'purchase order over receipt' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT received_quantity_micros INTO allowed FROM goods_receipt_lines WHERE id = NEW.goods_receipt_line_id;
    SELECT coalesce(sum(returned_quantity_micros), 0) INTO used FROM purchase_return_lines WHERE goods_receipt_line_id = NEW.goods_receipt_line_id;
    IF used > allowed THEN RAISE EXCEPTION 'purchase return exceeds receipt' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER goods_receipt_quantity_guard AFTER INSERT ON "goods_receipt_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_procurement_quantity_limits();
CREATE CONSTRAINT TRIGGER purchase_return_quantity_guard AFTER INSERT ON "purchase_return_lines" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_procurement_quantity_limits();

CREATE FUNCTION enforce_procurement_actor_device_scope() RETURNS trigger AS $$
DECLARE branch_org UUID;
BEGIN
  SELECT organization_id INTO branch_org FROM branches WHERE id = NEW.branch_id;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.posted_by_id AND organization_id = branch_org) OR
     NOT EXISTS (SELECT 1 FROM devices WHERE id = NEW.device_id AND organization_id = branch_org AND branch_id = NEW.branch_id) THEN
    RAISE EXCEPTION 'procurement actor or device scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER goods_receipt_actor_device_guard BEFORE INSERT ON "goods_receipts" FOR EACH ROW EXECUTE FUNCTION enforce_procurement_actor_device_scope();
CREATE TRIGGER purchase_return_actor_device_guard BEFORE INSERT ON "purchase_returns" FOR EACH ROW EXECUTE FUNCTION enforce_procurement_actor_device_scope();
