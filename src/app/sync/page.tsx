"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";

type SyncJob = { id: string; capture_id: string; provider: string; status: string; attempts: number; last_error: string | null };

function providerLabel(provider: string): string {
  if (provider === "zoho_crm") return "Zoho Flow to CRM";
  if (provider === "google_drive") return "Google Drive";
  if (provider === "ocr") return "OCR";
  return provider;
}

export default function SyncPage() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [error, setError] = useState("");
  const [retryingCaptureId, setRetryingCaptureId] = useState("");

  const loadJobs = useCallback(async () => {
    const response = await fetch(`${apiUrl}/api/v1/sync-jobs`);
    if (!response.ok) throw new Error("Sync jobs could not be loaded.");
    setJobs(await response.json());
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/v1/sync-jobs`)
      .then((response) => {
        if (!response.ok) throw new Error("Sync jobs could not be loaded.");
        return response.json();
      })
      .then((data) => {
        if (active) setJobs(data);
      })
      .catch((exception) => {
        if (active) setError(exception instanceof Error ? exception.message : "Sync jobs could not be loaded.");
      });
    return () => { active = false; };
  }, []);

  const retry = async (captureId: string) => {
    setRetryingCaptureId(captureId);
    setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/captures/${captureId}/sync/zoho-flow`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail ?? "Zoho Flow delivery could not be retried.");
      }
      await loadJobs();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Zoho Flow delivery could not be retried.");
    } finally {
      setRetryingCaptureId("");
    }
  };

  return (
    <AppShell>
      <PageHeader title="Sync Monitor" subtitle={`${jobs.length} recorded jobs`} />
      <p className="mb-4 text-sm text-slate-600">
        A completed Zoho Flow job means the webhook accepted the lead payload; confirm CRM processing in Zoho Flow.
      </p>
      {error ? <p role="alert" className="mb-4 rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : null}
      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-semibold">Capture ID</th>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Attempts</th>
              <th className="px-4 py-3 font-semibold">Last error</th>
              <th className="px-4 py-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{job.capture_id}</td>
                <td className="px-4 py-3 text-slate-700">{providerLabel(job.provider)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${job.status === "Completed" ? "bg-emerald-50 text-emerald-700" : job.status === "Failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                    {job.status === "Completed" && job.provider === "zoho_crm" ? "Sent to Zoho Flow" : job.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-700">{job.attempts}</td>
                <td className="px-4 py-3 text-xs text-red-600">{job.last_error ?? "—"}</td>
                <td className="px-4 py-3">
                  {job.provider === "zoho_crm" && job.status !== "Completed" ? (
                    <button
                      type="button"
                      disabled={retryingCaptureId === job.capture_id}
                      onClick={() => retry(job.capture_id)}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {retryingCaptureId === job.capture_id ? "Sending…" : "Retry"}
                    </button>
                  ) : "—"}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-sm text-slate-500">No sync jobs recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
