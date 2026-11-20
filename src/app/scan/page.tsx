"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { apiUrl } from "@/lib/api";
import { enqueueCapture, offlineCaptureEnabled } from "@/lib/offline-queue";
import { Camera, Check, ImagePlus, LoaderCircle, RotateCcw, ShieldAlert } from "lucide-react";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;
// Compress images to this max dimension before uploading (saves bandwidth on
// event Wi-Fi and speeds up server OCR).
const MAX_DIMENSION = 1800;
const JPEG_QUALITY = 0.85;

type ImageSide = "front" | "back";
type CaptureImage = { file: File; preview: string };

// ── Image compression ─────────────────────────────────────────────────────────

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        JPEG_QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── ImageCapture widget ───────────────────────────────────────────────────────

type ImageCaptureProps = {
  side: ImageSide;
  image?: CaptureImage;
  inputRef: (el: HTMLInputElement | null) => void;
  openPicker: () => void;
  selectImage: (side: ImageSide, file?: File) => void;
  removeImage: (side: ImageSide) => void;
};

function ImageCapture({ side, image, inputRef, openPicker, selectImage, removeImage }: ImageCaptureProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{side === "front" ? "Front Side" : "Back Side"}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          {side === "front" ? "Required" : "Optional"}
        </span>
      </div>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={(e) => selectImage(side, e.target.files?.[0])}
      />
      {image ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.preview} alt={`${side} card preview`} className="h-72 w-full object-contain" />
        </div>
      ) : (
        <button
          onClick={openPicker}
          className="flex h-72 w-full items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500"
        >
          <span className="text-center">
            {side === "front" ? <Camera size={32} className="mx-auto mb-3" /> : <ImagePlus size={32} className="mx-auto mb-3" />}
            <strong>{`Capture ${side}`}</strong>
            <small className="mt-1 block">Rear camera preferred</small>
          </span>
        </button>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={openPicker} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          {image ? `Replace ${side}` : `Choose ${side}`}
        </button>
        {image && (
          <button onClick={() => removeImage(side)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm">
            <RotateCcw size={15} /> Remove
          </button>
        )}
      </div>
    </section>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScanPage() {
  const router = useRouter();
  const [images, setImages] = useState<Partial<Record<ImageSide, CaptureImage>>>({});
  const [status, setStatus] = useState("Waiting for front card image");
  const [submitting, setSubmitting] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState("");
  const [capturedId, setCapturedId] = useState<string | null>(null);
  const fileInputs = useRef<Record<ImageSide, HTMLInputElement | null>>({ front: null, back: null });

  useEffect(() => () => Object.values(images).forEach((img) => URL.revokeObjectURL(img.preview)), [images]);

  const selectImage = async (side: ImageSide, file?: File) => {
    setError("");
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) { setError("Use a JPG, PNG, or WebP image."); return; }
    if (file.size > MAX_BYTES) { setError("The image must be smaller than 15 MB."); return; }

    // Compress before previewing so the preview reflects what will be uploaded.
    setCompressing(true);
    const compressed = await compressImage(file);
    setCompressing(false);

    setImages((cur) => ({ ...cur, [side]: { file: compressed, preview: URL.createObjectURL(compressed) } }));
    setStatus(side === "front" ? "Front ready to upload" : "Back ready to upload");
  };

  const removeImage = (side: ImageSide) => {
    setImages((cur) => ({ ...cur, [side]: undefined }));
    setStatus(`Waiting for ${side} card image`);
  };

  const saveCapture = async () => {
    if (!images.front) { setError("A front image is required before saving."); return; }
    setSubmitting(true);
    setError("");
    const captureId = crypto.randomUUID();
    try {
      const form = new FormData();
      form.append("capture_id", captureId);
      form.append("event_code", "DIDAC26");
      form.append("capture_method", "scanner");
      form.append("front", images.front.file);
      if (images.back) form.append("back", images.back.file);

      const response = await fetch(`${apiUrl}/api/v1/captures`, {
        method: "POST",
        body: form,
        headers: { "Idempotency-Key": captureId },
      });
      const payload = await response.json();
      if (!response.ok) {
        if (offlineCaptureEnabled && (response.status >= 500 || response.status === 408 || response.status === 429)) {
          await enqueueCapture({
            captureId,
            eventCode: "DIDAC26",
            captureMethod: "scanner",
            front: images.front.file,
            frontName: images.front.file.name,
            frontType: images.front.file.type,
            back: images.back?.file,
            backName: images.back?.file.name,
            backType: images.back?.file.type,
            queuedAt: new Date().toISOString(),
          });
          setStatus(`Saved in offline queue (${captureId.slice(0, 8)})`);
          setError("");
          return;
        }
        throw new Error(payload.detail ?? "Capture could not be received.");
      }
      setStatus(`Received ${payload.capture_code}`);
      setCapturedId(captureId);
    } catch (exception) {
      if (exception instanceof TypeError && offlineCaptureEnabled) {
        try {
          await enqueueCapture({
            captureId,
            eventCode: "DIDAC26",
            captureMethod: "scanner",
            front: images.front.file,
            frontName: images.front.file.name,
            frontType: images.front.file.type,
            back: images.back?.file,
            backName: images.back?.file.name,
            backType: images.back?.file.type,
            queuedAt: new Date().toISOString(),
          });
          setStatus(`Saved in offline queue (${captureId.slice(0, 8)})`);
          setError("");
          return;
        } catch (queueError) {
          setError(queueError instanceof Error ? queueError.message : "Offline storage failed.");
        }
      } else {
        setError(exception instanceof Error ? exception.message : "Capture could not be received.");
      }
      setStatus("Upload not confirmed — keep this page open and retry.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Scan Visiting Card" subtitle="Front and back capture" />

      <div className="grid gap-6 lg:grid-cols-2">
        <ImageCapture side="front" image={images.front} inputRef={(el) => { fileInputs.current.front = el; }} openPicker={() => fileInputs.current.front?.click()} selectImage={selectImage} removeImage={removeImage} />
        <ImageCapture side="back"  image={images.back}  inputRef={(el) => { fileInputs.current.back = el; }}  openPicker={() => fileInputs.current.back?.click()}  selectImage={selectImage} removeImage={removeImage} />
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {/* Status / action bar */}
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        {capturedId ? (
          /* ── Success: show next-step CTA ── */
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-semibold text-emerald-700">
                <Check size={18} className="shrink-0" /> {status}
              </p>
              <p className="mt-1 text-sm text-slate-500">The server acknowledged this card. Review the fields and qualify the lead.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => router.push(`/ocr?id=${capturedId}`)}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200"
              >
                Review OCR &amp; qualify →
              </button>
              <button
                onClick={() => { setImages({}); setCapturedId(null); setStatus("Waiting for front card image"); }}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700"
              >
                Scan another card
              </button>
            </div>
          </div>
        ) : (
          /* ── Default: save button ── */
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{compressing ? "Compressing image…" : status}</p>
              <p className="mt-1 text-sm text-slate-500">
                Images are compressed before upload. {offlineCaptureEnabled ? "Temporary offline captures are stored in this browser until sync succeeds." : "Offline capture is disabled by deployment policy."}
              </p>
            </div>
            {status.startsWith("Saved in offline queue") ? (
              <button onClick={() => router.push("/offline")} className="rounded-2xl bg-slate-900 px-5 py-3 font-semibold text-white">
                Open offline queue
              </button>
            ) : <button
              disabled={submitting || compressing}
              onClick={saveCapture}
              className="inline-flex min-w-44 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              {submitting ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />}
              {submitting ? "Saving…" : "Save capture"}
            </button>}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p>Images are compressed to max {MAX_DIMENSION}px and validated before upload. OCR runs on the server after saving.</p>
      </div>
    </AppShell>
  );
}
