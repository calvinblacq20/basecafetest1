import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(
    process.cwd(),
    "packages/database/prisma/migrations/202608080002_customer_privacy_foundation/migration.sql",
  ),
  "utf8",
);

describe("customer privacy migration", () => {
  it.each([
    "customer_profiles",
    "order_customer_contacts",
    "customer_consent_events",
    "customer_data_access_events",
    "privacy_requests",
    "privacy_request_events",
    "retention_policy_versions",
    "customer_privacy_append_only_guard",
    "customer_profile_lifecycle_guard",
    "orders_reject_new_plaintext_customer_pii",
    "retention_policy_active_immutable_guard",
    "retention_policy_versions_one_active_idx",
    "customer_profiles_tenant_guard",
    "customer_history_tenant_guard",
    "privacy_requests_tenant_guard",
    "privacy_request_events_tenant_guard",
    "retention_policy_versions_tenant_guard",
  ])("contains %s", (guard) => expect(sql).toContain(guard));

  it.each([
    "customers.pii.read",
    "customer-data.export",
    "privacy.requests.manage",
    "privacy.policies.manage",
  ])("adds permission %s", (permission) => expect(sql).toContain(permission));
});
