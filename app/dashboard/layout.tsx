import type { Metadata } from "next";
import { Suspense } from "react";
import { requireMember } from "@/lib/auth";
import s from "./dashboard.module.css";
import { Sidebar } from "./_components/Sidebar";

export const metadata: Metadata = { title: "Dashboard · Attribution" };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const me = await requireMember("viewer");
  return (
    <div className={s.app}>
      <Suspense>
        <Sidebar email={me.devBypass ? null : me.email} role={me.role} />
      </Suspense>
      <main className={s.main}>
        {me.devBypass && (
          <div className={s.callout} role="note">
            Local development: login is bypassed (<code>AUTH_DEV_BYPASS=1</code>). This never applies to the live site.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
