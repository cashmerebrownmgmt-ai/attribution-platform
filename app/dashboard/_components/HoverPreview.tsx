"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import s from "../dashboard.module.css";

/**
 * Shows a quick-preview card when the trigger is hovered (after a short delay) or focused.
 * The card content is rendered on the server and passed in.
 */
export function HoverPreview({ children, content }: { children: ReactNode; content: ReactNode }) {
  const trigger = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 280);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 120);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Place next to the trigger, flipping to stay inside the viewport.
  useLayoutEffect(() => {
    if (!open || !trigger.current || !card.current) return;
    const t = trigger.current.getBoundingClientRect();
    const c = card.current.getBoundingClientRect();
    const margin = 8;
    let left = t.left;
    if (left + c.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - c.width - margin);
    let top = t.bottom + 6;
    if (top + c.height > window.innerHeight - margin) top = Math.max(margin, t.top - c.height - 6);
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [open]);

  return (
    <span
      ref={trigger}
      className={s.hoverTrigger}
      // Touch screens have no hover: a tap should just open the item, not leave a card on screen.
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
      onFocus={(e) => e.target.matches(":focus-visible") && show()}
      onBlur={hide}
    >
      {children}
      {open && (
        <div
          ref={card}
          className={s.hoverCard}
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden", left: 0, top: 0 }}
          onPointerEnter={show}
          onPointerLeave={hide}
        >
          {content}
        </div>
      )}
    </span>
  );
}
