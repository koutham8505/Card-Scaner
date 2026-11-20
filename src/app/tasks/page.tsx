import { AppShell, PageHeader, ActionButton } from "@/components/app-shell";

export default function TasksPage() {
  return (
    <AppShell>
      <PageHeader title="Follow-ups" subtitle="Managed in Zoho CRM" />
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900">Follow up in Zoho CRM</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          EventConnect keeps the lead and card-image backup in Supabase, then sends qualified lead data through Zoho Flow. It does not create follow-up tasks; manage follow-ups in Zoho CRM.
        </p>
        <div className="mt-5">
          <ActionButton href="/sync" label="View Zoho Flow delivery status" accent={false} />
        </div>
      </section>
    </AppShell>
  );
}
