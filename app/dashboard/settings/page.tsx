import { headers } from "next/headers";
import { requireMember } from "@/lib/auth";
import { currentMode } from "@/lib/dashboard/data";
import { PLATFORM_LABELS } from "@/lib/dashboard/filters";
import { can } from "@/lib/roles";
import { getAdAccounts, getSettings, getTeam } from "@/lib/settings";
import s from "../dashboard.module.css";
import { Card, PageHead } from "../_components/ui";
import { cancelInvite, changeRole, inviteMember, removeMember, saveProfile, saveTargets } from "./actions";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const UTM_TEMPLATES = {
  meta: "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.id}}&utm_content={{ad.id}}",
  google: "{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}",
  tiktok: "utm_source=tiktok&utm_medium=paid_social&utm_campaign=__CAMPAIGN_ID__&utm_content=__CID__",
};

export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
  const me = await requireMember("viewer", "/dashboard/settings");
  const p = await searchParams;
  const [mode, settings, team, accounts, h] = await Promise.all([currentMode(), getSettings(), getTeam(), getAdAccounts(), headers()]);
  const editable = can.editSettings(me.role);
  const saved = one(p.saved);
  const error = one(p.error);
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const profile = settings?.business_profile ?? {};

  return (
    <>
      <PageHead title="Settings" subtitle="Targets, business profile, team and connections" mode={mode} />

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
        <Card title="Team" sub="Owners manage roles; admins invite people and edit settings; viewers can look">
          <div id="team">
            {!team ? (
              <div className={s.empty}>Team management is available once the dashboard migration is applied.</div>
            ) : (
              <>
                <div className={s.tableWrap} style={{ margin: "0 -18px 16px" }}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.members.map((m) => (
                        <tr key={m.user_id}>
                          <td>{m.email}{m.user_id === me.userId && <span className={s.muted}> (you)</span>}</td>
                          <td>
                            {can.manageTeam(me.role) && m.role !== "owner" ? (
                              <form action={changeRole} style={{ display: "inline-flex", gap: 6 }}>
                                <input type="hidden" name="user_id" value={m.user_id} />
                                <select name="role" defaultValue={m.role} className={s.select} aria-label={`Role for ${m.email}`}>
                                  <option value="admin">Admin</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                <button className={s.button} type="submit">Update</button>
                              </form>
                            ) : (
                              <span className={s.statusChip}>{m.role}</span>
                            )}
                          </td>
                          <td>
                            {can.manageTeam(me.role) && m.role !== "owner" && m.user_id !== me.userId && (
                              <form action={removeMember}>
                                <input type="hidden" name="user_id" value={m.user_id} />
                                <button className={`${s.button} ${s.buttonGhost}`} type="submit">Remove</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                      {team.invites.map((i) => (
                        <tr key={i.email}>
                          <td>{i.email} <span className={s.muted}>· invited</span></td>
                          <td><span className={s.statusChip}>{i.role}</span></td>
                          <td>
                            {can.invite(me.role) && (
                              <form action={cancelInvite}>
                                <input type="hidden" name="email" value={i.email} />
                                <button className={`${s.button} ${s.buttonGhost}`} type="submit">Cancel</button>
                              </form>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {can.invite(me.role) && (
                  <form action={inviteMember} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                    <div className={s.field} style={{ flex: "1 1 200px" }}>
                      <label htmlFor="invite_email">Invite by email</label>
                      <input id="invite_email" name="email" type="email" required placeholder="teammate@company.com" />
                    </div>
                    <select name="role" className={s.select} aria-label="Role" defaultValue="viewer">
                      <option value="viewer">Viewer</option>
                      {me.role === "owner" && <option value="admin">Admin</option>}
                    </select>
                    <button className={`${s.button} ${s.buttonPrimary}`} type="submit">Invite</button>
                  </form>
                )}
                <p className={s.hint} style={{ marginTop: 10 }}>
                  Invited people sign in at <code>{origin}/login</code> with that email.
                </p>
              </>
            )}
          </div>
        </Card>

        <Card title="Ad accounts" sub="Spend and creative data (connectors arrive in Phase 2)">
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
