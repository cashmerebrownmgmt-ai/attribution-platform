import { buildAudiences, MIN_SIZE, visitorRecipes, type AudiencePlatform } from "@/lib/audiences";
import { num } from "@/lib/dashboard/format";
import { loadPage } from "@/lib/dashboard/page";
import { todayUtc } from "@/lib/dashboard/data";
import { addDays } from "@/lib/metrics/compute";
import { loadSessions } from "@/lib/sessions-data";
import s from "../dashboard.module.css";
import { Card, PageHead } from "../_components/ui";

const PLATFORM_NAMES: Record<AudiencePlatform, string> = { meta: "Meta", google: "Google", tiktok: "TikTok" };
const PLATFORMS = Object.keys(PLATFORM_NAMES) as AudiencePlatform[];

const UPLOAD_STEPS: Record<AudiencePlatform, string> = {
  meta: "Ads Manager → Audiences → Create audience → Custom audience → Customer list. Upload the file and map the column to Email. Meta recognizes the values as already hashed.",
  google: "Google Ads → Tools → Shared library → Audience manager → + → Customer list. Choose “Upload hashed emails” and upload the file. Google only allows Customer Match for accounts that meet its eligibility rules (policy and payment history); if the option is missing, your account isn't eligible yet.",
  tiktok: "Ads Manager → Assets → Audiences → Create → Custom audience → Customer file. Choose ID type “Email SHA256” and upload the .txt file.",
};

export default async function AudiencesPage({ searchParams }: PageProps<"/dashboard/audiences">) {
  const { mode, data } = await loadPage(searchParams);
  const today = todayUtc();
  const asOf = Date.parse(data.generatedAt);
  const audiences = buildAudiences(data, asOf);
  const facts = await loadSessions(mode, { from: addDays(today, -29), to: today }, today);
  const recipes = visitorRecipes(facts, asOf);
  const all = audiences[0];
  const coverage = all.customers ? all.hashes.length / all.customers : 0;

  return (
    <>
      <PageHead title="Audiences" subtitle="Customer lists to upload to your ad platforms, and site-visitor audiences to build with your pixels" mode={mode} exportable={false} />

      {mode === "live" && coverage < 0.8 && (
        <div className={s.callout}>
          Only {num(all.hashes.length)} of {num(all.customers)} customers have an email on file, so these lists are small. Shopify only sends emails once your app has protected customer data access: in the Shopify Dev Dashboard, open your app → API access → Protected customer data, request access and tick the Email field. Then re-run the order import.
        </div>
      )}

      <Card title="Customer lists" sub="Emails are stored and exported only as SHA-256 hashes, the format the platforms match on. Nothing is uploaded for you.">
        <div className={s.tips}>
          {audiences.map((a, i) => (
            <details key={a.id} className={s.tip} open={i < 2}>
              <summary>
                <span className={s.tipArea}>{a.use === "exclude" ? "Exclude" : "Retarget"}</span>
                <span className={s.tipTitle}>{a.name}</span>
                <span className={s.tipImpact}>{num(a.hashes.length)} with email</span>
              </summary>
              <p className={s.tipWhy}>
                {a.description} {num(a.customers)} customers.
              </p>
              <p className={s.tipWhy}>
                <b>How to use it:</b> {a.angle}
              </p>
              <div className={s.chips} style={{ marginTop: 8 }}>
                {PLATFORMS.map((p) => {
                  const tooSmall = a.hashes.length < MIN_SIZE[p];
                  return a.hashes.length === 0 ? (
                    <span key={p} className={s.chip} aria-disabled="true" style={{ opacity: 0.5 }}>
                      {PLATFORM_NAMES[p]}: no emails yet
                    </span>
                  ) : (
                    <a key={p} className={s.chip} href={`/dashboard/audiences/download?id=${encodeURIComponent(a.id)}&platform=${p}`} download title={tooSmall ? `${PLATFORM_NAMES[p]} needs about ${MIN_SIZE[p]} matched people to run ads; it can still be used as an exclusion.` : undefined}>
                      ↓ {PLATFORM_NAMES[p]}
                      {tooSmall ? ` (under ${MIN_SIZE[p]})` : ""}
                    </a>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      </Card>
      <div style={{ height: 12 }} />

      <div className={s.grid2}>
        <Card title="Site visitors (build with your pixels)" sub="No emails needed: each platform builds these from its own pixel. Sizes are what your tracking saw, excluding people who bought.">
          <div className={s.tips}>
            {recipes.map((r) => (
              <details key={r.id} className={s.tip}>
                <summary>
                  <span className={s.tipArea}>{r.window}</span>
                  <span className={s.tipTitle}>{r.name}</span>
                  <span className={s.tipImpact}>≈ {num(r.people)} people</span>
                </summary>
                <p className={s.tipWhy}>
                  <b>Ad angle:</b> {r.angle}
                </p>
                <ol className={s.tipActions}>
                  {PLATFORMS.map((p) => (
                    <li key={p}>
                      <b>{PLATFORM_NAMES[p]}:</b> {r.how[p]}
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </Card>
        <Card title="How to upload a customer list" sub="Refresh the files monthly; lists go stale as people buy again.">
          <ol className={s.tipActions}>
            {PLATFORMS.map((p) => (
              <li key={p}>
                <b>{PLATFORM_NAMES[p]}:</b> {UPLOAD_STEPS[p]}
              </li>
            ))}
          </ol>
          <p className={s.cardSub} style={{ marginTop: 10 }}>
            Only upload lists of people who agreed to marketing where the law requires it, and follow each platform&apos;s customer-list terms. Typical match rates are 40–70%, so a list needs a few hundred emails to reach the minimum audience size.
          </p>
        </Card>
      </div>
    </>
  );
}
