import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string) {
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of input.replaceAll("=", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("MFA_SECRET_INVALID");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, at = new Date(), stepOffset = 0) {
  const counter = BigInt(Math.floor(at.getTime() / 30_000) + stepOffset);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32Decode(secret))
    .update(message)
    .digest();
  const offset = (digest[19] ?? 0) & 15;
  const binary =
    (((digest[offset] ?? 0) & 127) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, at = new Date()) {
  return [-1, 0, 1].some((offset) => totpCode(secret, at, offset) === code);
}

export function deterministicRecoveryCodes(
  secret: string,
  idempotencyKey: string,
) {
  return Array.from({ length: 8 }, (_, index) => {
    const encoded = base32Encode(
      createHmac("sha256", base32Decode(secret))
        .update(`recovery:${idempotencyKey}:${index}`)
        .digest()
        .subarray(0, 10),
    );
    return encoded.match(/.{1,4}/g)?.join("-") ?? encoded;
  });
}

export function recoveryCodeHash(secret: string, code: string) {
  return createHmac("sha256", base32Decode(secret))
    .update(code.replaceAll("-", "").toUpperCase())
    .digest("hex");
}

function encryptionKey(environment: NodeJS.ProcessEnv) {
  const encoded = environment.MFA_ENCRYPTION_KEY_B64?.trim();
  if (!encoded) throw new Error("MFA_ENCRYPTION_KEY_MISSING");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("MFA_ENCRYPTION_KEY_INVALID");
  return key;
}

export function encryptMfaSecret(
  secret: string,
  environment: NodeJS.ProcessEnv,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(environment), iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptMfaSecret(
  payload: Uint8Array,
  environment: NodeJS.ProcessEnv,
) {
  const bytes = Buffer.from(payload);
  if (bytes.length < 29) throw new Error("MFA_SECRET_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(environment),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
