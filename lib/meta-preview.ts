import "server-only";
import { z } from "zod";
import { metaClient, parsePreviewIframe, type PreviewFormat, type PreviewFrame } from "./meta";

// Preview links are signed and expire, so keep them briefly.
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; frame: PreviewFrame | null }>();
const schema = z.object({ data: z.array(z.object({ body: z.string() })).default([]) });

/** Meta's own rendering of an ad in a placement (exact Page name, picture, copy and media). Null if unavailable. */
export async function metaAdPreview(adId: string, format: PreviewFormat): Promise<PreviewFrame | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || !/^\d+$/.test(adId)) return null;
  const key = `${adId}|${format}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.frame;
  let frame: PreviewFrame | null = null;
  try {
    const r = await metaClient({ token, appSecret: process.env.META_APP_SECRET }).getOne(`${adId}/previews`, { ad_format: format }, schema);
    frame = r.data[0] ? parsePreviewIframe(r.data[0].body) : null;
  } catch {
    frame = null; // fall back to our own rendering
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), frame });
  return frame;
}
