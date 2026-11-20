import Link from "next/link";
import { ArrowRight, Camera, ChevronRight, MapPinned, ShieldCheck, Smartphone } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#ecfdf5,_#ffffff_38%,_#f8fafc_100%)] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-6xl rounded-[32px] border border-slate-200 bg-white/80 p-5 shadow-2xl shadow-slate-200/60 backdrop-blur sm:p-8">
        <header className="mb-10 flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 text-xl font-bold text-white">R</div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Rareminds</p>
              <h1 className="text-xl font-bold sm:text-2xl">EventConnect</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            <ShieldCheck size={14} /> DIDAC 2026 • Booth operations
          </div>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <Camera size={14} /> Booth capture platform
            </div>
            <h2 className="max-w-xl text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              Capture, verify, and qualify visitor leads in real time.
            </h2>
            <p className="max-w-xl text-lg leading-8 text-slate-600">
              Capture front/back business cards, review OCR, qualify leads, and monitor event activity. Offline capture is deployment-controlled; Drive and CRM handoff are not yet implemented.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/home" className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200">
                Launch staff app <ArrowRight size={16} />
              </Link>
              <Link href="/scan" className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
                Scan visiting card
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Network</p>
                <div className="mt-2 flex items-center gap-2 font-semibold text-slate-900"><Smartphone size={16} /> Online; offline requires approval</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Capture</p>
                <div className="mt-2 flex items-center gap-2 font-semibold text-slate-900"><Camera size={16} /> Front + back</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Location</p>
                <div className="mt-2 flex items-center gap-2 font-semibold text-slate-900"><MapPinned size={16} /> Bengaluru</div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-slate-950 p-5 text-white shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm uppercase tracking-[0.22em] text-slate-300">Implementation status</p>
              <span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-300">Staging foundations</span>
            </div>
            <div className="space-y-4">
              {[
                "Shared-password access gate",
                "Mobile-first dashboard and navigation",
                "Lead capture and verification flow",
                "OCR review and qualification form",
                "QR visitor capture (disabled pending payload validation)",
                "Offline queue (disabled by default)",
                "Drive + CRM integrations not implemented",
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl bg-white/5 p-3 text-sm text-slate-100 ring-1 ring-white/10">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"><ChevronRight size={14} /></div>
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4 text-sm text-cyan-200">
              Use a strong shared access password and rotate it when staff access changes. Validate database storage, browser recovery, and QR payloads before production. Drive and CRM adapters still need implementation.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
