import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("BCPOSB01", "ascii");
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function positiveInteger(value, name) {
  const parsed = Number.parseInt(required(value, name), 10);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function safeLabel(value, name) {
  const label = required(value, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(label))
    throw new Error(`${name} must be a safe label of at most 80 characters.`);
  return label;
}

export function safeAbsoluteDirectory(value, name) {
  const supplied = required(value, name);
  if (!path.isAbsolute(supplied))
    throw new Error(`${name} must be an absolute path.`);
  const resolved = path.resolve(supplied);
  if (resolved === path.parse(resolved).root)
    throw new Error(`${name} cannot be a filesystem root.`);
  return resolved;
}

export function assertWithin(parentDirectory, candidatePath, name) {
  const parent = path.resolve(parentDirectory);
  const candidate = path.resolve(candidatePath);
  if (candidate !== parent && !candidate.startsWith(`${parent}${path.sep}`))
    throw new Error(
      `${name} must remain inside the configured backup directory.`,
    );
  return candidate;
}

export function encryptionKey(value) {
  const key = Buffer.from(
    required(value, "BACKUP_ENCRYPTION_KEY_B64"),
    "base64",
  );
  if (key.length !== 32)
    throw new Error(
      "BACKUP_ENCRYPTION_KEY_B64 must decode to exactly 32 bytes.",
    );
  return key;
}

export function postgresEnvironment(
  databaseUrl,
  baseEnvironment = process.env,
) {
  const parsed = new URL(required(databaseUrl, "database URL"));
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("Only PostgreSQL database URLs are supported.");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !database)
    throw new Error("The PostgreSQL URL requires a host and database name.");
  const environment = {
    ...baseEnvironment,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
  };
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

export function databaseFingerprint(databaseUrl) {
  const parsed = new URL(required(databaseUrl, "database URL"));
  return [
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    decodeURIComponent(parsed.username),
  ].join("|");
}

export async function runCommand(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(
        `${path.basename(command)} exited with code ${code}.`,
      );
      error.code = "EXTERNAL_COMMAND_FAILED";
      error.details = stderr.slice(0, 2_000);
      reject(error);
    });
  });
}

export async function encryptArchive(inputPath, outputPath, key, iv) {
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  await fs.writeFile(outputPath, Buffer.concat([MAGIC, iv]), { flag: "wx" });
  await pipeline(
    createReadStream(inputPath),
    cipher,
    createWriteStream(outputPath, { flags: "a" }),
  );
  await fs.appendFile(outputPath, cipher.getAuthTag());
}

export async function decryptArchive(inputPath, outputPath, key) {
  const details = await fs.stat(inputPath);
  const minimumLength = MAGIC.length + IV_LENGTH + TAG_LENGTH + 1;
  if (details.size < minimumLength)
    throw new Error("Encrypted archive is truncated.");

  const handle = await fs.open(inputPath, "r");
  try {
    const header = Buffer.alloc(MAGIC.length + IV_LENGTH);
    const tag = Buffer.alloc(TAG_LENGTH);
    await handle.read(header, 0, header.length, 0);
    await handle.read(tag, 0, tag.length, details.size - TAG_LENGTH);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error("Encrypted archive format is not recognized.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      header.subarray(MAGIC.length),
    );
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(inputPath, {
        start: header.length,
        end: details.size - TAG_LENGTH - 1,
      }),
      decipher,
      createWriteStream(outputPath, { flags: "wx" }),
    );
  } finally {
    await handle.close();
  }
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function writeJsonExclusive(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export async function writeLatestStatus(filePath, value) {
  const temporaryPath = `${filePath}.${randomUUID()}.partial`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
    await removeIfPresent(filePath);
    await fs.rename(temporaryPath, filePath);
  }
}

export async function removeIfPresent(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : "Unknown failure.";
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgresql://[REDACTED]")
    .slice(0, 500);
}

export async function pruneExpiredBackups(backupDirectory, now = new Date()) {
  const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
  const removed = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".manifest.json")) continue;
    const manifestPath = assertWithin(
      backupDirectory,
      path.join(backupDirectory, entry.name),
      "manifest path",
    );
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }
    const retentionUntil = Date.parse(manifest.retentionUntil ?? "");
    if (!Number.isFinite(retentionUntil) || retentionUntil >= now.getTime())
      continue;
    const archiveName = path.basename(manifest.encryptedFile ?? "");
    if (!archiveName || archiveName !== manifest.encryptedFile) continue;
    const archivePath = assertWithin(
      backupDirectory,
      path.join(backupDirectory, archiveName),
      "archive path",
    );
    await removeIfPresent(archivePath);
    await fs.unlink(manifestPath);
    removed.push({ manifest: entry.name, archive: archiveName });
  }
  return removed;
}
