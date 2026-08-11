ALTER TABLE "order_lines"
  ADD COLUMN "category_key_snapshot" VARCHAR(80),
  ADD COLUMN "category_name_snapshot" VARCHAR(100);

CREATE INDEX "orders_branch_status_completed_at_idx"
  ON "orders"("branch_id", "status", "completed_at");
CREATE INDEX "payments_branch_status_confirmed_at_idx"
  ON "payments"("branch_id", "status", "confirmed_at");
CREATE INDEX "refunds_branch_status_confirmed_at_idx"
  ON "refunds"("branch_id", "status", "confirmed_at");
CREATE INDEX "cash_movements_branch_status_posted_at_idx"
  ON "cash_movements"("branch_id", "status", "posted_at");

CREATE FUNCTION enforce_new_order_line_category_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."category_key_snapshot" IS NULL OR
     NEW."category_name_snapshot" IS NULL OR
     length(trim(NEW."category_key_snapshot")) = 0 OR
     length(trim(NEW."category_name_snapshot")) = 0 THEN
    RAISE EXCEPTION 'new order lines require immutable category snapshots' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER order_lines_category_snapshot_guard
  BEFORE INSERT ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION enforce_new_order_line_category_snapshot();

COMMENT ON COLUMN "order_lines"."category_key_snapshot" IS
  'Immutable category key for newly created line snapshots; NULL means legacy UNSNAPSHOTTED.';
COMMENT ON COLUMN "order_lines"."category_name_snapshot" IS
  'Immutable category name for newly created line snapshots; NULL means legacy UNSNAPSHOTTED.';
