import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Check an HTTP Basic Authorization header against the debug password (any username).
 * Constant-time; always false when no password is configured.
 */
export function checkBasicAuth(header: string | null, password: string | undefined): boolean {
  if (!password || !header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const i = decoded.indexOf(":");
  if (i < 0) return false;
  return timingSafeEqual(digest(decoded.slice(i + 1)), digest(password));
}
