/**
 * Import Meta ads data: npx tsx --env-file=.env.local scripts/meta-sync.ts [--days 90] [--dry-run]
 * Needs META_ACCESS_TOKEN (system user token with ads_read) and META_AD_ACCOUNT_ID; META_APP_SECRET is optional.
 */
import { createClient } from "@supabase/supabase-js";
import { MetaApiError, metaClient, syncMeta } from "../lib/meta";
import { makeMetaStore } from "../lib/meta-store";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const days = Number(flag("--days") ?? 90);
const dryRun = args.includes("--dry-run");

const { META_ACCESS_TOKEN: token, META_AD_ACCOUNT_ID: accountId, META_APP_SECRET: appSecret, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
if (!token || !accountId) {
  console.error("Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in .env.local first.");
  process.exit(1);
}
if (!Number.isInteger(days) || days < 1 || days > 1000) {
  console.error("--days must be a whole number from 1 to 1000.");
  process.exit(1);
}
if (!dryRun && (!url || !key)) {
  console.error("Supabase environment variables are missing.");
  process.exit(1);
}

const until = new Date().toISOString().slice(0, 10);
const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
const db = createClient(url ?? "http://unused", key ?? "unused", { auth: { persistSession: false } });

async function main() {
  console.log(`Syncing Meta ad account ${accountId} from ${since} to ${until}${dryRun ? " (dry run: nothing is written)" : ""}…`);
  const summary = await syncMeta({ client: metaClient({ token: token!, appSecret }), store: makeMetaStore(() => db) }, { accountId: accountId!, since, until, dryRun });
  console.log(summary);
}

main().catch((e) => {
  if (e instanceof MetaApiError) console.error(`Meta API error${e.code !== null ? ` (code ${e.code})` : ""}: ${e.message}`);
  else console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
