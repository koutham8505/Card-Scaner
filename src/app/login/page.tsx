"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "Access denied.");
      router.replace("/home");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Sign-in failed.");
      setChecking(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_#ecfdf5,_#ffffff_38%,_#f8fafc_100%)] px-4">
      <div className="w-full max-w-sm rounded-[32px] border border-slate-200 bg-white/90 p-8 shadow-2xl shadow-slate-200/60 backdrop-blur">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 text-2xl font-bold text-white shadow-lg shadow-emerald-200">
            R
          </div>
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Rareminds</p>
            <h1 className="text-xl font-bold text-slate-900">EventConnect</h1>
            <p className="mt-1 text-sm text-slate-500">DIDAC 2026 • Authorized access</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            <span className="mb-2 block">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              required
            />
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={checking || !password}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200 disabled:opacity-60"
          >
            {checking ? "Checking…" : "Continue"}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck size={13} />
          <span>Protected access · DIDAC 2026</span>
        </div>
      </div>
    </main>
  );
}
