"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keyboard support for the creative viewer: Esc closes, ←/→ step through ads. Locks page scroll. */
export function LightboxKeys({ close, prev, next }: { close: string; prev: string | null; next: string | null }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA", "VIDEO"].includes(e.target.tagName)) return;
      if (e.key === "Escape") router.replace(close, { scroll: false });
      else if (e.key === "ArrowLeft" && prev) router.replace(prev, { scroll: false });
      else if (e.key === "ArrowRight" && next) router.replace(next, { scroll: false });
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [router, close, prev, next]);
  return null;
}
