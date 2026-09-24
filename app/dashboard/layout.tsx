import type { Metadata } from "next";
import { Suspense } from "react";
import s from "./dashboard.module.css";
import { Sidebar } from "./_components/Sidebar";

export const metadata: Metadata = { title: "Dashboard · Attribution" };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className={s.app}>
      <Suspense>
        <Sidebar email={null} role={null} />
      </Suspense>
      <main className={s.main}>{children}</main>
    </div>
  );
}
