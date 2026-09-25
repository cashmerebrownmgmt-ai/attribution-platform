import { headers } from "next/headers";
import { requireMember } from "@/lib/auth";
import { currentMode } from "@/lib/dashboard/data";
import { PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { can } from "@/lib/roles";
import { ownerEmail } from "@/lib/access";
import { getAdAccounts, getSettings } from "@/lib/settings";
import s from "../dashboard.module.css";
import { Card, PageHead } from "../_components/ui";
import { MIN_PASSWORD, PASSWORD_MESSAGES } from "@/lib/password";
import { saveProfile, saveTargets, setPassword } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const UTM_TEMPLATES = {
  meta: "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}",
  google: "{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}",
  tiktok: "utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_ID__&utm_content=__CID__",
};

export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
  const me = await requireMember("viewer", "/dashboard/settings");
  const p = await searchParams;
  const [mode, settings, accounts, h] = await Promise.all([currentMode(), getSettings(), getAdAccounts(), headers()]);
  const owner = ownerEmail(process.env);
  const editable = can.editSettings(me.role);
  const saved = one(p.saved);
  const error = one(p.error);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const profile = settings?.business_profile ?? {};
  const pw = one(p.pw) as keyof typeof PASSWORD_MESSAGES | undefined;
  const pwMessage = pw ? PASSWORD_MESSAGES[pw] : undefined;

  return (
    <>
      <PageHead title="Settings" subtitle="Targets, business profile, access and connections" mode={mode} exportable={false} />

      {!settings && (
        <div className={s.callout}>
          Settings aren&apos;t available yet: the dashboard database migration hasn&apos;t been applied to Supabase.
        </div>
      )}
      {error && (
        <div className={s.callout} role="alert" style={{ borderColor: "var(--critical)" }}>
          {error}
        </div>
      )}
      {!editable && <div className={s.callout}>You have view-only access. Ask an admin to change settings.</div>}

      <div className={s.grid2}>
        <Card title="Targets" sub="Used to color results and power recommendations">
          <form action={saveTargets} className={s.form} id="targets">
            <fieldset disabled={!editable || !settings} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
              <div className={s.field}>
                <label htmlFor="business_name">Business name</label>
                <input id="business_name" name="business_name" defaultValue={settings?.business_name ?? ""} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
                <div className={s.field}>
                  <label htmlFor="target_roas">Target ROAS</label>
                  <input id="target_roas" name="target_roas" type="number" step="0.01" min="0" defaultValue={settings?.target_roas ?? ""} placeholder="e.g. 2.5" />
                </div>
                <div className={s.field}>
                  <label htmlFor="breakeven_roas">Break-even ROAS</label>
                  <input id="breakeven_roas" name="breakeven_roas" type="number" step="0.01" min="0" defaultValue={settings?.breakeven_roas ?? ""} placeholder="e.g. 1.8" />
                </div>
                <div className={s.field}>
                  <label htmlFor="target_cpa">Target CPA</label>
                  <input id="target_cpa" name="target_cpa" type="number" step="0.01" min="0" defaultValue={settings?.target_cpa ?? ""} placeholder="e.g. 30" />
                </div>
                <div className={s.field}>
                  <label htmlFor="currency">Currency</label>
                  <input id="currency" name="currency" maxLength={3} defaultValue={settings?.currency ?? "USD"} />
                </div>
                <div className={s.field}>
                  <label htmlFor="lookback_days">Lookback (days)</label>
                  <input id="lookback_days" name="lookback_days" type="number" min="1" max="90" defaultValue={settings?.lookback_days ?? 30} />
                </div>
              </div>
              <p className={s.hint}>Break-even ROAS = 1 ÷ gross margin. With a 55% margin, every $1 of ads must bring back $1.82 to break even.</p>
              <div>
                <button className={`${s.button} ${s.buttonPrimary}`} type="submit">
                  Save targets
                </button>
                {saved === "targets" && <span className={s.goodText} style={{ marginLeft: 10 }}>Saved ✓</span>}
              </div>
            </fieldset>
          </form>
        </Card>

        <Card title="Business profile" sub="Helps the AI advisor tailor creative tips and recommendations">
          <form action={saveProfile} className={s.form} id="profile">
            <fieldset disabled={!editable || !settings} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
              <div className={s.field}>
                <label htmlFor="products">What you sell</label>
                <textarea id="products" name="products" rows={2} defaultValue={profile.products ?? ""} placeholder="Heavyweight cotton t-shirts in 12 colors" />
              </div>
              <div className={s.field}>
                <label htmlFor="audience">Who buys it</label>
                <textarea id="audience" name="audience" rows={2} defaultValue={profile.audience ?? ""} placeholder="Men 22–40 who care about quality basics" />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <div className={s.field}>
                  <label htmlFor="price_range">Price range</label>
                  <input id="price_range" name="price_range" defaultValue={profile.price_range ?? ""} placeholder="$35–$75" />
                </div>
                <div className={s.field}>
                  <label htmlFor="gross_margin_pct">Gross margin %</label>
                  <input id="gross_margin_pct" name="gross_margin_pct" type="number" min="0" max="100" defaultValue={profile.gross_margin_pct ?? ""} placeholder="55" />
                </div>
              </div>
              <div className={s.field}>
                <label htmlFor="brand_voice">Brand voice</label>
                <input id="brand_voice" name="brand_voice" defaultValue={profile.brand_voice ?? ""} placeholder="Straight-talking, no hype" />
              </div>
              <div className={s.field}>
                <label htmlFor="competitors">Competitors</label>
                <input id="competitors" name="competitors" defaultValue={profile.competitors ?? ""} />
              </div>
              <div className={s.field}>
                <label htmlFor="notes">Anything else</label>
                <textarea id="notes" name="notes" rows={2} defaultValue={profile.notes ?? ""} placeholder="Seasonality, upcoming launches, offers that work…" />
              </div>
              <div>
                <button className={`${s.button} ${s.buttonPrimary}`} type="submit">
                  Save profile
                </button>
                {saved === "profile" && <span className={s.goodText} style={{ marginLeft: 10 }}>Saved ✓</span>}
              </div>
            </fieldset>
          </form>
        </Card>
      </div>

      <div className={s.grid2}>
        <Card title="Access" sub="This dashboard is private">
          <div className={s.statusList}>
            <div className={s.statusItem}>
              <span className={`${s.statusIcon} ${owner ? s.statusOk : s.statusBad}`} aria-hidden="true">{owner ? "✓" : "!"}</span>
              <div>
                <div className={s.statusName}>{owner ? `Only ${owner} can sign in` : "No owner email set"}</div>
                <div className={s.statusDetail}>
                  {owner
                    ? "Sign-in is by one-time email link. Anyone else who reaches the login page gets nothing, and any other account is signed out immediately."
                    : "Set OWNER_EMAIL on the server. Until then nobody can sign in."}
                </div>
              </div>
            </div>
          </div>
          <p className={s.hint} style={{ marginTop: 10 }}>To change who has access, update <code>OWNER_EMAIL</code> in your environment variables (Vercel → Settings → Environment Variables) and redeploy.</p>
        </Card>

        <Card title="Security" sub="Sign in with your email and a password. Email links still work as a backup.">
          <form action={setPassword} className={s.form} id="security">
            <fieldset disabled={me.role !== "owner" || me.devBypass} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
              {/* Lets password managers save the login under the right account. */}
              <input type="email" name="username" autoComplete="username" value={me.email ?? ""} readOnly hidden />
              <div className={s.field}>
                <label htmlFor="password">New password</label>
                <input id="password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={128} required />
              </div>
              <div className={s.field}>
                <label htmlFor="confirm">Confirm new password</label>
                <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} maxLength={128} required />
              </div>
              <div>
                <button className={`${s.button} ${s.buttonPrimary}`} type="submit">
                  Set password
                </button>
                {pwMessage && (
                  <span className={pw === "set" ? s.goodText : s.badText} style={{ marginLeft: 10 }} role={pw === "set" ? "status" : "alert"}>
                    {pwMessage}
                  </span>
                )}
              </div>
              <p className={s.hint} style={{ margin: 0 }}>
                At least {MIN_PASSWORD} characters. You stay signed in on this device until you sign out or clear your browser data.
              </p>
            </fieldset>
          </form>
        </Card>

        <Card title="Ad accounts" sub="Spend and creative data. Meta refreshes every morning; Google and TikTok connect once their API access is approved.">
          <div className={s.statusList}>
            {(["meta", "google", "tiktok"] as const).map((pl) => {
              const acc = accounts.filter((a) => a.platform === pl);
              return (
                <div key={pl} className={s.statusItem}>
                  <span className={`${s.statusIcon} ${acc.length ? s.statusOk : s.statusWarn}`} aria-hidden="true">
                    {acc.length ? "✓" : "!"}
                  </span>
                  <div>
                    <div className={s.statusName}>{PLATFORM_LABELS[pl]}</div>
                    <div className={s.statusDetail}>{acc.length ? acc.map((a) => a.name ?? a.id).join(", ") : "Not connected yet"}</div>
                    <details className={s.tableToggle} style={{ marginTop: 6 }}>
                      <summary>URL parameters to add to every {PLATFORM_LABELS[pl]} ad</summary>
                      <code style={{ display: "block", marginTop: 6, fontSize: 12, wordBreak: "break-all" }}>{UTM_TEMPLATES[pl]}</code>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Tracking script" sub="Paste into your Shopify theme, just before </head> in theme.liquid">
        <code style={{ display: "block", padding: 12, borderRadius: 8, background: "var(--surface-2)", fontSize: 13, wordBreak: "break-all" }}>
          {`<script src="${origin}/t.js" async></script>`}
        </code>
      </Card>
    </>
  );
}
