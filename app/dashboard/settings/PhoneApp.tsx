"use client";
import { useEffect, useState, useTransition } from "react";
import s from "../dashboard.module.css";
import { removePushSubscription, savePushSubscription, sendTestPush } from "./actions";

type State =
  | { kind: "checking" }
  | { kind: "install"; ios: boolean } // needs to be on the home screen first (iPhone), or unsupported browser
  | { kind: "blocked" }
  | { kind: "off" }
  | { kind: "on" };

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  // iPhones and iPads can report themselves as a Mac (desktop-site mode, home-screen apps); Macs have no touchscreen.
  if (/Mac/.test(ua) && navigator.maxTouchPoints > 1) return Math.min(screen.width, screen.height) < 600 ? "iPhone" : "iPad";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Browser";
}

/** Turn on push notifications for this device, and send a test. */
export function PhoneApp({ vapidKey, editable }: { vapidKey: string | null; editable: boolean }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const check = supported
      ? navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub): State => (Notification.permission === "denied" ? { kind: "blocked" } : sub ? { kind: "on" } : { kind: "off" }))
      : Promise.resolve<State>({ kind: "install", ios });
    check.then(setState, () => setState({ kind: "off" }));
  }, []);

  const enable = () =>
    start(async () => {
      setNote(null);
      if (!vapidKey) return setNote("Notifications aren't set up on the server yet (VAPID keys missing).");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? { kind: "blocked" } : { kind: "off" });
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) }));
        const r = await savePushSubscription(JSON.parse(JSON.stringify(sub)), deviceName());
        if (!r.ok) return setNote(r.error ?? "Couldn't save this device.");
        setState({ kind: "on" });
        const t = await sendTestPush();
        setNote(t.sent ? "Done. A test notification is on its way." : "Turned on, but the test didn't send. Try “Send test”.");
      } catch {
        setNote("This browser refused the subscription. On iPhone, open the app from your home screen and try again.");
      }
    });

  const test = () =>
    start(async () => {
      const t = await sendTestPush();
      setNote(t.sent ? `Test sent to ${t.devices} device${t.devices === 1 ? "" : "s"}.` : "Nothing sent: no devices have notifications on.");
    });

  const turnOff = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState({ kind: "off" });
      setNote("Notifications are off on this device.");
    });

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {state.kind === "checking" && <div className={s.hint}>Checking this device…</div>}
      {state.kind === "install" &&
        (state.ios ? (
          <ol className={s.hint} style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            <li>
              In <b>Safari</b>, tap the <b>Share</b> button (square with an arrow).
            </li>
            <li>
              Tap <b>Add to Home Screen</b>, then <b>Add</b>.
            </li>
            <li>Open <b>Attribution</b> from your home screen, sign in once, and come back here to turn on notifications.</li>
          </ol>
        ) : (
          <div className={s.hint}>This browser can&apos;t receive notifications. On Android use Chrome (menu ⋮ → Install app); on iPhone use Safari → Add to Home Screen.</div>
        ))}
      {state.kind === "blocked" && (
        <div className={s.hint}>
          Notifications are blocked for this app. On iPhone: Settings → Notifications → Attribution → Allow. On Android: long-press the app icon → App info → Notifications.
        </div>
      )}
      {(state.kind === "off" || state.kind === "on") && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {state.kind === "off" ? (
            <button type="button" className={`${s.button} ${s.buttonPrimary}`} onClick={enable} disabled={pending || !editable}>
              {pending ? "Turning on…" : "Turn on notifications"}
            </button>
          ) : (
            <>
              <span className={s.goodText} style={{ fontWeight: 600 }}>
                ● On for this device
              </span>
              <button type="button" className={s.button} onClick={test} disabled={pending}>
                Send test
              </button>
              <button type="button" className={`${s.button} ${s.buttonGhost}`} onClick={turnOff} disabled={pending || !editable}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}
      {note && (
        <div className={s.hint} role="status">
          {note}
        </div>
      )}
    </div>
  );
}
