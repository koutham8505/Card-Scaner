"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";

type Dashboard = { totals: Record<string, number>; cities: Array<{ city: string; count: number }>; capture_methods: Array<{ capture_method: string; count: number }> };

export default function AnalyticsPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch(`${apiUrl}/api/v1/dashboard/summary`).then((response) => { if (!response.ok) throw new Error("Analytics could not be loaded."); return response.json(); }).then(setDashboard).catch((exception) => setError(exception.message)); }, []);
  return (
    <AppShell>
      <PageHeader title="Management Analytics" subtitle="Live SQLite metrics" />
      {error ? <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm text-red-700">{error}</p> : dashboard ? (
        <><section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(dashboard.totals).map(([label, value]) => <div key={label} className="rounded-3xl border border-slate-200 bg-white p-5"><p className="text-xs uppercase tracking-wide text-slate-500">{label.replaceAll("_", " ")}</p><p className="mt-3 text-3xl font-black">{value}</p></div>)}</section>
        <section className="mt-6 grid gap-6 md:grid-cols-2"><div className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Leads by city</h2><div className="mt-4 space-y-3">{dashboard.cities.map((city) => <div key={city.city} className="flex justify-between rounded-2xl bg-slate-50 p-3"><span>{city.city}</span><strong>{city.count}</strong></div>)}</div></div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5"><h2 className="font-bold">Captures by method</h2><div className="mt-4 space-y-3">{dashboard.capture_methods.map((method) => <div key={method.capture_method} className="flex justify-between rounded-2xl bg-slate-50 p-3"><span className="capitalize">{method.capture_method}</span><strong>{method.count}</strong></div>)}</div></div></section></>
      ) : <p className="rounded-2xl bg-white p-8 text-sm text-slate-500">Loading live metrics…</p>}
    </AppShell>
  );
}
