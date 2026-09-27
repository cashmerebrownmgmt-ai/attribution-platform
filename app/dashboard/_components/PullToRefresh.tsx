"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { refreshData } from "../refresh-action";
import s from "../dashboard.module.css";

const TRIGGER = 70; // px pulled (after resistance) that triggers a refresh
const MAX = 110;

function installedApp(): boolean {
  // Home-screen apps have no browser pull-to-refresh; in a browser tab, leave the browser's own alone.
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Pull down at the top of any dashboard page to refresh, like a native app (home-screen app only). */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    if (!installedApp()) return;

    const onStart = (e: TouchEvent) => {
      // Not while a pop-up has locked scrolling, and only from the very top of the page.
      if (window.scrollY > 0 || document.body.style.overflow === "hidden" || e.touches.length > 1) return;
      startY.current = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || window.scrollY > 0) {
        if (pullRef.current) setPull((pullRef.current = 0));
        return;
      }
      e.preventDefault(); // stop the page bouncing while we show the pull
      const p = Math.min(MAX, dy * 0.5);
      pullRef.current = p;
      setPull(p);
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      const trigger = pullRef.current >= TRIGGER;
      setPull((pullRef.current = 0));
      if (trigger) {
        setDone(false);
        start(async () => {
          await refreshData(); // re-renders the page with fresh numbers
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const visible = pull > 4 || pending || done;
  if (!visible) return null;
  const ready = pull >= TRIGGER;
  const offset = pending || done ? 56 : pull;
  return (
    <div className={s.ptr} style={{ transform: `translate(-50%, ${offset}px)`, opacity: pending || done ? 1 : Math.min(1, pull / TRIGGER) }} role="status" aria-live="polite">
      {done ? (
        <span className={s.ptrDone}>✓</span>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={pending ? { animation: "spin 0.8s linear infinite" } : { transform: `rotate(${(pull / TRIGGER) * 270}deg)`, transition: "transform 60ms linear" }}>
          <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
      )}
      <span className={s.srOnly}>{pending ? "Refreshing" : done ? "Up to date" : ready ? "Release to refresh" : "Pull to refresh"}</span>
    </div>
  );
}
