"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader, ActionButton } from "@/components/app-shell";
import { event } from "@/lib/mock-data";
import { apiUrl } from "@/lib/api";
import { BadgeCheck, Clock3, Navigation } from "lucide-react";

type Dashboard = { totals: { captures: number; qualified: number; hot: number; pending_jobs: number }; cities: Array<{ city: string; count: number }>; capture_methods: Array<{ capture_method: string; count: number }> };

export default function HomeDashboard() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  useEffect(() => { fetch(`${apiUrl}/api/v1/dashboard/summary`).then((response) => response.json()).then(setDashboard).catch(() => setDashboard(null)); }, []);
  const quickStats = dashboard ? [{ label: "Captured", value: dashboard.totals.captures }, { label: "Qualified", value: dashboard.totals.qualified }, { label: "Hot leads", value: dashboard.totals.hot }, { label: "Pending jobs", value: dashboard.totals.pending_jobs }] : [];
  return (
    <AppShell>
      <PageHeader title={event.name} subtitle={`Event • ${event.code}`} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dashboard ? quickStats.map((item) => (
          <div key={item.label} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{item.label}</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-3xl font-black text-slate-900">{item.value}</span>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">Live</span>
            </div>
          </div>
        )) : Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="h-3 w-20 rounded-full bg-slate-200" />
            <div className="mt-4 h-8 w-16 rounded-full bg-slate-200" />
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Quick actions</h2>
            <span className="text-xs font-medium text-slate-500">Booth staff</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ActionButton href="/scan" label="Scan Visiting Card" />
            <ActionButton href="/manual" label="Manual Entry" accent={false} />
            <ActionButton href="/qr" label="QR Registration" accent={false} />
            <ActionButton href="/leads" label="My Leads" accent={false} />
            <ActionButton href="/offline" label="Offline Queue" accent={false} />
            <ActionButton href="/tasks" label="Follow-ups" accent={false} />
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-slate-900 p-5 text-white shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Current status</p>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between rounded-2xl bg-white/5 p-3">
              <div className="flex items-center gap-2"><BadgeCheck size={16} className="text-emerald-300" /> Event</div>
              <span className="font-semibold">{event.name}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 p-3">
              <div className="flex items-center gap-2"><Clock3 size={16} className="text-cyan-300" /> Today</div>
              <span className="font-semibold">{dashboard?.totals.captures ?? 0} captures</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/5 p-3">
              <div className="flex items-center gap-2"><Navigation size={16} className="text-amber-300" /> Network</div>
              <span className="font-semibold">{dashboard ? "API reachable" : "API unavailable"}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">Capture methods</h2></div>
          <div className="space-y-3">
            {dashboard?.capture_methods.map((method) => <div key={method.capture_method} className="flex items-center justify-between rounded-2xl border border-slate-200 p-3"><p className="text-sm font-bold capitalize">{method.capture_method}</p><span className="text-sm text-slate-600">{method.count}</span></div>)}
            {!dashboard && <p className="text-sm text-slate-500">Live capture data unavailable.</p>}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">Geography</h2></div>
          <div className="space-y-3">
            {dashboard?.cities.map((city) => <div key={city.city} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3"><p className="text-sm font-bold">{city.city}</p><span className="text-xs text-slate-500">{city.count} leads</span></div>)}
            {!dashboard?.cities.length && <p className="text-sm text-slate-500">No qualified locations yet.</p>}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
