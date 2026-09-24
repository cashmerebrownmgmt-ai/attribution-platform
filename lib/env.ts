import "server-only";

/** Read a required server-side environment variable, failing loudly if it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
