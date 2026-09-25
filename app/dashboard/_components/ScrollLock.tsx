"use client";
import { useEffect } from "react";

/** Stops the page behind an open pop-up from scrolling (important on phones). */
export function ScrollLock() {
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.style.overflow;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = prev;
    };
  }, []);
  return null;
}
