"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";

type Task = { id: string; lead_name: string | null; assigned_owner: string | null; action_type: string; due_at: string; priority: string; status: string };

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { fetch(`${apiUrl}/api/v1/tasks`).then((response) => { if (!response.ok) throw new Error("Tasks could not be loaded."); return response.json(); }).then(setTasks).catch((exception) => setError(exception.message)); }, []);
  return (
    <AppShell>
      <PageHeader title="Follow-up Tasks" subtitle={`${tasks.length} live tasks`} />
      {error ? <p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : tasks.length === 0 ? <p className="rounded-2xl bg-white p-8 text-sm text-slate-500">No follow-up tasks have been created.</p> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tasks.map((task) => (
          <div key={task.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{task.id}</p>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">{task.status}</span>
            </div>
            <h3 className="text-lg font-bold text-slate-900">{task.lead_name ?? "Unassigned lead"}</h3>
            <p className="mt-2 text-sm text-slate-600">Owner: {task.assigned_owner ?? "Unassigned"}</p>
            <p className="mt-1 text-sm text-slate-600">Due: {new Date(task.due_at).toLocaleString()}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-slate-500">Action: {task.action_type}</p>
          </div>
        ))}
      </div>}
    </AppShell>
  );
}
