"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";

type SyncJob = { id: string; capture_id: string; provider: string; status: string; attempts: number; last_error: string | null };

function providerLabel(provider: string): string {
  if (provider === "google_drive") return "Google Drive";
  if (provider === "zoho_crm") return "Zoho CRM";
  if (provider === "ocr") return "OCR";
  return provider;
}

export default function SyncPage() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch(`${apiUrl}/api/v1/sync-jobs`).then((response) => { if (!response.ok) throw new Error("Sync jobs could not be loaded."); return response.json(); }).then(setJobs).catch((exception) => setError(exception.message)); }, []);
  return (
    <AppShell>
      <PageHeader title="Sync Monitor" subtitle={`${jobs.length} recorded jobs`} />
      {error ? <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Capture ID</th>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Retries</th>
              <th className="px-4 py-3 font-semibold">Last error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{job.capture_id}</td>
                <td className="px-4 py-3 text-slate-700">{providerLabel(job.provider)}</td>
                <td className="px-4 py-3"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{job.status}</span></td>
                <td className="px-4 py-3 text-slate-700">{job.attempts}</td>
                <td className="px-4 py-3 text-xs text-red-600">{job.last_error ?? "—"}</td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-sm text-slate-500">No sync jobs recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>}
    </AppShell>
  );
}
