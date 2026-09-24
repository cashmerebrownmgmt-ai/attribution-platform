import { createHash } from "node:crypto";

/** SHA-256 of a trimmed, lowercased email. Raw emails are never stored. */
export function hashEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : null;
}
