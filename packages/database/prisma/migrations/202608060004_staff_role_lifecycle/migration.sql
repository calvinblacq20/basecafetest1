ALTER TABLE "user_roles"
  ADD COLUMN "revoked_by_id" UUID,
  ADD COLUMN "revoked_at" TIMESTAMPTZ(3),
  ADD COLUMN "revocation_reason" VARCHAR(500),
  ADD CONSTRAINT "user_roles_revocation_fields_check"
  CHECK (
    ("revoked_at" IS NULL AND "revoked_by_id" IS NULL AND "revocation_reason" IS NULL)
    OR (
      "revoked_at" IS NOT NULL
      AND "revoked_by_id" IS NOT NULL
      AND length(trim("revocation_reason")) > 0
      AND "revoked_at" >= "assigned_at"
    )
  );

DROP INDEX "user_roles_user_id_branch_id_idx";
DROP INDEX "user_roles_role_id_idx";
CREATE INDEX "user_roles_user_id_branch_id_revoked_at_idx"
  ON "user_roles"("user_id", "branch_id", "revoked_at");
CREATE INDEX "user_roles_role_id_revoked_at_idx"
  ON "user_roles"("role_id", "revoked_at");

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Assignment identity and revocation history are immutable. A role is removed
-- by setting the three revocation fields once; the assignment row is retained.
CREATE FUNCTION protect_user_role_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'user role history is non-destructive';
  END IF;

  IF OLD."user_id" IS DISTINCT FROM NEW."user_id"
     OR OLD."role_id" IS DISTINCT FROM NEW."role_id"
     OR OLD."branch_id" IS DISTINCT FROM NEW."branch_id"
     OR OLD."assigned_by_id" IS DISTINCT FROM NEW."assigned_by_id"
     OR OLD."assigned_at" IS DISTINCT FROM NEW."assigned_at" THEN
    RAISE EXCEPTION 'user role assignment identity is immutable';
  END IF;

  IF OLD."revoked_at" IS NOT NULL
     AND (
       OLD."revoked_at" IS DISTINCT FROM NEW."revoked_at"
       OR OLD."revoked_by_id" IS DISTINCT FROM NEW."revoked_by_id"
       OR OLD."revocation_reason" IS DISTINCT FROM NEW."revocation_reason"
     ) THEN
    RAISE EXCEPTION 'user role revocation history is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_roles_history_guard"
BEFORE UPDATE OR DELETE ON "user_roles"
FOR EACH ROW EXECUTE FUNCTION protect_user_role_history();
