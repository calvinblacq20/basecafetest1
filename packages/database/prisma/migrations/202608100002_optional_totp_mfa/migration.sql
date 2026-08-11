CREATE TYPE "MfaCredentialStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

CREATE TABLE "user_mfa_credentials" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "MfaCredentialStatus" NOT NULL DEFAULT 'PENDING',
  "secret_ciphertext" BYTEA NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "activated_at" TIMESTAMPTZ(3),
  "disabled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_mfa_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_mfa_credentials_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "activated_at" IS NULL AND "disabled_at" IS NULL) OR
    ("status" = 'ACTIVE' AND "activated_at" IS NOT NULL AND "disabled_at" IS NULL) OR
    ("status" = 'DISABLED' AND "disabled_at" IS NOT NULL)
  )
);

CREATE TABLE "mfa_recovery_codes" (
  "id" UUID NOT NULL,
  "credential_id" UUID NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_mfa_credentials_current_user_key" ON "user_mfa_credentials"("user_id") WHERE "status" <> 'DISABLED';
CREATE INDEX "user_mfa_credentials_organization_id_status_idx" ON "user_mfa_credentials"("organization_id", "status");
CREATE INDEX "user_mfa_credentials_user_id_status_idx" ON "user_mfa_credentials"("user_id", "status");
CREATE UNIQUE INDEX "mfa_recovery_codes_credential_id_code_hash_key" ON "mfa_recovery_codes"("credential_id", "code_hash");
CREATE INDEX "mfa_recovery_codes_credential_id_used_at_idx" ON "mfa_recovery_codes"("credential_id", "used_at");

ALTER TABLE "user_mfa_credentials" ADD CONSTRAINT "user_mfa_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_mfa_credentials" ADD CONSTRAINT "user_mfa_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "user_mfa_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION protect_mfa_credential_history()
RETURNS trigger AS $$
DECLARE
  expected_organization UUID;
BEGIN
  SELECT "organization_id" INTO expected_organization FROM "users" WHERE "id" = NEW."user_id";
  IF expected_organization IS NULL OR expected_organization <> NEW."organization_id" THEN
    RAISE EXCEPTION 'MFA credential organization must match its user';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."id" <> NEW."id" OR OLD."organization_id" <> NEW."organization_id" OR
       OLD."user_id" <> NEW."user_id" OR OLD."secret_ciphertext" <> NEW."secret_ciphertext" OR
       OLD."created_at" <> NEW."created_at" THEN
      RAISE EXCEPTION 'MFA credential identity and secret are immutable';
    END IF;
    IF NOT (
      OLD."status" = 'PENDING' AND NEW."status" = 'ACTIVE' AND NEW."revision" = OLD."revision" + 1 OR
      OLD."status" = 'ACTIVE' AND NEW."status" = 'DISABLED' AND NEW."revision" = OLD."revision" + 1
    ) THEN
      RAISE EXCEPTION 'Invalid MFA credential lifecycle transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_mfa_credentials_protect_history"
BEFORE INSERT OR UPDATE ON "user_mfa_credentials"
FOR EACH ROW EXECUTE FUNCTION protect_mfa_credential_history();

CREATE OR REPLACE FUNCTION reject_mfa_credential_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MFA credential history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_mfa_credentials_reject_delete"
BEFORE DELETE ON "user_mfa_credentials"
FOR EACH ROW EXECUTE FUNCTION reject_mfa_credential_delete();

CREATE OR REPLACE FUNCTION protect_mfa_recovery_code_history()
RETURNS trigger AS $$
BEGIN
  IF OLD."credential_id" <> NEW."credential_id" OR OLD."code_hash" <> NEW."code_hash" OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'MFA recovery code history is immutable';
  END IF;
  IF OLD."used_at" IS NOT NULL OR NEW."used_at" IS NULL THEN
    RAISE EXCEPTION 'MFA recovery code may only transition once to used';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mfa_recovery_codes_protect_update"
BEFORE UPDATE ON "mfa_recovery_codes"
FOR EACH ROW EXECUTE FUNCTION protect_mfa_recovery_code_history();

CREATE OR REPLACE FUNCTION reject_mfa_recovery_code_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MFA recovery code history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mfa_recovery_codes_reject_delete"
BEFORE DELETE ON "mfa_recovery_codes"
FOR EACH ROW EXECUTE FUNCTION reject_mfa_recovery_code_delete();
