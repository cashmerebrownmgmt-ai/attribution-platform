import "server-only";
import webpush from "web-push";
import { ownerEmail } from "./access";
import { db } from "./db";
import type { Push } from "./goal-alerts";

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

/** The public key the phone needs to subscribe; null until VAPID keys are set on the server. */
export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY : null;
}

let configured = false;
function configure(): boolean {
  if (configured) return true;
  const pub = vapidPublicKey();
  if (!pub) return false;
  // Push services contact this address about abuse; the owner's email, or the app's URL.
  const owner = ownerEmail(process.env);
  webpush.setVapidDetails(owner ? `mailto:${owner}` : (process.env.APP_URL ?? "mailto:admin@example.com"), pub, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
  return true;
}

export async function saveSubscription(sub: PushSubscriptionJson, device: string | null): Promise<void> {
  const { error } = await db()
    .from("push_subscriptions")
    .upsert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, device }, { onConflict: "endpoint" });
  if (error) throw new Error(`push_subscriptions save failed: ${error.message}`);
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db().from("push_subscriptions").delete().eq("endpoint", endpoint);
}

export async function listDevices(): Promise<{ endpoint: string; device: string | null; created_at: string; last_success_at: string | null }[]> {
  const { data, error } = await db().from("push_subscriptions").select("endpoint, device, created_at, last_success_at").order("created_at");
  return error ? [] : (data ?? []);
}

/**
 * Send each push to every subscribed device. Devices the push service says are gone (404/410)
 * are removed. Returns how many deliveries succeeded.
 */
export async function sendPushes(pushes: Push[]): Promise<{ sent: number; failed: number; devices: number }> {
  if (!pushes.length || !configure()) return { sent: 0, failed: 0, devices: 0 };
  const { data, error } = await db().from("push_subscriptions").select("endpoint, p256dh, auth");
  if (error || !data?.length) return { sent: 0, failed: 0, devices: 0 };

  let sent = 0;
  let failed = 0;
  const ok = new Set<string>();
  await Promise.all(
    data.flatMap((d) =>
      pushes.map(async (p) => {
        try {
          await webpush.sendNotification(
            { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
            JSON.stringify({ title: p.title, body: p.body, url: p.url, tag: p.id }),
            { TTL: 6 * 3600, urgency: p.id.startsWith("goal:") ? "high" : "normal" },
          );
          sent += 1;
          ok.add(d.endpoint);
        } catch (e) {
          failed += 1;
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await removeSubscription(d.endpoint);
          else console.error("push failed:", status ?? (e instanceof Error ? e.message : ""));
        }
      }),
    ),
  );
  if (ok.size) await db().from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).in("endpoint", [...ok]);
  return { sent, failed, devices: data.length };
}

/** Which of these push IDs were already sent (tracked in alert_log). */
export async function sentPushIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data } = await db().from("alert_log").select("id").in("id", ids);
  return new Set((data ?? []).map((r) => String(r.id)));
}

export async function markPushesSent(pushes: Push[], at = new Date().toISOString()): Promise<void> {
  if (!pushes.length) return;
  const { error } = await db()
    .from("alert_log")
    .upsert(pushes.map((p) => ({ id: p.id, last_sent_at: at, last_title: p.title })), { onConflict: "id" });
  if (error) console.error("alert_log write failed:", error.message);
}

/**
 * Forget pushed problems that are no longer active, so each can alert again if it comes back.
 * `active` are the problem push IDs still current.
 */
export async function clearResolvedProblems(active: string[]): Promise<void> {
  const { data } = await db().from("alert_log").select("id").like("id", "push:%");
  const gone = (data ?? []).map((r) => String(r.id)).filter((id) => !active.includes(id));
  if (gone.length) await db().from("alert_log").delete().in("id", gone);
}
