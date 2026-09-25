"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import s from "../dashboard.module.css";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: "M3 13h4v8H3zM10 9h4v12h-4zM17 4h4v17h-4z" },
  { href: "/dashboard/daily", label: "Daily report", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" },
  { href: "/dashboard/live", label: "Live", icon: "M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" },
  { href: "/dashboard/sessions", label: "Sessions", icon: "M4 19V9M10 19V5M16 19v-7M22 19H2" },
  { href: "/dashboard/channels", label: "Channels", icon: "M4 6h16M4 12h10M4 18h6" },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: "M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z" },
  { href: "/dashboard/creatives", label: "Creatives", icon: "M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z" },
  { href: "/dashboard/products", label: "Products", icon: "M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10" },
  { href: "/dashboard/customers", label: "Customers", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0" },
  { href: "/dashboard/audiences", label: "Audiences", icon: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6" },
  { href: "/dashboard/trends", label: "Trend radar", icon: "M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 12l6-6M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5" },
  { href: "/dashboard/journeys", label: "Journeys", icon: "M4 6c6 0 6 12 16 12M4 18c6 0 6-12 16-12" },
  { href: "/dashboard/health", label: "Tracking health", icon: "M3 12h4l3-7 4 14 3-7h4" },
  { href: "/dashboard/settings", label: "Settings", icon: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" },
];

// Filters travel between pages; page-specific params (drill-down IDs, sort) don't.
const CARRY = ["range", "from", "to", "model", "platform"];

export function Sidebar({ email, role }: { email: string | null; role: string | null }) {
  const path = usePathname();
  const params = useSearchParams();
  const carried = new URLSearchParams();
  for (const k of CARRY) {
    const v = params.get(k);
    if (v) carried.set(k, v);
  }
  const qs = carried.toString() ? `?${carried}` : "";

  return (
    <aside className={s.sidebar}>
      <Link href={`/dashboard${qs}`} className={s.brand}>
        <span className={s.brandMark} aria-hidden="true" />
        Attribution
      </Link>
      <nav className={s.nav} aria-label="Dashboard">
        {NAV.map((n) => {
          const active = n.href === "/dashboard" ? path === "/dashboard" : path.startsWith(n.href);
          return (
            <Link key={n.href} href={`${n.href}${n.href === "/dashboard/settings" ? "" : qs}`} className={`${s.navLink} ${active ? s.navLinkActive : ""}`} aria-current={active ? "page" : undefined}>
              <svg className={s.navIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={n.icon} />
              </svg>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className={s.sideFoot}>
        {email && (
          <div className={s.userLine} title={email}>
            {email}
            {role ? ` · ${role}` : ""}
          </div>
        )}
        {email && (
          <form action="/auth/signout" method="post">
            <button className={`${s.button} ${s.buttonGhost}`} type="submit" style={{ width: "100%", justifyContent: "center" }}>
              Sign out
            </button>
          </form>
        )}
      </div>
    </aside>
  );
}
