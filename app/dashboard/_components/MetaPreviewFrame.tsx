"use client";
import { useEffect, useState } from "react";

/**
 * The Meta preview iframe. Meta's Instagram previews (feed, Reels, Stories) measure themselves as
 * they load and can stay blank if that happens while the pop-up is still animating in, so the frame
 * is created just after the animation. They also tend to come up empty the first time they load in
 * a frame and render on the second, so `reloadOnce` reloads them once automatically. "Reload
 * preview" recreates the frame by hand if it's ever still empty.
 */
export function MetaPreviewFrame({ src, title, width, height, reloadOnce = false }: { src: string; title: string; width: number; height: number; reloadOnce?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const [autoDone, setAutoDone] = useState(false);
  const [shown, setShown] = useState(-1);
  useEffect(() => {
    const t = setTimeout(() => setShown(attempt), 350);
    return () => clearTimeout(t);
  }, [attempt, src]);

  const box = { width, height, maxWidth: "100%", borderRadius: 8, background: "#fff" } as const;
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 6 }}>
      {shown === attempt ? (
        <iframe
          key={`${src}#${attempt}`}
          src={src}
          title={title}
          width={width}
          height={height}
          style={{ ...box, border: 0 }}
          // Only https facebook.com URLs reach here (parsePreviewIframe). Instagram previews stay
          // blank without a referrer; this sends only our origin, never the path.
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation allow-storage-access-by-user-activation"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          onLoad={() => {
            if (reloadOnce && !autoDone) {
              setAutoDone(true);
              setAttempt((a) => a + 1);
            }
          }}
        />
      ) : (
        <div style={box} aria-hidden="true" />
      )}
      <button type="button" onClick={() => setAttempt((a) => a + 1)} style={{ background: "none", border: 0, color: "var(--muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>
        Reload preview
      </button>
    </div>
  );
}
