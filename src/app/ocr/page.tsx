"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";
import { CheckCircle, LoaderCircle, RefreshCw } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Capture = {
  id: string;
  capture_code: string;
  status: string;
  verification_status: string;
  front_path: string | null;
  back_path: string | null;
  raw_text_front: string | null;
  raw_text_back: string | null;
  extracted_fields: Record<string, string>;
  field_confidences: Record<string, string>;
  conflicts: Array<{ field: string; front: string; back: string }>;
};

type EditableFields = {
  full_name: string;
  designation: string;
  institution: string;
  email: string;
  mobile: string;
  alternate_phone: string;
  website: string;
  city: string;
  state: string;
};

const FIELD_LABELS: Record<keyof EditableFields, string> = {
  full_name: "Full name",
  designation: "Designation",
  institution: "Institution",
  email: "Email",
  mobile: "Phone",
  alternate_phone: "Alternate phone",
  website: "Website",
  city: "City",
  state: "State",
};

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfidenceBadge({ level }: { level?: string }) {
  if (!level) return null;
  const styles: Record<string, string> = {
    high: "bg-emerald-50 text-emerald-700",
    medium: "bg-amber-50 text-amber-700",
    low: "bg-red-50 text-red-700",
  };
  return (
    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${styles[level] ?? "bg-slate-100 text-slate-600"}`}>
      {level}
    </span>
  );
}

// ── Inner page (needs useSearchParams) ───────────────────────────────────────

function OCRReviewInner() {
  const router = useRouter();
  const params = useSearchParams();
  const captureId = params.get("id");

  const [capture, setCapture] = useState<Capture | null>(null);
  const [fields, setFields] = useState<EditableFields>({
    full_name: "", designation: "", institution: "",
    email: "", mobile: "", alternate_phone: "",
    website: "", city: "", state: "",
  });
  const [loadError, setLoadError] = useState("");
  const [runningOcr, setRunningOcr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  // ── Load capture ────────────────────────────────────────────────────────────
  const loadCapture = async (id: string): Promise<Capture> => {
    const response = await fetch(`${apiUrl}/api/v1/captures/${id}`);
    if (!response.ok) throw new Error("Capture not found.");
    return response.json();
  };

  const applyCapture = (data: Capture) => {
    setCapture(data);
    const merged = { ...data.extracted_fields };
    setFields({
      full_name: merged.full_name ?? "",
      designation: merged.designation ?? "",
      institution: merged.institution ?? "",
      email: merged.email ?? "",
      mobile: merged.mobile ?? "",
      alternate_phone: merged.alternate_phone ?? "",
      website: merged.website ?? "",
      city: merged.city ?? "",
      state: merged.state ?? "",
    });
  };

  useEffect(() => {
    if (!captureId) return;
    let active = true;
    loadCapture(captureId)
      .then((data) => {
        if (active) applyCapture(data);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : "Failed to load capture.");
      });
    return () => {
      active = false;
    };
  }, [captureId]);

  // ── Trigger OCR ─────────────────────────────────────────────────────────────
  const triggerOcr = async () => {
    if (!captureId) return;
    setRunningOcr(true);
    setLoadError("");
    try {
      // POST with empty text so the backend uses the stored images.
      const res = await fetch(`${apiUrl}/api/v1/captures/${captureId}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front_raw_text: "", back_raw_text: "" }),
      });
      if (!res.ok) throw new Error("OCR processing failed.");
      applyCapture(await loadCapture(captureId));
      setMessage("OCR complete. Review and correct the fields below.");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "OCR failed.");
    } finally {
      setRunningOcr(false);
    }
  };

  // ── Save verified fields ────────────────────────────────────────────────────
  const saveVerification = async () => {
    if (!captureId) return;
    if (!fields.full_name.trim()) { setSaveError("Full name is required."); return; }
    setSaving(true); setSaveError(""); setMessage("");
    try {
      const res = await fetch(`${apiUrl}/api/v1/captures/${captureId}/verify`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error("Could not save verification.");
      setMessage("Fields verified. Proceed to qualify this lead.");
      setTimeout(() => router.push(`/qualify?id=${captureId}`), 1200);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof EditableFields, value: string) =>
    setFields((f) => ({ ...f, [key]: value }));

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!captureId || loadError) {
    return (
      <AppShell>
        <PageHeader title="OCR Review" subtitle="Field verification" />
        <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm text-red-700">
          {loadError || "No capture ID provided. Go back and scan a card first."}
        </p>
      </AppShell>
    );
  }

  if (!capture) {
    return (
      <AppShell>
        <PageHeader title="OCR Review" subtitle="Field verification" />
        <div className="flex items-center gap-3 rounded-2xl bg-white p-8 text-sm text-slate-500">
          <LoaderCircle className="animate-spin" size={18} /> Loading capture…
        </div>
      </AppShell>
    );
  }

  const hasExtracted = Object.keys(capture.extracted_fields).length > 0;
  const ocrNotRun = capture.status === "Received by Server";

  return (
    <AppShell>
      <PageHeader title="OCR Review" subtitle={capture.capture_code} />

      {/* Status bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{capture.status}</span>
          {capture.conflicts.length > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              {capture.conflicts.length} conflict{capture.conflicts.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          onClick={triggerOcr}
          disabled={runningOcr}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
        >
          {runningOcr ? <LoaderCircle className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          {runningOcr ? "Running OCR…" : ocrNotRun ? "Run OCR" : "Re-run OCR"}
        </button>
      </div>

      {/* Conflict warnings */}
      {capture.conflicts.map((c) => (
        <div key={c.field} className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>{FIELD_LABELS[c.field as keyof EditableFields] ?? c.field}</strong> — front: <em>{c.front}</em> · back: <em>{c.back}</em>
        </div>
      ))}

      {/* No OCR yet nudge */}
      {ocrNotRun && !hasExtracted && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
          OCR has not run yet. Click <strong>Run OCR</strong> to extract fields from the card images, or fill in the fields manually below.
        </div>
      )}

      {/* Editable fields */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-bold text-slate-900">Verify extracted fields</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(FIELD_LABELS) as Array<keyof EditableFields>).map((key) => (
            <label key={key} className="block text-sm font-medium text-slate-700">
              <span className="mb-1 flex items-center">
                {FIELD_LABELS[key]}
                <ConfidenceBadge level={capture.field_confidences[key]} />
              </span>
              <input
                value={fields[key]}
                onChange={(e) => update(key, e.target.value)}
                required={key === "full_name"}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-300 focus:bg-white"
              />
            </label>
          ))}
        </div>

        {/* Raw text preview */}
        {(capture.raw_text_front || capture.raw_text_back) && (
          <details className="mt-5">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
              Raw OCR text
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {capture.raw_text_front && (
                <pre className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">{capture.raw_text_front}</pre>
              )}
              {capture.raw_text_back && (
                <pre className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap">{capture.raw_text_back}</pre>
              )}
            </div>
          </details>
        )}

        {saveError && <p role="alert" className="mt-4 text-sm font-medium text-red-700">{saveError}</p>}
        {message && (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle size={16} /> {message}
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={saveVerification}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="animate-spin" size={16} /> : <CheckCircle size={16} />}
            {saving ? "Saving…" : "Confirm and proceed to qualify"}
          </button>
        </div>
      </div>
    </AppShell>
  );
}

// Wrap in Suspense because useSearchParams requires it in Next.js app router.
export default function OCRReviewPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <PageHeader title="OCR Review" subtitle="Field verification" />
        <div className="flex items-center gap-3 rounded-2xl bg-white p-8 text-sm text-slate-500">
          <LoaderCircle className="animate-spin" size={18} /> Loading…
        </div>
      </AppShell>
    }>
      <OCRReviewInner />
    </Suspense>
  );
}
