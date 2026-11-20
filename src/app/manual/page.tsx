"use client";

import { FormEvent, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";

type FormState = {
  full_name: string;
  institution: string;
  designation: string;
  email: string;
  mobile: string;
  city: string;
  state: string;
  notes: string;
  lead_priority: string;
  next_action: string;
  consent_status: string;
};

const BLANK: FormState = {
  full_name: "", institution: "", designation: "",
  email: "", mobile: "", city: "", state: "",
  notes: "", lead_priority: "Warm",
  next_action: "Call", consent_status: "unknown",
};

const TEXT_FIELDS = [
  ["full_name",    "Full name *"],
  ["institution",  "Institution"],
  ["designation",  "Designation"],
  ["email",        "Email"],
  ["mobile",       "Phone"],
  ["city",         "City"],
  ["state",        "State"],
] as const;

export default function ManualEntryPage() {
  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const update = (key: keyof FormState, value: string) =>
    setForm((cur) => ({ ...cur, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    // Client-side validation
    if (!form.full_name.trim())
      return setError("Full name is required.");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return setError("Enter a valid email address.");
    if (form.mobile && !/^[+\d][\d\s\-().]{6,}$/.test(form.mobile))
      return setError("Enter a valid phone number.");
    if (form.consent_status === "unknown")
      return setError("Please confirm the visitor's consent status before saving.");

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/captures/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capture_id: crypto.randomUUID(),
          event_code: "DIDAC26",
          fields: {
            full_name: form.full_name,
            institution: form.institution,
            designation: form.designation,
            email: form.email,
            mobile: form.mobile,
            city: form.city,
            state: form.state,
          },
          qualification: {
            lead_priority: form.lead_priority,
            next_action: form.next_action,
            notes: form.notes,
            consent_status: form.consent_status,
          },
        }),
      });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Lead could not be saved.");
      const result = await response.json();
      setMessage(`Lead saved as ${result.capture_code}.`);
      setForm(BLANK);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Lead could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Manual Entry" subtitle="Verified persistence" />
      <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">

          {/* Text fields */}
          {TEXT_FIELDS.map(([key, label]) => (
            <label key={key} className="block text-sm font-medium text-slate-700">
              <span className="mb-2 block">{label}</span>
              <input
                required={key === "full_name"}
                value={form[key]}
                onChange={(e) => update(key, e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none transition focus:border-emerald-300 focus:bg-white"
                type={key === "email" ? "email" : key === "mobile" ? "tel" : "text"}
              />
            </label>
          ))}

          {/* Priority */}
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-2 block">Priority</span>
            <select value={form.lead_priority} onChange={(e) => update("lead_priority", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
              <option>Hot</option><option>Warm</option><option>Cold</option>
            </select>
          </label>

          {/* Next action */}
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-2 block">Next action</span>
            <select value={form.next_action} onChange={(e) => update("next_action", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
              <option>Call</option><option>Email</option><option>Schedule Demo</option>
              <option>Schedule Meeting</option><option>Follow Up Later</option><option>No Action</option>
            </select>
          </label>

          {/* Consent — required field */}
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-2 block">Consent status *</span>
            <select value={form.consent_status} onChange={(e) => update("consent_status", e.target.value)} className={`w-full rounded-2xl border bg-slate-50 px-3 py-2.5 text-sm ${form.consent_status === "unknown" ? "border-amber-300" : "border-slate-200"}`}>
              <option value="unknown">— Select —</option>
              <option value="granted">Granted</option>
              <option value="verbal">Verbal only</option>
              <option value="declined">Declined</option>
            </select>
          </label>

          {/* Notes */}
          <label className="block text-sm font-medium text-slate-700 md:col-span-2">
            <span className="mb-2 block">Notes</span>
            <textarea rows={3} value={form.notes} onChange={(e) => update("notes", e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-300 focus:bg-white" />
          </label>
        </div>

        {error   && <p role="alert"  className="mt-4 text-sm font-medium text-red-700">{error}</p>}
        {message && <p role="status" className="mt-4 text-sm font-medium text-emerald-700">{message}</p>}

        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save and qualify lead"}
        </button>
      </form>
    </AppShell>
  );
}
