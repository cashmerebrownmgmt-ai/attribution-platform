/** Tiny trend line for stat tiles. Decorative: the tile's value and delta carry the meaning. */
export function Sparkline({ values, color = "var(--s1)", width = 96, height = 28 }: { values: (number | null)[]; color?: string; width?: number; height?: number }) {
  const nums = values.map((v) => v ?? 0);
  if (nums.length < 2) return null;
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const span = max - min || 1;
  const pts = nums.map((v, i) => `${((i / (nums.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--axis)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts.slice(-Math.ceil(pts.length / 3)).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={color} stroke="var(--surface)" strokeWidth={1.5} />
    </svg>
  );
}
