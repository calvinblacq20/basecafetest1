import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  encryptArchive,
  encryptionKey,
  positiveInteger,
  postgresEnvironment,
  pruneExpiredBackups,
  removeIfPresent,
  required,
  runCommand,
  safeAbsoluteDirectory,
  safeError,
  safeLabel,
  sha256File,
  writeJsonExclusive,
  writeLatestStatus,
} from "./backup/archive.mjs";

async function latestSchemaVersion() {
  if (process.env.BACKUP_SCHEMA_VERSION?.trim())
    return process.env.BACKUP_SCHEMA_VERSION.trim();
  const directory = path.resolve("packages/database/prisma/migrations");
  const migrations = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return migrations.at(-1) ?? "SCHEMA_VERSION_UNAVAILABLE";
}

async function main() {
  if (process.env.BACKUP_ENABLED !== "true")
    throw new Error(
      "Backup execution is disabled. Set BACKUP_ENABLED=true explicitly.",
    );

  const startedAt = new Date();
  const backupId = randomUUID();
  const backupDirectory = safeAbsoluteDirectory(
    process.env.BACKUP_DIRECTORY,
    "BACKUP_DIRECTORY",
  );
  const retentionDays = positiveInteger(
    process.env.BACKUP_RETENTION_DAYS,
    "BACKUP_RETENTION_DAYS",
  );
  const sourceLabel = safeLabel(
    process.env.BACKUP_SOURCE_LABEL,
    "BACKUP_SOURCE_LABEL",
  );
  const key = encryptionKey(process.env.BACKUP_ENCRYPTION_KEY_B64);
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  const pgDump = process.env.PG_DUMP_PATH?.trim() || "pg_dump";
  const applicationVersion = process.env.APP_VERSION?.trim() || "0.1.0";
  const schemaVersion = await latestSchemaVersion();
  const timestamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const baseName = `base-cafe-${timestamp}-${backupId}`;
  const archiveName = `${baseName}.bcpos`;
  const manifestName = `${baseName}.manifest.json`;
  const archivePath = path.join(backupDirectory, archiveName);
  const manifestPath = path.join(backupDirectory, manifestName);
  const statusPath = path.join(backupDirectory, "backup-status.json");
  const workDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "base-cafe-backup-"),
  );
  const plainArchivePath = path.join(workDirectory, `${backupId}.dump`);

  await fs.mkdir(backupDirectory, { recursive: true });
  try {
    await runCommand(
      pgDump,
      [
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        `--file=${plainArchivePath}`,
      ],
      postgresEnvironment(databaseUrl),
    );
    await encryptArchive(plainArchivePath, archivePath, key, randomBytes(12));
    const checksumSha256 = await sha256File(archivePath);
    const archiveDetails = await fs.stat(archivePath);
    const completedAt = new Date();
    const retentionUntil = new Date(
      completedAt.getTime() + retentionDays * 86_400_000,
    );
    const manifest = {
      formatVersion: 1,
      backupId,
      sourceLabel,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      retentionUntil: retentionUntil.toISOString(),
      encryptedFile: archiveName,
      encryption: "AES-256-GCM",
      checksumAlgorithm: "SHA-256",
      checksumSha256,
      bytes: archiveDetails.size,
      applicationVersion,
      schemaVersion,
    };
    await writeJsonExclusive(manifestPath, manifest);
    const removed = await pruneExpiredBackups(backupDirectory, completedAt);
    await writeLatestStatus(statusPath, {
      status: "SUCCEEDED",
      lastSuccessAt: completedAt.toISOString(),
      latestManifest: manifestName,
      sourceLabel,
    });
    const evidence = {
      evidenceId: backupId,
      kind: "BACKUP",
      outcome: "SUCCEEDED",
      source: "LOCAL_ENCRYPTED_ARCHIVE",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      encrypted: true,
      checksumSha256,
      artifactReference: archiveName,
      retentionUntil: retentionUntil.toISOString(),
      applicationVersion,
      schemaVersion,
      checks: { archiveCreated: true, checksumRecorded: true },
      reason: "Automated encrypted database backup completed.",
    };
    const evidencePath = path.join(
      backupDirectory,
      `${baseName}.evidence.json`,
    );
    await writeJsonExclusive(evidencePath, evidence);
    process.stdout.write(
      `${JSON.stringify({ status: "SUCCEEDED", manifest: manifestName, evidence: path.basename(evidencePath), pruned: removed })}\n`,
    );
  } catch (error) {
    await removeIfPresent(archivePath);
    const completedAt = new Date();
    const failureCode = /^[A-Z0-9][A-Z0-9_:-]{0,79}$/.test(error?.code ?? "")
      ? error.code
      : "BACKUP_JOB_FAILED";
    const failureMessage = safeError(error);
    await writeLatestStatus(statusPath, {
      status: "FAILED",
      lastFailureAt: completedAt.toISOString(),
      failureCode,
      safeFailureMessage: failureMessage,
      sourceLabel,
    });
    const failedEvidenceName = `${baseName}.failed.evidence.json`;
    await writeJsonExclusive(path.join(backupDirectory, failedEvidenceName), {
      evidenceId: backupId,
      kind: "BACKUP",
      outcome: "FAILED",
      source: "LOCAL_ENCRYPTED_ARCHIVE",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      encrypted: true,
      checksumSha256: null,
      artifactReference: null,
      retentionUntil: null,
      applicationVersion,
      schemaVersion,
      checks: {},
      failureCode,
      safeFailureMessage: failureMessage,
      reason: "Automated encrypted database backup failed.",
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
