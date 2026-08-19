/**
 * Instance-key encryption for per-source config.
 *
 * Ciphertext is AES-256-GCM sealed with ANYKPI_SECRET. Stored bytes are
 * never plaintext JSON. Do not log the secret, the plaintext, or the blob.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const PREFIX = "v1:";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const SALT = "anykpi-sources-v1";

export function instanceSecret(): string | undefined {
  const secret = process.env.ANYKPI_SECRET;
  if (!secret || secret.trim().length === 0) return undefined;
  return secret;
}

function keyBytes(): Buffer {
  const secret = instanceSecret();
  if (!secret) {
    throw new Error("ANYKPI_SECRET is required");
  }
  return scryptSync(secret, SALT, KEY_LEN);
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptJson<T>(blob: string): T {
  if (!blob.startsWith(PREFIX)) {
    throw new Error("unsupported ciphertext");
  }
  const buf = Buffer.from(blob.slice(PREFIX.length), "base64");
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error("unsupported ciphertext");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
