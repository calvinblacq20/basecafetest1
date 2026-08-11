import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const extensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
]);
const excludedDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "generated_images",
]);
const excludedFiles = new Set(["pnpm-lock.yaml", "scan-secrets.mjs"]);
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["github-token", /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/],
  ["stripe-live-key", /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/],
];

const findings = [];
for await (const file of walk(root)) {
  const name = relative(root, file).replaceAll("\\", "/");
  if (
    !extensions.has(extname(file)) ||
    excludedFiles.has(name.split("/").at(-1))
  )
    continue;
  if (
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name) ||
    name.endsWith(".env.example")
  )
    continue;
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [rule, pattern] of rules) {
      if (pattern.test(lines[index]))
        findings.push({ file: name, line: index + 1, rule });
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(
    "Potential source secrets detected (values suppressed):\n",
  );
  for (const finding of findings)
    process.stderr.write(
      `- ${finding.file}:${finding.line} [${finding.rule}]\n`,
    );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "Secret scan passed: no high-confidence source credentials found.\n",
  );
}

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}
