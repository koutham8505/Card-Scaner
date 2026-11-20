import { AppShell, PageHeader } from "@/components/app-shell";

export default function SettingsPage() {
  return (
    <AppShell>
      <PageHeader title="Administration" subtitle="Settings and integrations" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          "Events",
          "Staff users",
          "Product categories",
          "Google Drive config",
          "Zoho CRM config",
          "Field mappings",
          "Retention settings",
          "Audit logs",
          "OCR configuration",
        ].map((item) => (
          <div key={item} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-base font-bold text-slate-900">{item}</p>
            <p className="mt-2 text-sm text-slate-600">Pending configuration and secure admin review required before live integration.</p>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
