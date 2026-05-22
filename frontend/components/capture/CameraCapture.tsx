"use client";

import { useRef, useState, useCallback } from "react";
import Webcam from "react-webcam";
import { Button } from "@/components/ui/button";
import { Camera, Upload, RotateCcw, CheckCircle, AlertCircle } from "lucide-react";

export interface CapturedImage {
  file: File;
  dataUrl: string;
}

interface Props {
  label: string;
  hint: string;
  overlayShape: "rect" | "oval";
  facingMode: "user" | "environment";
  onCapture: (img: CapturedImage) => void;
  onBack?: () => void;
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  const u8arr = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);
  return new File([u8arr], filename, { type: mime });
}

function computeBlurScore(data: Uint8ClampedArray, w: number, h: number): number {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const lap =
        -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
      sum += lap;
      sum2 += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

async function processImage(
  dataUrl: string,
  filename: string
): Promise<{ ok: boolean; reason?: string; file?: File; dataUrl?: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w < 320 || h < 240) {
        return resolve({ ok: false, reason: `Resolution too low (${w}×${h}). Minimum 320×240.` });
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const cx = Math.floor(w * 0.25), cy = Math.floor(h * 0.25);
      const cw = Math.floor(w * 0.5), ch = Math.floor(h * 0.5);
      const blurScore = computeBlurScore(ctx.getImageData(cx, cy, cw, ch).data, cw, ch);
      if (blurScore < 50) {
        return resolve({ ok: false, reason: `Image too blurry. Move closer or improve lighting.` });
      }

      let quality = 0.85;
      let compressed = canvas.toDataURL("image/jpeg", quality);
      while (compressed.length > 1.5 * 1024 * 1024 * 1.37 && quality > 0.5) {
        quality -= 0.1;
        compressed = canvas.toDataURL("image/jpeg", quality);
      }
      resolve({ ok: true, file: dataUrlToFile(compressed, filename), dataUrl: compressed });
    };
    img.onerror = () => resolve({ ok: false, reason: "Failed to load image" });
    img.src = dataUrl;
  });
}

export function CameraCapture({ label, hint, overlayShape, facingMode, onCapture, onBack }: Props) {
  const webcamRef = useRef<Webcam>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [qualityError, setQualityError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [pendingImage, setPendingImage] = useState<CapturedImage | null>(null);

  const runQualityCheck = useCallback(async (dataUrl: string, filename: string) => {
    setProcessing(true);
    setQualityError(null);
    const result = await processImage(dataUrl, filename);
    setProcessing(false);
    if (!result.ok) {
      setQualityError(result.reason ?? "Quality check failed");
      setPreview(dataUrl);
      setPendingImage(null);
    } else {
      setPreview(result.dataUrl!);
      setPendingImage({ file: result.file!, dataUrl: result.dataUrl! });
    }
  }, []);

  const handleCaptureClick = useCallback(async () => {
    const dataUrl = webcamRef.current?.getScreenshot({ width: 1280, height: 720 });
    if (!dataUrl) return;
    await runQualityCheck(dataUrl, `${label.replace(/\s+/g, "_")}.jpg`);
  }, [label, runQualityCheck]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      await runQualityCheck(ev.target?.result as string, file.name);
    };
    reader.readAsDataURL(file);
  }, [runQualityCheck]);

  const handleRetake = () => {
    setPreview(null);
    setQualityError(null);
    setPendingImage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="flex flex-col min-h-dvh bg-zinc-950 sm:min-h-0 sm:rounded-2xl sm:overflow-hidden sm:border sm:border-zinc-200 sm:shadow-sm sm:bg-white">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-3 sm:pt-5 sm:bg-white sm:border-b sm:border-zinc-100">
        {onBack && (
          <button onClick={onBack} className="text-zinc-400 hover:text-white sm:hover:text-zinc-900 transition-colors p-1 -ml-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <div>
          <h2 className="text-base font-semibold text-white sm:text-zinc-900">{label}</h2>
          <p className="text-xs text-zinc-400 sm:text-zinc-500 mt-0.5">{hint}</p>
        </div>
      </div>

      {/* Camera / Preview */}
      <div className="relative flex-1 sm:flex-none sm:aspect-[4/3] bg-zinc-950 overflow-hidden">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Captured" className="w-full h-full object-cover" />
        ) : !cameraFailed ? (
          <>
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              videoConstraints={{ width: 1280, height: 720, facingMode }}
              onUserMediaError={() => setCameraFailed(true)}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {overlayShape === "oval" ? (
                <svg viewBox="0 0 200 260" className="w-[55%] h-[75%]">
                  <ellipse cx="100" cy="130" rx="90" ry="120"
                    fill="none" stroke="white" strokeWidth="2.5"
                    strokeDasharray="8 4" opacity="0.7" />
                </svg>
              ) : (
                <div className="border-2 border-white border-dashed rounded-xl opacity-70"
                  style={{ width: "82%", height: "72%" }} />
              )}
            </div>
          </>
        ) : (
          <div className="w-full h-full min-h-[240px] flex flex-col items-center justify-center gap-3 text-zinc-500">
            <Camera className="w-12 h-12 text-zinc-600" />
            <p className="text-sm">Camera unavailable — use file upload</p>
          </div>
        )}

        {processing && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <p className="text-white text-sm font-medium">Checking quality...</p>
          </div>
        )}

        {qualityError && preview && (
          <div className="absolute bottom-0 inset-x-0 bg-red-950/95 px-4 py-3 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
            <p className="text-red-100 text-sm">{qualityError}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-5 pb-8 sm:pb-5 space-y-2.5 bg-zinc-950 sm:bg-white sm:border-t sm:border-zinc-100">
        {!preview ? (
          <>
            {!cameraFailed && (
              <Button
                onClick={handleCaptureClick}
                disabled={processing}
                className="w-full h-14 sm:h-11 text-base sm:text-sm bg-white text-zinc-900 hover:bg-zinc-100 sm:bg-zinc-900 sm:text-white sm:hover:bg-zinc-700"
              >
                <Camera className="w-5 h-5 mr-2" />
                {processing ? "Checking..." : "Take Photo"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
              className="w-full h-12 sm:h-10 text-zinc-400 hover:text-white sm:text-zinc-600 sm:hover:text-zinc-900 hover:bg-zinc-800 sm:hover:bg-zinc-50"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload from Device
            </Button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          </>
        ) : qualityError ? (
          <Button onClick={handleRetake} className="w-full h-14 sm:h-11 bg-white text-zinc-900 hover:bg-zinc-100 sm:bg-zinc-900 sm:text-white sm:hover:bg-zinc-700">
            <RotateCcw className="w-4 h-4 mr-2" />
            Try Again
          </Button>
        ) : (
          <div className="flex gap-2.5">
            <Button onClick={handleRetake} variant="ghost" className="flex-1 h-14 sm:h-11 text-zinc-400 hover:text-white sm:text-zinc-600 sm:hover:text-zinc-900 hover:bg-zinc-800 sm:hover:bg-zinc-50">
              <RotateCcw className="w-4 h-4 mr-2" />
              Retake
            </Button>
            <Button
              onClick={() => pendingImage && onCapture(pendingImage)}
              className="flex-1 h-14 sm:h-11 bg-white text-zinc-900 hover:bg-zinc-100 sm:bg-zinc-900 sm:text-white sm:hover:bg-zinc-700"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Use Photo
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
