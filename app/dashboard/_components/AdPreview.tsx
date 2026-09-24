import type { Ad } from "@/lib/metrics/types";
import s from "./AdPreview.module.css";

/**
 * Renders an ad the way it appears on its platform, uncropped: Meta feed post, TikTok in-feed,
 * Google search text ad, or a Google Shopping card. Real media (image or video) is shown whole;
 * demo ads get generated product art.
 */
export function AdPreview({ ad, brand, size = "card" }: { ad: Ad; brand: string; size?: "card" | "large" }) {
  const domain = displayDomain(ad.landingUrl) ?? `${slug(brand)}.com`;
  const cta = ad.cta ?? defaultCta(ad);
  const cls = `${s.preview} ${size === "large" ? s.large : ""}`;

  if (ad.platform === "google" && ad.format === "text") {
    return (
      <div className={`${cls} ${s.search}`} aria-label={`Google search ad: ${ad.headline ?? ad.name}`}>
        <div className={s.searchBar}>
          <span className={s.searchIcon} aria-hidden="true" />
          <span>{searchQuery(ad)}</span>
        </div>
        <div className={s.searchResult}>
          <div className={s.sponsored}>Sponsored</div>
          <div className={s.searchSite}>
            <span className={s.favicon} aria-hidden="true">{brand.slice(0, 1)}</span>
            <span>
              <span className={s.searchBrand}>{brand}</span>
              <span className={s.searchUrl}>https://{domain}</span>
            </span>
          </div>
          <div className={s.searchHeadline}>{ad.headline ?? ad.name}</div>
          <p className={s.searchDesc}>{ad.body}</p>
          <div className={s.sitelinks}>
            <span>Shop All</span>
            <span>Best Sellers</span>
            <span>Reviews</span>
          </div>
        </div>
      </div>
    );
  }

  if (ad.platform === "google") {
    return (
      <div className={`${cls} ${s.shopping}`} aria-label={`Google Shopping ad: ${ad.headline ?? ad.name}`}>
        <div className={s.sponsored}>Sponsored · Shopping</div>
        <div className={s.productGrid}>
          {[0, 1].map((i) => (
            <div key={i} className={s.product}>
              <div className={s.productMedia}>
                <Media ad={ad} variant={i} />
              </div>
              <div className={s.productTitle}>{i === 0 ? ad.headline ?? ad.name : `${ad.headline ?? ad.name} – 2 pack`}</div>
              <div className={s.productPrice}>{i === 0 ? "$38.00" : "$68.00"}</div>
              <div className={s.productStore}>{brand}</div>
              <div className={s.productShip}>Free shipping</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (ad.platform === "tiktok") {
    return (
      <div className={`${cls} ${s.tiktok}`} aria-label={`TikTok ad: ${ad.headline ?? ad.name}`}>
        <div className={s.phone}>
          <Media ad={ad} vertical />
          <div className={s.ttShade} aria-hidden="true" />
          <div className={s.ttRail} aria-hidden="true">
            <span className={s.ttAvatar}>{brand.slice(0, 1)}</span>
            <span>♥<small>12.4K</small></span>
            <span>💬<small>318</small></span>
            <span>↗<small>Share</small></span>
          </div>
          <div className={s.ttCaption}>
            <div className={s.ttHandle}>@{slug(brand)} · Sponsored</div>
            <div>{ad.headline}</div>
            {ad.body && <div className={s.ttBody}>{ad.body}</div>}
            <div className={s.ttCta}>{cta}</div>
          </div>
        </div>
      </div>
    );
  }

  // Meta (Facebook / Instagram feed)
  return (
    <div className={`${cls} ${s.meta}`} aria-label={`Meta ad: ${ad.headline ?? ad.name}`}>
      <div className={s.metaHead}>
        <span className={s.metaAvatar} aria-hidden="true">{brand.slice(0, 1)}</span>
        <span>
          <span className={s.metaPage}>{brand}</span>
          <span className={s.metaSponsored}>Sponsored</span>
        </span>
        <span className={s.metaMore} aria-hidden="true">···</span>
      </div>
      {ad.body && <p className={s.metaText}>{ad.body}</p>}
      {ad.format === "carousel" ? (
        <div className={s.carousel}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={s.carouselCard}>
              <div className={s.carouselMedia}>
                <Media ad={ad} variant={i} />
              </div>
              <div className={s.carouselFoot}>
                <span>{i === 0 ? ad.headline : ["Shop the colors", "Free returns"][i - 1]}</span>
                <span className={s.metaCtaSmall}>{cta}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={s.metaMedia}>
          <Media ad={ad} />
        </div>
      )}
      {ad.format !== "carousel" && (
        <div className={s.metaLink}>
          <span>
            <span className={s.metaDomain}>{domain.toUpperCase()}</span>
            <span className={s.metaHeadline}>{ad.headline ?? ad.name}</span>
          </span>
          <span className={s.metaCta}>{cta}</span>
        </div>
      )}
      <div className={s.metaActions} aria-hidden="true">
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>↗ Share</span>
      </div>
    </div>
  );
}

/** The ad's media, never cropped: video player, real image, or generated demo art. */
function Media({ ad, variant = 0, vertical = false }: { ad: Ad; variant?: number; vertical?: boolean }) {
  if (ad.videoUrl) {
    return (
      <video className={s.media} src={ad.videoUrl} poster={realImage(ad.thumbnailUrl) ?? undefined} controls playsInline preload="metadata">
        <track kind="captions" />
      </video>
    );
  }
  const img = realImage(ad.thumbnailUrl);
  if (img) {
    // eslint-disable-next-line @next/next/no-img-element -- ad creatives come from platform CDNs with arbitrary hosts
    return <img className={s.media} src={img} alt={ad.headline ?? ad.name} loading="lazy" />;
  }
  const hue = ad.thumbnailUrl?.startsWith("demo:") ? Number(ad.thumbnailUrl.slice(5)) : 210;
  return <DemoArt hue={(hue + variant * 38) % 360} vertical={vertical} video={ad.format === "video"} label={ad.headline ?? ad.name} />;
}

/** Generated product scene for demo creatives: a tee on a colored set, with a play badge for video. */
function DemoArt({ hue, vertical, video, label }: { hue: number; vertical: boolean; video: boolean; label: string }) {
  const w = 400;
  const h = vertical ? 711 : 400;
  const cy = h / 2 + (vertical ? -20 : 10);
  return (
    <svg className={s.media} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} (demo creative)`}>
      <defs>
        <linearGradient id={`bg${hue}${vertical}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 45% 88%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 40% 74%)`} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={`url(#bg${hue}${vertical})`} />
      <ellipse cx={w / 2} cy={cy + 150} rx={140} ry={18} fill={`hsl(${hue} 30% 55%)`} opacity={0.35} />
      <path
        transform={`translate(${w / 2 - 130} ${cy - 130})`}
        d="M85 0 L55 10 L0 45 L28 100 L60 85 L60 260 L200 260 L200 85 L232 100 L260 45 L205 10 L175 0 C165 22 148 32 130 32 C112 32 95 22 85 0 Z"
        fill={`hsl(${(hue + 180) % 360} 35% 32%)`}
      />
      <path transform={`translate(${w / 2 - 130} ${cy - 130})`} d="M85 0 C95 22 112 32 130 32 C148 32 165 22 175 0" fill="none" stroke={`hsl(${(hue + 180) % 360} 30% 22%)`} strokeWidth="6" />
      {video && (
        <g transform={`translate(${w / 2} ${cy})`}>
          <circle r="34" fill="rgba(0,0,0,0.45)" />
          <path d="M-10 -16 L18 0 L-10 16 Z" fill="#fff" />
        </g>
      )}
      <text x={w / 2} y={h - 28} textAnchor="middle" fontSize="15" fontWeight="600" fill={`hsl(${hue} 30% 25%)`} opacity="0.7">
        DEMO CREATIVE
      </text>
    </svg>
  );
}

const realImage = (url: string | null) => (url && /^https?:\/\//.test(url) ? url : null);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) || "brand";

function displayDomain(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

function defaultCta(ad: Ad): string {
  return ad.platform === "tiktok" ? "Shop now" : "Shop Now";
}

function searchQuery(ad: Ad): string {
  const h = (ad.headline ?? ad.name).toLowerCase();
  return h.includes("official") ? "heavyweight tee brand" : h.replace(/[^a-z0-9 ]/g, "").split(" ").slice(0, 3).join(" ");
}
