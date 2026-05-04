import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createSecretToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function shortId(value: string, length = 12): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, length);
}
