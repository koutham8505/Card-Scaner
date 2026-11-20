"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { event } from "@/lib/mock-data";
import { apiUrl } from "@/lib/api";

type Summary = {
  totals: { captures: number; qualified: number; hot: number; pending_jobs: number };
};

export default function EventsPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${apiUrl}/api/v1/dashboard/summary`)
      .then((response) => {
        if (!response.ok) throw new Error("Event metrics could not be loaded.");
        return response.json();
      })
      .then(setSummary)
      .catch((exception: unknown) =>
        setError(exception instanceof Error ? exception.message : "Event metrics could not be loaded."),
      );
  }, []);

  const metrics = summary
    ? [
        ["Captured leads", summary.totals.captures],
        ["Qualified leads", summary.totals.qualified],
        ["Hot leads", summary.totals.hot],
        ["Pending integration jobs", summary.totals.pending_jobs],
      ]
    : [];

  return (
    <AppShell>
      <PageHeader title="Event Overview" subtitle={`Configured event • ${event.code}`} />
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Event configuration</h2>
          <p className="mt-4 text-sm text-slate-700">{event.name}</p>
          <p className="mt-1 text-sm text-slate-500">
            Venue and schedule are static app configuration, not loaded from the production event database.
          </p>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Live local metrics</h2>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>
          ) : summary ? (
            <dl className="mt-4 space-y-3">
              {metrics.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3">
                  <dt className="text-sm text-slate-600">{label}</dt>
                  <dd className="font-bold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 text-sm text-slate-500">Loading metrics…</p>
          )}
        </div>
      </section>
      <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Event and staff administration is not connected to the database yet. Metrics shown here come from the local SQLite store.
      </p>
    </AppShell>
  );
}
