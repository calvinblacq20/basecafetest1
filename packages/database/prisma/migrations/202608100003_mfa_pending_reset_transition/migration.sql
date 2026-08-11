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
      OLD."status" = 'PENDING' AND NEW."status" = 'DISABLED' AND NEW."revision" = OLD."revision" + 1 OR
      OLD."status" = 'ACTIVE' AND NEW."status" = 'DISABLED' AND NEW."revision" = OLD."revision" + 1
    ) THEN
      RAISE EXCEPTION 'Invalid MFA credential lifecycle transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
