import { ImageResponse } from "next/og";

/**
 * The home-screen icon: the brand gradient, full bleed (so Android can mask it to any shape), with a
 * rising three-bar chart kept inside the central safe zone.
 */
export function appIcon(size: number): ImageResponse {
  const bar = (h: number, o: number) => (
    <div style={{ width: size * 0.13, height: size * h, background: `rgba(255,255,255,${o})`, borderRadius: size * 0.035 }} />
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: size * 0.07, paddingBottom: size * 0.27, background: "linear-gradient(135deg, #2a78d6, #1baf7a)" }}>
        {bar(0.2, 0.75)}
        {bar(0.32, 0.88)}
        {bar(0.46, 1)}
      </div>
    ),
    { width: size, height: size },
  );
}
