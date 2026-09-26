import type { ReactNode } from "react";
import { metaAdPreview } from "@/lib/meta-preview";
import { MetaPreviewFrame } from "./MetaPreviewFrame";
import { PREVIEW_FORMATS, type PreviewFormat } from "@/lib/meta";

// Meta's reported sizes are too small for the vertical placements (the ad renders below the fold),
// so each placement gets at least a phone-shaped frame.
const MIN_SIZE: Record<PreviewFormat, { width: number; height: number }> = {
  MOBILE_FEED_STANDARD: { width: 335, height: 560 },
  INSTAGRAM_STANDARD: { width: 320, height: 580 },
  INSTAGRAM_REELS: { width: 320, height: 640 },
  INSTAGRAM_STORY: { width: 320, height: 640 },
};

/**
 * Meta's exact preview of the ad (your Page name, profile picture, copy and media, as people see it).
 * Falls back to our own rendering when Meta can't provide one.
 */
export async function MetaPreview({ adId, format, fallback }: { adId: string; format: PreviewFormat; fallback: ReactNode }) {
  const frame = await metaAdPreview(adId, format);
  if (!frame) return <>{fallback}</>;
  const min = MIN_SIZE[format];
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <MetaPreviewFrame src={frame.src} title={`Meta preview: ${PREVIEW_FORMATS[format]}`} width={Math.max(frame.width, min.width)} height={Math.max(frame.height, min.height)} reloadOnce={format !== "MOBILE_FEED_STANDARD"} />
    </div>
  );
}
