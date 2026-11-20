"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";

type Lead = { id: string; full_name: string | null; institution: string | null; designation: string | null; city: string | null; mobile: string | null; follow_up_at: string | null; priority: string; status: string };

function formatLeadDate(value: string | null): string {
  if (!value) return "—";
  return value.includes("T") ? new Date(value).toLocaleString() : value;
}

export default function LeadsPage() {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ q: query, priority });
        const response = await fetch(`${apiUrl}/api/v1/leads?${params}`);
        if (!response.ok) throw new Error("Lead directory could not be loaded.");
        setLeads(await response.json());
      } catch (exception) {
        setError(exception instanceof Error ? exception.message : "Lead directory could not be loaded.");
      } finally {
        setLoading(false);
      }
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [query, priority]);

  return (
    <AppShell>
      <PageHeader title="Lead Directory" subtitle={`${leads.length} live records`} />
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 md:flex-row">
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none md:max-w-sm" placeholder="Search by name, institution, or email" />
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"><option value="">All priorities</option><option>Hot</option><option>Warm</option><option>Cold</option></select>
        </div>
        {loading ? <p className="p-8 text-sm text-slate-500">Loading live records…</p> : error ? <p role="alert" className="p-8 text-sm text-red-700">{error}</p> : leads.length === 0 ? <p className="p-8 text-sm text-slate-500">No leads match the current filters.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{["Name", "Institution", "City", "Phone", "Follow-up / demo date", "Priority", "Status"].map((label) => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
            <tbody>{leads.map((lead) => <tr key={lead.id} className="border-t border-slate-200"><td className="px-4 py-3"><p className="font-semibold text-slate-900">{lead.full_name ?? "Unknown"}</p><p className="text-xs text-slate-500">{lead.designation ?? "Designation not recorded"}</p></td><td className="px-4 py-3 text-slate-700">{lead.institution ?? "—"}</td><td className="px-4 py-3 text-slate-700">{lead.city ?? "—"}</td><td className="px-4 py-3 text-slate-700">{lead.mobile ?? "—"}</td><td className="px-4 py-3 text-slate-700">{formatLeadDate(lead.follow_up_at)}</td><td className="px-4 py-3"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{lead.priority}</span></td><td className="px-4 py-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{lead.status}</span></td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </AppShell>
  );
}
