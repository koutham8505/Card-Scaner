"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, CalendarClock, Camera, Gauge, Home, LayoutDashboard, MapPinned, NotebookPen, ShieldCheck, Users } from "lucide-react";

const navItems = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/scan", label: "Scan", icon: Camera },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/tasks", label: "Tasks", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", icon: Gauge },
];

const desktopNav = [
  { href: "/home", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/tasks", label: "Follow-ups", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", icon: Gauge },
  { href: "/events", label: "Events", icon: BriefcaseBusiness },
  { href: "/sync", label: "Sync Monitor", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: NotebookPen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
      console.error("Offline app shell registration failed.", error);
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 text-lg font-bold text-white">
              R
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Rareminds</p>
              <p className="text-sm font-semibold text-slate-800">EventConnect</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            {desktopNav.map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href} className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900">
                <Icon size={16} />
                {label}
              </Link>
            ))}
          </div>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
            }}
            className="rounded-full bg-slate-900 px-3 py-2 text-sm font-medium text-white"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <div className="mb-4 flex gap-2 overflow-x-auto pb-2 md:hidden">
          {navItems.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href} className="flex min-w-[110px] items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200">
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </div>
        {children}
      </div>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 text-xs text-slate-500 sm:px-6">
          <span>DIDAC 2026 • Online capture only</span>
          <span className="flex items-center gap-1"><MapPinned size={12} /> Bengaluru, India</span>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Rareminds</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{title}</h1>
      </div>
      <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">{subtitle}</div>
    </div>
  );
}

export function ActionButton({ href, label, accent = true }: { href: string; label: string; accent?: boolean }) {
  return (
    <Link href={href} className={accent ? "inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200" : "inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"}>
      {label} <ArrowRight size={16} />
    </Link>
  );
}
