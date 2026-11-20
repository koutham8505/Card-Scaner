"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";
import {
  listQueuedCaptures,
  QueuedCapture,
  removeQueuedCapture,
} from "@/lib/offline-queue";
import { LoaderCircle, RefreshCw, Trash2 } from "lucide-react";

export default function OfflinePage() {
  const [captures, setCaptures] = useState<QueuedCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setCaptures(await listQueuedCaptures());
      setError("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Could not read the offline queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    listQueuedCaptures()
      .then((items) => {
        if (active) setCaptures(items);
      })
      .catch((exception: unknown) => {
        if (active) setError(exception instanceof Error ? exception.message : "Could not read the offline queue.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const syncAll = useCallback(async () => {
    if (syncing || captures.length === 0) return;
    setSyncing(true);
    setError("");
    setMessage("");
    let synced = 0;
    let failed = 0;
    const failureReasons: string[] = [];
    try {
      for (const capture of captures) {
        const form = new FormData();
        form.append("capture_id", capture.captureId);
        form.append("event_code", capture.eventCode);
        form.append("capture_method", capture.captureMethod);
        form.append("front", capture.front, capture.frontName);
        if (capture.back && capture.backName) {
          form.append("back", capture.back, capture.backName);
        }

        try {
          const response = await fetch(`${apiUrl}/api/v1/captures`, {
            method: "POST",
            headers: { "Idempotency-Key": capture.captureId },
            body: form,
          });
          if (!response.ok) {
            let detail = `Server rejected capture (${response.status}).`;
            try {
              const body: unknown = await response.json();
              if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string") {
                detail = body.detail;
              }
            } catch {
              detail = `Server rejected capture (${response.status}) with an unreadable error response.`;
            }
            throw new Error(detail);
          }
          await removeQueuedCapture(capture.captureId);
          synced += 1;
        } catch (exception) {
          failed += 1;
          if (exception instanceof Error) failureReasons.push(exception.message);
        }
      }
      setMessage(`${synced} capture${synced === 1 ? "" : "s"} synced; ${failed} remain queued.`);
      await refresh();
      if (failureReasons.length > 0) setError(`Sync failed: ${failureReasons[0]}`);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Offline queue sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [captures, refresh, syncing]);

  useEffect(() => {
    const syncWhenOnline = () => {
      if (navigator.onLine) void syncAll();
    };
    window.addEventListener("online", syncWhenOnline);
    return () => window.removeEventListener("online", syncWhenOnline);
  }, [syncAll]);

  const discard = async (captureId: string) => {
    if (!window.confirm("Permanently delete this unsynced card image from this browser?")) return;
    try {
      await removeQueuedCapture(captureId);
      await refresh();
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Could not delete the queued capture.");
    }
  };

  return (
    <AppShell>
      <PageHeader title="Offline Queue" subtitle={`${captures.length} pending`} />
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Pending card uploads</h2>
            <p className="mt-1 text-sm text-slate-600">
              Images are stored in this browser until the server confirms receipt. They are removed from this queue after successful sync.
            </p>
          </div>
          <button
            disabled={syncing || captures.length === 0 || typeof navigator === "undefined" || !navigator.onLine}
            onClick={() => void syncAll()}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {syncing ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {syncing ? "Syncing…" : "Sync all"}
          </button>
        </div>

        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}

        {loading ? (
          <p className="py-8 text-sm text-slate-500">Reading this browser’s queue…</p>
        ) : captures.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-600">No pending captures.</p>
        ) : (
          <ul className="space-y-3">
            {captures.map((capture) => (
              <li key={capture.captureId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4">
                <div>
                  <p className="font-semibold text-slate-900">Capture {capture.captureId.slice(0, 8).toUpperCase()}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Queued {new Date(capture.queuedAt).toLocaleString()} · {capture.back ? "Front and back" : "Front image"}
                  </p>
                </div>
                <button
                  onClick={() => void discard(capture.captureId)}
                  disabled={syncing}
                  aria-label="Delete queued card image"
                  className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
                >
                  <Trash2 size={15} /> Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Offline images are stored in browser IndexedDB and are not encrypted by this app. Use only organization-managed devices, keep the browser profile protected, and sync or delete queued captures promptly.
      </p>
    </AppShell>
  );
}
