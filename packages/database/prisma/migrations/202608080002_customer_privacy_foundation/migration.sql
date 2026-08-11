-- Encrypted customer privacy foundation. No real privacy notice, retention
-- period, marketing consent, or anonymization policy is activated here.
CREATE TYPE "CustomerProfileStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'ANONYMIZED');
CREATE TYPE "CustomerContactChannel" AS ENUM ('PHONE', 'SMS', 'EMAIL', 'WHATSAPP');
CREATE TYPE "CustomerConsentPurpose" AS ENUM ('OPERATIONAL_CONTACT', 'MARKETING');
CREATE TYPE "CustomerConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');
CREATE TYPE "PrivacyRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'RESTRICTION', 'ANONYMIZATION');
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('RECEIVED', 'IDENTITY_VERIFIED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED');
CREATE TYPE "RetentionCategory" AS ENUM ('CUSTOMER_PROFILE', 'ORDER_CONTACT', 'DELIVERY_DIRECTIONS');
CREATE TYPE "RetentionPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');

CREATE TABLE "customer_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "status" "CustomerProfileStatus" NOT NULL DEFAULT 'ACTIVE',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "pii_ciphertext" BYTEA,
  "pii_iv" BYTEA,
  "pii_auth_tag" BYTEA,
  "pii_key_version" VARCHAR(40),
  "phone_blind_index" CHAR(64),
  "email_blind_index" CHAR(64),
  "legal_hold_until" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "anonymized_by_id" UUID,
  "anonymized_at" TIMESTAMPTZ(3),
  "last_operational_contact_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_profiles_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "customer_profiles_envelope_check" CHECK (
    (
      "status" IN ('ACTIVE', 'RESTRICTED')
      AND "pii_ciphertext" IS NOT NULL
      AND "pii_iv" IS NOT NULL AND octet_length("pii_iv") = 12
      AND "pii_auth_tag" IS NOT NULL AND octet_length("pii_auth_tag") = 16
      AND "pii_key_version" IS NOT NULL
      AND "anonymized_at" IS NULL
      AND "anonymized_by_id" IS NULL
    )
    OR
    (
      "status" = 'ANONYMIZED'
      AND "pii_ciphertext" IS NULL
      AND "pii_iv" IS NULL
      AND "pii_auth_tag" IS NULL
      AND "pii_key_version" IS NULL
      AND "phone_blind_index" IS NULL
      AND "email_blind_index" IS NULL
      AND "anonymized_at" IS NOT NULL
      AND "anonymized_by_id" IS NOT NULL
    )
  ),
  CONSTRAINT "customer_profiles_phone_blind_index_check" CHECK (
    "phone_blind_index" IS NULL OR "phone_blind_index" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "customer_profiles_email_blind_index_check" CHECK (
    "email_blind_index" IS NULL OR "email_blind_index" ~ '^[a-f0-9]{64}$'
  )
);

CREATE TABLE "order_customer_contacts" (
  "order_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "customer_id" UUID,
  "pii_ciphertext" BYTEA,
  "pii_iv" BYTEA,
  "pii_auth_tag" BYTEA,
  "pii_key_version" VARCHAR(40),
  "phone_blind_index" CHAR(64),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "anonymized_at" TIMESTAMPTZ(3),
  CONSTRAINT "order_customer_contacts_pkey" PRIMARY KEY ("order_id"),
  CONSTRAINT "order_customer_contacts_envelope_check" CHECK (
    (
      "anonymized_at" IS NULL
      AND "pii_ciphertext" IS NOT NULL
      AND "pii_iv" IS NOT NULL AND octet_length("pii_iv") = 12
      AND "pii_auth_tag" IS NOT NULL AND octet_length("pii_auth_tag") = 16
      AND "pii_key_version" IS NOT NULL
    )
    OR
    (
      "anonymized_at" IS NOT NULL
      AND "pii_ciphertext" IS NULL
      AND "pii_iv" IS NULL
      AND "pii_auth_tag" IS NULL
      AND "pii_key_version" IS NULL
      AND "phone_blind_index" IS NULL
    )
  ),
  CONSTRAINT "order_customer_contacts_phone_blind_index_check" CHECK (
    "phone_blind_index" IS NULL OR "phone_blind_index" ~ '^[a-f0-9]{64}$'
  )
);

CREATE TABLE "customer_consent_events" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "purpose" "CustomerConsentPurpose" NOT NULL,
  "channel" "CustomerContactChannel" NOT NULL,
  "status" "CustomerConsentStatus" NOT NULL,
  "source" VARCHAR(80) NOT NULL,
  "wording_version" VARCHAR(80) NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_consent_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_consent_events_text_check" CHECK (
    char_length(btrim("source")) BETWEEN 1 AND 80
    AND char_length(btrim("wording_version")) BETWEEN 1 AND 80
    AND char_length(btrim("reason")) BETWEEN 1 AND 500
  )
);

CREATE TABLE "customer_data_access_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "customer_id" UUID,
  "actor_id" UUID NOT NULL,
  "access_type" VARCHAR(40) NOT NULL,
  "resource_type" VARCHAR(60) NOT NULL,
  "resource_id" VARCHAR(100) NOT NULL,
  "fields" JSONB NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_data_access_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_data_access_events_type_check" CHECK (
    "access_type" IN ('SEARCH', 'VIEW', 'EXPORT', 'ORDER_VIEW')
  ),
  CONSTRAINT "customer_data_access_events_reason_check" CHECK (
    char_length(btrim("reason")) BETWEEN 1 AND 500
  )
);

CREATE TABLE "privacy_requests" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "request_type" "PrivacyRequestType" NOT NULL,
  "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "due_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "identity_verified_by_id" UUID,
  "identity_verified_at" TIMESTAMPTZ(3),
  "completed_by_id" UUID,
  "completed_at" TIMESTAMPTZ(3),
  "reason" VARCHAR(500) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_requests_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "privacy_requests_reason_check" CHECK (
    char_length(btrim("reason")) BETWEEN 1 AND 500
  ),
  CONSTRAINT "privacy_requests_verification_check" CHECK (
    ("identity_verified_at" IS NULL AND "identity_verified_by_id" IS NULL)
    OR ("identity_verified_at" IS NOT NULL AND "identity_verified_by_id" IS NOT NULL)
  ),
  CONSTRAINT "privacy_requests_completion_check" CHECK (
    ("status" NOT IN ('COMPLETED', 'REJECTED', 'CANCELLED') AND "completed_at" IS NULL AND "completed_by_id" IS NULL)
    OR ("status" IN ('COMPLETED', 'REJECTED', 'CANCELLED') AND "completed_at" IS NOT NULL AND "completed_by_id" IS NOT NULL)
  )
);

CREATE TABLE "privacy_request_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "request_id" UUID NOT NULL,
  "from_status" "PrivacyRequestStatus",
  "to_status" "PrivacyRequestStatus" NOT NULL,
  "actor_id" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "privacy_request_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "privacy_request_events_reason_check" CHECK (
    char_length(btrim("reason")) BETWEEN 1 AND 500
  )
);

CREATE TABLE "retention_policy_versions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "category" "RetentionCategory" NOT NULL,
  "version" INTEGER NOT NULL,
  "duration_days" INTEGER NOT NULL,
  "status" "RetentionPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "effective_from" TIMESTAMPTZ(3),
  "approval_reference" VARCHAR(160),
  "created_by_id" UUID NOT NULL,
  "activated_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMPTZ(3),
  CONSTRAINT "retention_policy_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_policy_versions_organization_id_category_version_key" UNIQUE ("organization_id", "category", "version"),
  CONSTRAINT "retention_policy_versions_positive_check" CHECK (
    "version" > 0 AND "duration_days" BETWEEN 1 AND 36500 AND "revision" > 0
  ),
  CONSTRAINT "retention_policy_versions_lifecycle_check" CHECK (
    ("status" = 'DRAFT' AND "effective_from" IS NULL AND "approval_reference" IS NULL AND "activated_by_id" IS NULL AND "activated_at" IS NULL)
    OR
    ("status" = 'ACTIVE' AND "effective_from" IS NOT NULL AND "approval_reference" IS NOT NULL AND "activated_by_id" IS NOT NULL AND "activated_at" IS NOT NULL)
    OR
    ("status" = 'CANCELLED')
  )
);

ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_anonymized_by_id_fkey" FOREIGN KEY ("anonymized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_customer_contacts" ADD CONSTRAINT "order_customer_contacts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_customer_contacts" ADD CONSTRAINT "order_customer_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_customer_contacts" ADD CONSTRAINT "order_customer_contacts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_customer_contacts" ADD CONSTRAINT "order_customer_contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_data_access_events" ADD CONSTRAINT "customer_data_access_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_data_access_events" ADD CONSTRAINT "customer_data_access_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_data_access_events" ADD CONSTRAINT "customer_data_access_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_identity_verified_by_id_fkey" FOREIGN KEY ("identity_verified_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "privacy_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_policy_versions" ADD CONSTRAINT "retention_policy_versions_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "customer_profiles_organization_id_status_updated_at_idx" ON "customer_profiles"("organization_id", "status", "updated_at");
CREATE INDEX "customer_profiles_organization_id_phone_blind_index_idx" ON "customer_profiles"("organization_id", "phone_blind_index");
CREATE INDEX "customer_profiles_organization_id_email_blind_index_idx" ON "customer_profiles"("organization_id", "email_blind_index");
CREATE INDEX "customer_profiles_created_by_id_created_at_idx" ON "customer_profiles"("created_by_id", "created_at");
CREATE INDEX "order_customer_contacts_organization_id_customer_id_created_at_idx" ON "order_customer_contacts"("organization_id", "customer_id", "created_at");
CREATE INDEX "order_customer_contacts_branch_id_phone_blind_index_idx" ON "order_customer_contacts"("branch_id", "phone_blind_index");
CREATE INDEX "customer_consent_events_current_idx" ON "customer_consent_events"("organization_id", "customer_id", "purpose", "channel", "occurred_at");
CREATE INDEX "customer_data_access_events_organization_id_occurred_at_idx" ON "customer_data_access_events"("organization_id", "occurred_at");
CREATE INDEX "customer_data_access_events_customer_id_occurred_at_idx" ON "customer_data_access_events"("customer_id", "occurred_at");
CREATE INDEX "customer_data_access_events_actor_id_occurred_at_idx" ON "customer_data_access_events"("actor_id", "occurred_at");
CREATE INDEX "privacy_requests_organization_id_status_created_at_idx" ON "privacy_requests"("organization_id", "status", "created_at");
CREATE INDEX "privacy_requests_customer_id_created_at_idx" ON "privacy_requests"("customer_id", "created_at");
CREATE INDEX "privacy_request_events_request_id_occurred_at_idx" ON "privacy_request_events"("request_id", "occurred_at");
CREATE INDEX "retention_policy_versions_organization_id_category_status_effective_from_idx" ON "retention_policy_versions"("organization_id", "category", "status", "effective_from");
CREATE UNIQUE INDEX "retention_policy_versions_one_active_idx" ON "retention_policy_versions"("organization_id", "category") WHERE "status" = 'ACTIVE';

CREATE OR REPLACE FUNCTION "customer_privacy_user_belongs"(source_user UUID, source_organization UUID) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = source_user AND u."organization_id" = source_organization);
$$;

CREATE OR REPLACE FUNCTION "customer_profile_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "customer_privacy_user_belongs"(NEW."created_by_id", NEW."organization_id")
    OR (NEW."anonymized_by_id" IS NOT NULL AND NOT "customer_privacy_user_belongs"(NEW."anonymized_by_id", NEW."organization_id")) THEN
    RAISE EXCEPTION 'customer profile actor organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_profiles_tenant_guard" BEFORE INSERT OR UPDATE ON "customer_profiles" FOR EACH ROW EXECUTE FUNCTION "customer_profile_tenant_guard"();

CREATE OR REPLACE FUNCTION "customer_history_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."customer_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customer_profiles" c WHERE c."id" = NEW."customer_id" AND c."organization_id" = NEW."organization_id"))
    OR NOT "customer_privacy_user_belongs"(NEW."actor_id", NEW."organization_id") THEN
    RAISE EXCEPTION 'customer history organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_consent_events_tenant_guard" BEFORE INSERT ON "customer_consent_events" FOR EACH ROW EXECUTE FUNCTION "customer_history_tenant_guard"();
CREATE TRIGGER "customer_data_access_events_tenant_guard" BEFORE INSERT ON "customer_data_access_events" FOR EACH ROW EXECUTE FUNCTION "customer_history_tenant_guard"();

CREATE OR REPLACE FUNCTION "privacy_request_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "customer_profiles" c WHERE c."id" = NEW."customer_id" AND c."organization_id" = NEW."organization_id")
    OR NOT "customer_privacy_user_belongs"(NEW."created_by_id", NEW."organization_id")
    OR (NEW."identity_verified_by_id" IS NOT NULL AND NOT "customer_privacy_user_belongs"(NEW."identity_verified_by_id", NEW."organization_id"))
    OR (NEW."completed_by_id" IS NOT NULL AND NOT "customer_privacy_user_belongs"(NEW."completed_by_id", NEW."organization_id")) THEN
    RAISE EXCEPTION 'privacy request organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "privacy_requests_tenant_guard" BEFORE INSERT OR UPDATE ON "privacy_requests" FOR EACH ROW EXECUTE FUNCTION "privacy_request_tenant_guard"();

CREATE OR REPLACE FUNCTION "privacy_request_event_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_organization UUID;
BEGIN
  SELECT "organization_id" INTO source_organization FROM "privacy_requests" WHERE "id" = NEW."request_id";
  IF source_organization IS NULL OR NOT "customer_privacy_user_belongs"(NEW."actor_id", source_organization) THEN
    RAISE EXCEPTION 'privacy request event organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "privacy_request_events_tenant_guard" BEFORE INSERT ON "privacy_request_events" FOR EACH ROW EXECUTE FUNCTION "privacy_request_event_tenant_guard"();

CREATE OR REPLACE FUNCTION "retention_policy_tenant_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT "customer_privacy_user_belongs"(NEW."created_by_id", NEW."organization_id")
    OR (NEW."activated_by_id" IS NOT NULL AND NOT "customer_privacy_user_belongs"(NEW."activated_by_id", NEW."organization_id")) THEN
    RAISE EXCEPTION 'retention policy actor organization mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "retention_policy_versions_tenant_guard" BEFORE INSERT OR UPDATE ON "retention_policy_versions" FOR EACH ROW EXECUTE FUNCTION "retention_policy_tenant_guard"();

CREATE OR REPLACE FUNCTION "customer_privacy_append_only_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'customer privacy history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "customer_consent_events_reject_update" BEFORE UPDATE OR DELETE ON "customer_consent_events" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();
CREATE TRIGGER "customer_data_access_events_reject_update" BEFORE UPDATE OR DELETE ON "customer_data_access_events" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();
CREATE TRIGGER "privacy_request_events_reject_update" BEFORE UPDATE OR DELETE ON "privacy_request_events" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();

CREATE OR REPLACE FUNCTION "customer_profile_lifecycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."organization_id" <> NEW."organization_id" OR OLD."created_by_id" <> NEW."created_by_id" OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'customer profile ownership and creation facts are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'ANONYMIZED' AND NEW."status" <> 'ANONYMIZED' THEN
    RAISE EXCEPTION 'anonymized customer profiles cannot be restored' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'customer profile revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_profiles_lifecycle_guard" BEFORE UPDATE ON "customer_profiles" FOR EACH ROW EXECUTE FUNCTION "customer_profile_lifecycle_guard"();
CREATE TRIGGER "customer_profiles_reject_delete" BEFORE DELETE ON "customer_profiles" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();

CREATE OR REPLACE FUNCTION "order_customer_contact_scope_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_order "orders"%ROWTYPE; source_customer "customer_profiles"%ROWTYPE;
BEGIN
  SELECT * INTO source_order FROM "orders" WHERE "id" = NEW."order_id";
  IF source_order."branch_id" <> NEW."branch_id" THEN
    RAISE EXCEPTION 'order customer contact branch mismatch' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."id" = NEW."branch_id" AND b."organization_id" = NEW."organization_id") THEN
    RAISE EXCEPTION 'order customer contact organization mismatch' USING ERRCODE = '23514';
  END IF;
  IF NEW."customer_id" IS NOT NULL THEN
    SELECT * INTO source_customer FROM "customer_profiles" WHERE "id" = NEW."customer_id";
    IF source_customer."organization_id" <> NEW."organization_id" THEN
      RAISE EXCEPTION 'order customer profile organization mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "order_customer_contacts_scope_guard" BEFORE INSERT OR UPDATE ON "order_customer_contacts" FOR EACH ROW EXECUTE FUNCTION "order_customer_contact_scope_guard"();
CREATE OR REPLACE FUNCTION "order_customer_contact_lifecycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."order_id" <> NEW."order_id" OR OLD."organization_id" <> NEW."organization_id" OR OLD."branch_id" <> NEW."branch_id" OR OLD."customer_id" IS DISTINCT FROM NEW."customer_id" OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'order customer contact ownership is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."anonymized_at" IS NOT NULL OR NEW."anonymized_at" IS NULL THEN
    RAISE EXCEPTION 'order customer contact snapshots are immutable except for anonymization' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "order_customer_contacts_lifecycle_guard" BEFORE UPDATE ON "order_customer_contacts" FOR EACH ROW EXECUTE FUNCTION "order_customer_contact_lifecycle_guard"();
CREATE TRIGGER "order_customer_contacts_reject_delete" BEFORE DELETE ON "order_customer_contacts" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();

CREATE OR REPLACE FUNCTION "orders_reject_new_plaintext_customer_pii"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."customer_phone" IS NOT NULL OR NEW."delivery_directions" IS NOT NULL THEN
    RAISE EXCEPTION 'new order customer PII must use the encrypted contact record' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "orders_reject_new_plaintext_customer_pii" BEFORE INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION "orders_reject_new_plaintext_customer_pii"();

CREATE OR REPLACE FUNCTION "privacy_request_lifecycle_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."organization_id" <> NEW."organization_id" OR OLD."customer_id" <> NEW."customer_id" OR OLD."request_type" <> NEW."request_type" OR OLD."created_by_id" <> NEW."created_by_id" OR OLD."created_at" <> NEW."created_at" THEN
    RAISE EXCEPTION 'privacy request identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION 'privacy request revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    (OLD."status" = 'RECEIVED' AND NEW."status" IN ('IDENTITY_VERIFIED', 'REJECTED', 'CANCELLED'))
    OR (OLD."status" = 'IDENTITY_VERIFIED' AND NEW."status" IN ('IN_PROGRESS', 'REJECTED', 'CANCELLED'))
    OR (OLD."status" = 'IN_PROGRESS' AND NEW."status" IN ('COMPLETED', 'REJECTED'))
  ) THEN
    RAISE EXCEPTION 'invalid privacy request transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "privacy_requests_lifecycle_guard" BEFORE UPDATE ON "privacy_requests" FOR EACH ROW EXECUTE FUNCTION "privacy_request_lifecycle_guard"();
CREATE TRIGGER "privacy_requests_reject_delete" BEFORE DELETE ON "privacy_requests" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();

CREATE OR REPLACE FUNCTION "retention_policy_active_immutable_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'ACTIVE' THEN
    RAISE EXCEPTION 'active retention policy versions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "retention_policy_active_immutable_guard" BEFORE UPDATE ON "retention_policy_versions" FOR EACH ROW EXECUTE FUNCTION "retention_policy_active_immutable_guard"();
CREATE TRIGGER "retention_policy_reject_delete" BEFORE DELETE ON "retention_policy_versions" FOR EACH ROW EXECUTE FUNCTION "customer_privacy_append_only_guard"();

INSERT INTO "permissions" ("key", "description") VALUES
  ('customers.read', 'View minimized organization customer profiles'),
  ('customers.create', 'Create encrypted customer profiles'),
  ('customers.manage', 'Correct, restrict and manage customer profiles and consent'),
  ('customers.pii.read', 'View decrypted customer contact data with an access reason'),
  ('customer-data.export', 'Export one customer data package with an access reason'),
  ('privacy.requests.read', 'View organization privacy request history'),
  ('privacy.requests.manage', 'Verify and progress customer privacy requests'),
  ('privacy.policies.read', 'View retention policy drafts and previews'),
  ('privacy.policies.manage', 'Create and activate approved retention policies')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
