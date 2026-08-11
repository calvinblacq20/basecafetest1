import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  databaseFingerprint,
  decryptArchive,
  encryptArchive,
  encryptionKey,
  postgresEnvironment,
  pruneExpiredBackups,
  safeAbsoluteDirectory,
  sha256File,
} from "./archive.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "bcpos-archive-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

describe("encrypted backup archive helpers", () => {
  it("round-trips an archive and rejects tampering", async () => {
    const directory = await temporaryDirectory();
    const source = path.join(directory, "source.dump");
    const encrypted = path.join(directory, "backup.bcpos");
    const restored = path.join(directory, "restored.dump");
    const key = randomBytes(32);
    await fs.writeFile(source, randomBytes(8_192));

    await encryptArchive(source, encrypted, key, randomBytes(12));
    await decryptArchive(encrypted, restored, key);
    expect(await fs.readFile(restored)).toEqual(await fs.readFile(source));
    expect(await sha256File(encrypted)).toMatch(/^[a-f0-9]{64}$/);

    const bytes = await fs.readFile(encrypted);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    await fs.writeFile(encrypted, bytes);
    await expect(
      decryptArchive(encrypted, path.join(directory, "tampered.dump"), key),
    ).rejects.toThrow();
  });

  it("requires a 32-byte key and a non-root absolute backup directory", () => {
    expect(() => encryptionKey(Buffer.alloc(31).toString("base64"))).toThrow(
      "exactly 32 bytes",
    );
    expect(() =>
      safeAbsoluteDirectory(path.parse(process.cwd()).root, "TEST"),
    ).toThrow("cannot be a filesystem root");
  });

  it("uses PostgreSQL environment variables without putting secrets in a fingerprint", () => {
    const url =
      "postgresql://operator:very-secret@db.example.test:5433/base_cafe_restore?sslmode=require";
    const environment = postgresEnvironment(url, {});
    expect(environment).toMatchObject({
      PGHOST: "db.example.test",
      PGPORT: "5433",
      PGDATABASE: "base_cafe_restore",
      PGUSER: "operator",
      PGPASSWORD: "very-secret",
      PGSSLMODE: "require",
    });
    expect(databaseFingerprint(url)).not.toContain("very-secret");
  });

  it("prunes only expired manifest-owned archives", async () => {
    const directory = await temporaryDirectory();
    await fs.writeFile(path.join(directory, "expired.bcpos"), "expired");
    await fs.writeFile(path.join(directory, "active.bcpos"), "active");
    await fs.writeFile(path.join(directory, "unrelated.txt"), "keep");
    await fs.writeFile(
      path.join(directory, "expired.manifest.json"),
      JSON.stringify({
        retentionUntil: "2026-08-01T00:00:00.000Z",
        encryptedFile: "expired.bcpos",
      }),
    );
    await fs.writeFile(
      path.join(directory, "active.manifest.json"),
      JSON.stringify({
        retentionUntil: "2026-09-01T00:00:00.000Z",
        encryptedFile: "active.bcpos",
      }),
    );

    const removed = await pruneExpiredBackups(
      directory,
      new Date("2026-08-08T00:00:00.000Z"),
    );
    expect(removed).toHaveLength(1);
    await expect(
      fs.stat(path.join(directory, "expired.bcpos")),
    ).rejects.toThrow();
    await expect(
      fs.stat(path.join(directory, "active.bcpos")),
    ).resolves.toBeDefined();
    await expect(
      fs.stat(path.join(directory, "unrelated.txt")),
    ).resolves.toBeDefined();
  });
});
