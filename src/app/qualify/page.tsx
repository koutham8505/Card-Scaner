"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";
import { productInterests } from "@/lib/mock-data";
import { CheckCircle, LoaderCircle } from "lucide-react";

type QualifyForm = {
  visitor_category: string;
  visitor_role: string;
  product_interests: string[];
  lead_priority: string;
  conversation_outcome: string;
  next_action: string;
  demo_date: string;
  notes: string;
  decision_maker: string;
  expected_timeline: string;
  assigned_owner: string;
  consent_status: string;
};

function QualifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const captureId = params.get("id");

  const [captureCode, setCaptureCode] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");

  const [form, setForm] = useState<QualifyForm>({
    visitor_category: "",
    visitor_role: "",
    product_interests: [],
    lead_priority: "Warm",
    conversation_outcome: "",
    next_action: "Call",
    demo_date: "",
    notes: "",
    decision_maker: "",
    expected_timeline: "",
    assigned_owner: "",
    consent_status: "granted",
  });

  useEffect(() => {
    if (!captureId) return;
    fetch(`${apiUrl}/api/v1/captures/${captureId}`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load capture.");
        return response.json();
      })
      .then((d) => setCaptureCode(d.capture_code ?? captureId))
      .catch(() => setLoadError("Could not load capture."));
  }, [captureId]);

  const update = (key: keyof QualifyForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleInterest = (interest: string) =>
    setForm((f) => ({
      ...f,
      product_interests: f.product_interests.includes(interest)
        ? f.product_interests.filter((i) => i !== interest)
        : [...f.product_interests, interest],
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!captureId) return;
    setSaving(true); setSaveError(""); setMessage(""); setSyncNotice("");
    try {
      const payload = {
        ...form,
        demo_date: form.demo_date || null,
        decision_maker: form.decision_maker === "yes" ? true : form.decision_maker === "no" ? false : null,
      };
      const res = await fetch(`${apiUrl}/api/v1/captures/${captureId}/qualify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).detail ?? "Could not qualify lead.");
      const result = await res.json();
      const syncStatus = result.crm_sync?.status;
      setMessage(syncStatus === "Sent to Zoho Flow"
        ? "Lead backed up and sent to Zoho Flow."
        : "Lead qualified and safely backed up in Supabase.");
      if (syncStatus === "Failed") {
        setSyncNotice(`Zoho Flow delivery failed: ${result.crm_sync.message} Retry it from Sync Monitor.`);
      } else if (syncStatus !== "Sent to Zoho Flow") {
        setSyncNotice("Zoho Flow delivery is pending configuration. You can check its status in Sync Monitor.");
      }
      setTimeout(() => router.push("/leads"), 1500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!captureId || loadError) {
    return (
      <AppShell>
        <PageHeader title="Qualify Lead" subtitle="Conversation outcome" />
        <p role="alert" className="rounded-2xl bg-red-50 p-5 text-sm text-red-700">
          {loadError || "No capture ID. Go back and scan a card first."}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title="Qualify Lead" subtitle={captureCode || "Conversation outcome"} />
      <form onSubmit={submit} className="space-y-5">

        {/* Priority + Decision maker */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-slate-900">Lead classification</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Priority</span>
              <select value={form.lead_priority} onChange={(e) => update("lead_priority", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <option>Hot</option><option>Warm</option><option>Cold</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Visitor category</span>
              <select value={form.visitor_category} onChange={(e) => update("visitor_category", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <option value="">Select…</option>
                {["Educator", "Institution Head", "HR / Recruiter", "Student", "Government", "Investor", "Partner", "Press", "Other"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Decision maker?</span>
              <select value={form.decision_maker} onChange={(e) => update("decision_maker", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>
        </div>

        {/* Product interests */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-slate-900">Product interests</h2>
          <div className="flex flex-wrap gap-2">
            {productInterests.map((interest) => {
              const selected = form.product_interests.includes(interest);
              return (
                <button
                  key={interest}
                  type="button"
                  onClick={() => toggleInterest(interest)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${selected ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {interest}
                </button>
              );
            })}
          </div>
        </div>

        {/* Follow-up */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-slate-900">Follow-up</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Next action</span>
              <select value={form.next_action} onChange={(e) => setForm((current) => ({ ...current, next_action: e.target.value, demo_date: e.target.value === "Schedule Demo" ? current.demo_date : "" }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                {["Call", "Email", "Schedule Demo", "Schedule Meeting", "Follow Up Later", "No Action"].map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            {form.next_action === "Schedule Demo" && (
              <label className="block text-sm font-medium text-slate-700">
                <span className="mb-2 block">Demo date *</span>
                <input required type="date" value={form.demo_date} onChange={(e) => update("demo_date", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm" />
              </label>
            )}
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Assigned owner</span>
              <input value={form.assigned_owner} onChange={(e) => update("assigned_owner", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-300 focus:bg-white" placeholder="Staff name" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Expected timeline</span>
              <select value={form.expected_timeline} onChange={(e) => update("expected_timeline", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <option value="">Not specified</option>
                {["Immediate", "1–3 months", "3–6 months", "6–12 months", "Over 12 months"].map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">Consent status</span>
              <select value={form.consent_status} onChange={(e) => update("consent_status", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                <option value="granted">Granted</option>
                <option value="verbal">Verbal only</option>
                <option value="unknown">Unknown</option>
                <option value="declined">Declined</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700 md:col-span-2">
              <span className="mb-2 block">Conversation notes</span>
              <textarea rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-300 focus:bg-white" placeholder="Key points, requirements, commitments…" />
            </label>
          </div>
        </div>

        {saveError && <p role="alert" className="text-sm font-medium text-red-700">{saveError}</p>}
        {message && (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle size={16} /> {message}
          </p>
        )}
        {syncNotice && (
          <p role="status" className="rounded-2xl bg-amber-50 p-4 text-sm font-medium text-amber-800">
            {syncNotice} <a href="/sync" className="underline">Open Sync Monitor</a>
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
        >
          {saving ? <LoaderCircle className="animate-spin" size={16} /> : <CheckCircle size={16} />}
          {saving ? "Saving…" : "Save qualified lead"}
        </button>
      </form>
    </AppShell>
  );
}

export default function QualifyPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <PageHeader title="Qualify Lead" subtitle="Conversation outcome" />
        <div className="flex items-center gap-3 rounded-2xl bg-white p-8 text-sm text-slate-500">
          <LoaderCircle className="animate-spin" size={18} /> Loading…
        </div>
      </AppShell>
    }>
      <QualifyInner />
    </Suspense>
  );
}
