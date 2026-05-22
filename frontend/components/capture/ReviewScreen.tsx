"use client";

import { Button } from "@/components/ui/button";
import { RotateCcw, Send, Loader2 } from "lucide-react";
import type { DocumentType } from "@/lib/verification";
import { DOCUMENT_TYPE_LABELS } from "@/lib/verification";
import type { CapturedImage } from "./CameraCapture";

interface Images {
  front?: CapturedImage;
  back?: CapturedImage;
  selfie?: CapturedImage;
}

interface Props {
  images: Images;
  documentType: DocumentType;
  onRetake: (slot: "front" | "back" | "selfie") => void;
  onSubmit: () => void;
  submitting: boolean;
  error?: string;
}

export function ReviewScreen({
  images,
  documentType,
  onRetake,
  onSubmit,
  submitting,
  error,
}: Props) {
  const slots: { key: "front" | "back" | "selfie"; label: string }[] = [
    { key: "front", label: "Document Front" },
    ...(images.back ? [{ key: "back" as const, label: "Document Back" }] : []),
    { key: "selfie", label: "Selfie" },
  ];

  const canSubmit = !!images.front && !!images.selfie;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-6">
      <h2 className="text-xl font-semibold text-zinc-900 mb-1">Review Your Photos</h2>
      <p className="text-zinc-500 text-sm mb-5">
        {DOCUMENT_TYPE_LABELS[documentType]} — confirm all images are clear
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5">
        {slots.map(({ key, label }) => {
          const img = images[key];
          return (
            <div key={key} className="flex flex-col gap-2">
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
                {label}
              </span>
              <div className="relative rounded-xl overflow-hidden aspect-[4/3] bg-zinc-100">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.dataUrl} alt={label} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-300 text-xs">
                    Not captured
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRetake(key)}
                disabled={submitting}
                className="w-full"
              >
                <RotateCcw className="w-3 h-3 mr-1.5" />
                Retake
              </Button>
            </div>
          );
        })}
      </div>

      <Button
        onClick={onSubmit}
        disabled={submitting || !canSubmit}
        className="w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Send className="w-4 h-4 mr-2" />
            Submit for Verification
          </>
        )}
      </Button>
    </div>
  );
}
