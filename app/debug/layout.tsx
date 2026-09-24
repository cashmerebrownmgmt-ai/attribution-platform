import Link from "next/link";
import s from "./debug.module.css";

export const dynamic = "force-dynamic";

export default function DebugLayout({ children }: LayoutProps<"/debug">) {
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <Link href="/debug" className={s.brand}>
          Attribution <span>debug</span>
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
