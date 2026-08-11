CREATE TYPE "LoginThrottleScope" AS ENUM ('ACCOUNT', 'DEVICE', 'IP');

CREATE TABLE "login_throttle_buckets" (
    "scope" "LoginThrottleScope" NOT NULL,
    "key_hash" CHAR(64) NOT NULL,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttle_buckets_pkey" PRIMARY KEY ("scope", "key_hash"),
    CONSTRAINT "login_throttle_buckets_failure_count_check" CHECK ("failure_count" >= 0),
    CONSTRAINT "login_throttle_buckets_key_hash_check" CHECK ("key_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "login_throttle_buckets_lock_range_check"
      CHECK ("locked_until" IS NULL OR "locked_until" > "window_started_at")
);

CREATE INDEX "login_throttle_buckets_locked_until_idx"
  ON "login_throttle_buckets"("locked_until");
CREATE INDEX "login_throttle_buckets_updated_at_idx"
  ON "login_throttle_buckets"("updated_at");
