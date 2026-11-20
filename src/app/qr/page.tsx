"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";
import { Camera, LoaderCircle, QrCode, Square } from "lucide-react";

type BarcodeResult = { rawValue: string };
type BarcodeDetectorLike = {
  detect(source: HTMLVideoElement): Promise<BarcodeResult[]>;
};
type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike;

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

type Visitor = {
  full_name: string;
  institution?: string;
  designation?: string;
  email?: string;
  mobile?: string;
  city?: string;
  state?: string;
  country?: string;
};

const qrRegistrationEnabled = process.env.NEXT_PUBLIC_ENABLE_QR_REGISTRATION === "true";

function parseQrValue(rawValue: string): Visitor {
  let values: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("QR code must contain an object.");
    }
    values = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      let url: URL;
      try {
        url = new URL(rawValue);
      } catch {
        throw new Error("QR code must contain visitor JSON or a registration URL.");
      }
      values = Object.fromEntries(url.searchParams.entries());
    } else {
      throw error;
    }
  }
  const get = (...keys: string[]) => {
    for (const key of keys) {
      const value = values[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };
  const fullName = get("full_name", "name");
  if (!fullName) throw new Error("QR code does not include a visitor name.");
  return {
    full_name: fullName,
    institution: get("institution", "company", "organization"),
    designation: get("designation", "title", "role"),
    email: get("email"),
    mobile: get("mobile", "phone", "telephone"),
    city: get("city"),
    state: get("state", "region"),
    country: get("country"),
  };
}

export default function QRPage() {
  if (!qrRegistrationEnabled) {
    return (
      <AppShell>
        <PageHeader title="QR Registration" subtitle="Unavailable until the event QR format is validated" />
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          QR scanning and registration are disabled by deployment policy until an approved sample has been validated.
          <Link href="/manual" className="ml-1 font-semibold underline">Use manual entry</Link>.
        </section>
      </AppShell>
    );
  }
  return <QRRegistrationFlow />;
}

function QRRegistrationFlow() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const [consentStatus, setConsentStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const stopCamera = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const startCamera = async () => {
    setError("");
    setMessage("");
    setVisitor(null);
    if (!window.BarcodeDetector) {
      setError("QR camera scanning is not supported in this browser. Use manual entry instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      setScanning(true);
      if (!videoRef.current) throw new Error("Camera preview could not be initialized.");
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const scanFrame = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes[0]?.rawValue) {
            setVisitor(parseQrValue(codes[0].rawValue));
            stopCamera();
            return;
          }
        } catch {
          setError("Could not read the QR code. Hold it steady and try again.");
        }
        frameRef.current = requestAnimationFrame(() => void scanFrame());
      };
      frameRef.current = requestAnimationFrame(() => void scanFrame());
    } catch (exception) {
      stopCamera();
      setError(exception instanceof Error ? exception.message : "Camera access failed.");
    }
  };

  const submit = async () => {
    if (!visitor || !consentStatus || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/qr/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capture_id: crypto.randomUUID(),
          event_code: "DIDAC26",
          ...visitor,
          consent_status: consentStatus,
          consent_source: "QR check-in",
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? "Registration could not be saved.");
      setMessage(`Registration saved as ${result.capture_code}.`);
      setVisitor(null);
      setConsentStatus("");
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Registration could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const visitorFields: Array<[string, keyof Visitor]> = [
    ["Name", "full_name"],
    ["Institution", "institution"],
    ["Designation", "designation"],
    ["Email", "email"],
    ["Phone", "mobile"],
    ["City", "city"],
    ["State", "state"],
    ["Country", "country"],
  ];

  return (
    <AppShell>
      <PageHeader title="QR Registration" subtitle="Scan and confirm visitor details" />
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><QrCode size={20} /> Visitor QR code</h2>
          <video ref={videoRef} muted playsInline className={`mt-4 max-h-80 w-full rounded-2xl bg-slate-950 object-contain ${scanning ? "" : "hidden"}`} />
          {!scanning && (
            <div className="mt-4 flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center">
              <Camera size={30} className="mb-3 text-slate-500" />
              <p className="text-sm text-slate-600">Scan a QR containing visitor JSON or a registration URL with visitor fields.</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {!scanning ? (
              <button onClick={() => void startCamera()} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
                <Camera size={16} /> Open camera
              </button>
            ) : (
              <button onClick={stopCamera} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">
                <Square size={15} /> Stop camera
              </button>
            )}
            <Link href="/manual" className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
              Manual entry
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">Camera access requires HTTPS or localhost and user permission. Review the decoded fields before saving.</p>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Confirm registration</h2>
          {visitor ? (
            <>
              <dl className="mt-4 space-y-2">
                {visitorFields.map(([label, key]) => visitor[key] ? (
                  <div key={key} className="flex justify-between gap-4 rounded-xl bg-slate-50 p-3 text-sm">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-right font-medium text-slate-900">{visitor[key]}</dd>
                  </div>
                ) : null)}
              </dl>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                <span className="mb-2 block">Visitor consent *</span>
                <select
                  value={consentStatus}
                  onChange={(event) => setConsentStatus(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                >
                  <option value="">Record consent status…</option>
                  <option value="granted">Granted</option>
                  <option value="verbal">Verbal</option>
                  <option value="declined">Declined</option>
                </select>
              </label>
              <button
                onClick={() => void submit()}
                disabled={saving || !consentStatus}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving && <LoaderCircle size={16} className="animate-spin" />}
                {saving ? "Saving…" : "Confirm and save"}
              </button>
            </>
          ) : (
            <p className="mt-4 rounded-2xl bg-slate-50 p-5 text-sm text-slate-600">Scan a QR code to review its visitor details.</p>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
        </div>
      </section>
    </AppShell>
  );
}
