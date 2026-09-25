"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import s from "../dashboard.module.css";

/** Re-renders the page's server data every `seconds` while the tab is visible. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [ago, setAgo] = useState(0);
  useEffect(() => {
    let last = Date.now();
    const tick = setInterval(() => {
      if (document.hidden) return;
      const elapsed = Math.round((Date.now() - last) / 1000);
      if (elapsed >= seconds) {
        last = Date.now();
        router.refresh();
        setAgo(0);
      } else setAgo(elapsed);
    }, 1000);
    return () => clearInterval(tick);
  }, [router, seconds]);
  return (
    <span className={s.liveBadge} aria-live="off">
      <span className={s.liveDot} aria-hidden="true" /> Live · updated {ago === 0 ? "just now" : `${ago}s ago`}
    </span>
  );
}
