import Link from "next/link";
import { requireMember } from "@/lib/auth";
import s from "./debug.module.css";

export const dynamic = "force-dynamic";

export default async function DebugLayout({ children }: LayoutProps<"/debug">) {
  await requireMember("admin", "/debug");
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <Link href="/debug" className={s.brand}>
          Attribution <span>order explorer</span>
        </Link>
        <Link href="/dashboard" className={s.brand} style={{ fontWeight: 500 }}>
          ← Dashboard
        </Link>
        <form action="/debug" className={s.search} role="search">
          <input name="q" placeholder="Order #1001, order ID, visitor ID or checkout token" aria-label="Search" />
          <button type="submit">Search</button>
        </form>
      </header>
      <main className={s.main}>{children}</main>
    </div>
  );
}
