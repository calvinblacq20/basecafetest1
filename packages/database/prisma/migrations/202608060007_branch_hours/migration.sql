CREATE TYPE "BranchScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');
CREATE TYPE "SpecialHoursKind" AS ENUM ('CLOSED', 'CUSTOM_HOURS');
CREATE TYPE "SpecialHoursStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'CANCELLED');

CREATE TABLE "branch_schedule_versions" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "activated_by_id" UUID,
    "ended_by_id" UUID,
    "effective_from" DATE NOT NULL,
    "business_day_cutoff_minute" INTEGER NOT NULL,
    "status" "BranchScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "activated_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_schedule_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_schedule_versions_cutoff_check"
      CHECK ("business_day_cutoff_minute" BETWEEN 0 AND 1439),
    CONSTRAINT "branch_schedule_versions_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "branch_schedule_versions_status_check" CHECK (
      (
        "status" = 'DRAFT'
        AND "activated_by_id" IS NULL
        AND "activated_at" IS NULL
        AND "ended_by_id" IS NULL
        AND "ended_at" IS NULL
      ) OR (
        "status" = 'ACTIVE'
        AND "activated_by_id" IS NOT NULL
        AND "activated_at" IS NOT NULL
        AND "ended_by_id" IS NULL
        AND "ended_at" IS NULL
      ) OR (
        "status" = 'CANCELLED'
        AND "activated_by_id" IS NOT NULL
        AND "activated_at" IS NOT NULL
        AND "ended_by_id" IS NOT NULL
        AND "ended_at" IS NOT NULL
      )
    )
);

CREATE TABLE "branch_weekly_service_windows" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "iso_weekday" INTEGER NOT NULL,
    "opens_at_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,

    CONSTRAINT "branch_weekly_service_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_weekly_service_windows_weekday_check"
      CHECK ("iso_weekday" BETWEEN 1 AND 7),
    CONSTRAINT "branch_weekly_service_windows_open_check"
      CHECK ("opens_at_minute" BETWEEN 0 AND 1439),
    CONSTRAINT "branch_weekly_service_windows_duration_check"
      CHECK ("duration_minutes" BETWEEN 1 AND 1440)
);

CREATE TABLE "branch_special_hours" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "activated_by_id" UUID,
    "ended_by_id" UUID,
    "local_date" DATE NOT NULL,
    "kind" "SpecialHoursKind" NOT NULL,
    "label" VARCHAR(120),
    "status" "SpecialHoursStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "activated_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_special_hours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_special_hours_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "branch_special_hours_status_check" CHECK (
      (
        "status" = 'DRAFT'
        AND "activated_by_id" IS NULL
        AND "activated_at" IS NULL
        AND "ended_by_id" IS NULL
        AND "ended_at" IS NULL
      ) OR (
        "status" = 'ACTIVE'
        AND "activated_by_id" IS NOT NULL
        AND "activated_at" IS NOT NULL
        AND "ended_by_id" IS NULL
        AND "ended_at" IS NULL
      ) OR (
        "status" IN ('SUPERSEDED', 'CANCELLED')
        AND "activated_by_id" IS NOT NULL
        AND "activated_at" IS NOT NULL
        AND "ended_by_id" IS NOT NULL
        AND "ended_at" IS NOT NULL
      )
    )
);

CREATE TABLE "branch_special_service_windows" (
    "id" UUID NOT NULL,
    "special_hours_id" UUID NOT NULL,
    "opens_at_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,

    CONSTRAINT "branch_special_service_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branch_special_service_windows_open_check"
      CHECK ("opens_at_minute" BETWEEN 0 AND 1439),
    CONSTRAINT "branch_special_service_windows_duration_check"
      CHECK ("duration_minutes" BETWEEN 1 AND 1440)
);

CREATE INDEX "branch_schedule_versions_branch_id_status_effective_from_idx"
  ON "branch_schedule_versions"("branch_id", "status", "effective_from");
CREATE UNIQUE INDEX "branch_schedule_versions_one_active_start_key"
  ON "branch_schedule_versions"("branch_id", "effective_from")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "branch_weekly_service_windows_schedule_id_iso_weekday_opens_idx"
  ON "branch_weekly_service_windows"("schedule_id", "iso_weekday", "opens_at_minute");
CREATE INDEX "branch_special_hours_branch_id_local_date_status_idx"
  ON "branch_special_hours"("branch_id", "local_date", "status");
CREATE UNIQUE INDEX "branch_special_hours_one_active_date_key"
  ON "branch_special_hours"("branch_id", "local_date")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "branch_special_service_windows_special_hours_id_opens_at_idx"
  ON "branch_special_service_windows"("special_hours_id", "opens_at_minute");

ALTER TABLE "branch_schedule_versions"
  ADD CONSTRAINT "branch_schedule_versions_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_schedule_versions"
  ADD CONSTRAINT "branch_schedule_versions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_schedule_versions"
  ADD CONSTRAINT "branch_schedule_versions_activated_by_id_fkey"
  FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_schedule_versions"
  ADD CONSTRAINT "branch_schedule_versions_ended_by_id_fkey"
  FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_weekly_service_windows"
  ADD CONSTRAINT "branch_weekly_service_windows_schedule_id_fkey"
  FOREIGN KEY ("schedule_id") REFERENCES "branch_schedule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_special_hours"
  ADD CONSTRAINT "branch_special_hours_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_special_hours"
  ADD CONSTRAINT "branch_special_hours_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_special_hours"
  ADD CONSTRAINT "branch_special_hours_activated_by_id_fkey"
  FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_special_hours"
  ADD CONSTRAINT "branch_special_hours_ended_by_id_fkey"
  FOREIGN KEY ("ended_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "branch_special_service_windows"
  ADD CONSTRAINT "branch_special_service_windows_special_hours_id_fkey"
  FOREIGN KEY ("special_hours_id") REFERENCES "branch_special_hours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_branch_schedule_history()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'branch schedule versions cannot be deleted';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'branch schedule revisions must increment by exactly one';
  END IF;
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'cancelled branch schedule versions are immutable';
  END IF;
  IF OLD."status" = 'ACTIVE' THEN
    IF NEW."status" <> 'CANCELLED' THEN
      RAISE EXCEPTION 'active branch schedule versions may only be cancelled';
    END IF;
    IF ROW(NEW."branch_id", NEW."created_by_id", NEW."effective_from", NEW."business_day_cutoff_minute", NEW."activated_by_id", NEW."activated_at", NEW."created_at")
       IS DISTINCT FROM
       ROW(OLD."branch_id", OLD."created_by_id", OLD."effective_from", OLD."business_day_cutoff_minute", OLD."activated_by_id", OLD."activated_at", OLD."created_at") THEN
      RAISE EXCEPTION 'active branch schedule configuration is immutable';
    END IF;
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'draft branch schedules may only remain draft or activate';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branch_schedule_versions_history_guard"
BEFORE UPDATE OR DELETE ON "branch_schedule_versions"
FOR EACH ROW EXECUTE FUNCTION guard_branch_schedule_history();

CREATE FUNCTION guard_branch_schedule_window_change()
RETURNS trigger AS $$
DECLARE
  parent_status "BranchScheduleStatus";
  target_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD."schedule_id";
  ELSE target_id := NEW."schedule_id";
  END IF;
  SELECT "status" INTO parent_status FROM "branch_schedule_versions" WHERE "id" = target_id;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'windows of an active branch schedule are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branch_weekly_service_windows_history_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "branch_weekly_service_windows"
FOR EACH ROW EXECUTE FUNCTION guard_branch_schedule_window_change();

CREATE FUNCTION guard_special_hours_history()
RETURNS trigger AS $$
DECLARE
  window_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'special-hours versions cannot be deleted';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'special-hours revisions must increment by exactly one';
  END IF;
  IF OLD."status" IN ('SUPERSEDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'ended special-hours versions are immutable';
  END IF;
  IF OLD."status" = 'ACTIVE' THEN
    IF NEW."status" NOT IN ('SUPERSEDED', 'CANCELLED') THEN
      RAISE EXCEPTION 'active special hours may only be superseded or cancelled';
    END IF;
    IF ROW(NEW."branch_id", NEW."created_by_id", NEW."local_date", NEW."kind", NEW."label", NEW."activated_by_id", NEW."activated_at", NEW."created_at")
       IS DISTINCT FROM
       ROW(OLD."branch_id", OLD."created_by_id", OLD."local_date", OLD."kind", OLD."label", OLD."activated_by_id", OLD."activated_at", OLD."created_at") THEN
      RAISE EXCEPTION 'active special-hours configuration is immutable';
    END IF;
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'ACTIVE') THEN
    RAISE EXCEPTION 'draft special hours may only remain draft or activate';
  END IF;
  IF NEW."status" = 'ACTIVE' THEN
    SELECT COUNT(*) INTO window_count FROM "branch_special_service_windows" WHERE "special_hours_id" = NEW."id";
    IF NEW."kind" = 'CLOSED' AND window_count <> 0 THEN
      RAISE EXCEPTION 'closed special hours cannot contain windows';
    END IF;
    IF NEW."kind" = 'CUSTOM_HOURS' AND window_count = 0 THEN
      RAISE EXCEPTION 'custom special hours require at least one window';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branch_special_hours_history_guard"
BEFORE UPDATE OR DELETE ON "branch_special_hours"
FOR EACH ROW EXECUTE FUNCTION guard_special_hours_history();

CREATE FUNCTION guard_special_hours_window_change()
RETURNS trigger AS $$
DECLARE
  parent_status "SpecialHoursStatus";
  target_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD."special_hours_id";
  ELSE target_id := NEW."special_hours_id";
  END IF;
  SELECT "status" INTO parent_status FROM "branch_special_hours" WHERE "id" = target_id;
  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'windows of active special hours are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "branch_special_service_windows_history_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "branch_special_service_windows"
FOR EACH ROW EXECUTE FUNCTION guard_special_hours_window_change();
