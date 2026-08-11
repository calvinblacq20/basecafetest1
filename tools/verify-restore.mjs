import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertWithin,
  databaseFingerprint,
  decryptArchive,
  encryptionKey,
  postgresEnvironment,
  removeIfPresent,
  required,
  runCommand,
  safeAbsoluteDirectory,
  safeError,
  safeLabel,
  sha256File,
  writeJsonExclusive,
} from "./backup/archive.mjs";

const integrityQuery = `SELECT json_build_object(
  'organizations', (SELECT count(*) FROM organizations),
  'orders', (SELECT count(*) FROM orders),
  'payments', (SELECT count(*) FROM payments),
  'auditLogs', (SELECT count(*) FROM audit_logs),
  'stockLedgerEntries', (SELECT count(*) FROM stock_ledger_entries)
)::text;`;

async function main() {
  if (process.env.RESTORE_EXECUTE !== "true")
    throw new Error(
      "Restore execution is disabled. Set RESTORE_EXECUTE=true explicitly.",
    );

  const evidenceId = randomUUID();
  const startedAt = new Date();
  const backupDirectory = safeAbsoluteDirectory(
    process.env.BACKUP_DIRECTORY,
    "BACKUP_DIRECTORY",
  );
  const suppliedManifestPath = required(
    process.env.RESTORE_MANIFEST_PATH,
    "RESTORE_MANIFEST_PATH",
  );
  const manifestPath = assertWithin(
    backupDirectory,
    suppliedManifestPath,
    "RESTORE_MANIFEST_PATH",
  );
  const targetLabel = safeLabel(
    process.env.RESTORE_TARGET_LABEL,
    "RESTORE_TARGET_LABEL",
  );
  if (process.env.RESTORE_CONFIRM_TARGET !== targetLabel)
    throw new Error(
      "RESTORE_CONFIRM_TARGET must exactly match RESTORE_TARGET_LABEL.",
    );

  const sourceDatabaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  const targetDatabaseUrl = required(
    process.env.RESTORE_DATABASE_URL,
    "RESTORE_DATABASE_URL",
  );
  if (
    databaseFingerprint(sourceDatabaseUrl) ===
    databaseFingerprint(targetDatabaseUrl)
  )
    throw new Error("Restore target must not be the source database.");

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (
    manifest.formatVersion !== 1 ||
    !manifest.encryptedFile ||
    !manifest.backupId
  )
    throw new Error("Backup manifest is invalid or unsupported.");
  const archiveName = path.basename(manifest.encryptedFile);
  if (archiveName !== manifest.encryptedFile)
    throw new Error("Backup manifest contains an unsafe archive reference.");
  const archivePath = assertWithin(
    backupDirectory,
    path.join(backupDirectory, archiveName),
    "encrypted archive",
  );
  const checksum = await sha256File(archivePath);
  if (checksum !== manifest.checksumSha256)
    throw new Error("Encrypted backup checksum does not match the manifest.");

  const workDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "base-cafe-restore-"),
  );
  const plainArchivePath = path.join(workDirectory, `${evidenceId}.dump`);
  const pgRestore = process.env.PG_RESTORE_PATH?.trim() || "pg_restore";
  const psql = process.env.PSQL_PATH?.trim() || "psql";
  try {
    await decryptArchive(
      archivePath,
      plainArchivePath,
      encryptionKey(process.env.BACKUP_ENCRYPTION_KEY_B64),
    );
    await runCommand(pgRestore, ["--list", plainArchivePath]);
    const targetEnvironment = postgresEnvironment(targetDatabaseUrl);
    await runCommand(
      pgRestore,
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        `--dbname=${targetEnvironment.PGDATABASE}`,
        plainArchivePath,
      ],
      targetEnvironment,
    );
    const integrityResult = await runCommand(
      psql,
      [
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        `--command=${integrityQuery}`,
      ],
      targetEnvironment,
    );
    const recordCounts = JSON.parse(integrityResult.stdout.trim());
    const completedAt = new Date();
    const evidence = {
      evidenceId,
      kind: "RESTORE_DRILL",
      outcome: "SUCCEEDED",
      source: "LOCAL_ENCRYPTED_ARCHIVE",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      encrypted: true,
      checksumSha256: checksum,
      artifactReference: archiveName,
      retentionUntil: manifest.retentionUntil ?? null,
      applicationVersion: manifest.applicationVersion,
      schemaVersion: manifest.schemaVersion,
      checks: {
        archiveReadable: true,
        databaseRestored: true,
        integrityQueriesPassed: true,
        ...recordCounts,
        targetLabel,
      },
      reason: "Isolated database restore and integrity drill completed.",
    };
    const evidenceName = `restore-${completedAt.toISOString().replace(/[:.]/g, "-")}-${evidenceId}.evidence.json`;
    await writeJsonExclusive(
      path.join(backupDirectory, evidenceName),
      evidence,
    );
    process.stdout.write(
      `${JSON.stringify({ status: "SUCCEEDED", evidence: evidenceName, targetLabel })}\n`,
    );
  } catch (error) {
    const completedAt = new Date();
    const failureCode = /^[A-Z0-9][A-Z0-9_:-]{0,79}$/.test(error?.code ?? "")
      ? error.code
      : "RESTORE_DRILL_FAILED";
    const evidenceName = `restore-${completedAt.toISOString().replace(/[:.]/g, "-")}-${evidenceId}.failed.evidence.json`;
    await writeJsonExclusive(path.join(backupDirectory, evidenceName), {
      evidenceId,
      kind: "RESTORE_DRILL",
      outcome: "FAILED",
      source: "LOCAL_ENCRYPTED_ARCHIVE",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      encrypted: true,
      checksumSha256: checksum,
      artifactReference: archiveName,
      retentionUntil: manifest.retentionUntil ?? null,
      applicationVersion: manifest.applicationVersion,
      schemaVersion: manifest.schemaVersion,
      checks: {},
      failureCode,
      safeFailureMessage: safeError(error),
      reason: "Isolated database restore and integrity drill failed.",
    });
    throw error;
  } finally {
    await removeIfPresent(plainArchivePath);
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ status: "FAILED", message: safeError(error) })}\n`,
  );
  process.exitCode = 1;
});
