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
  requireSelfie?: boolean;
}

export function ReviewScreen({ images, documentType, onRetake, onSubmit, submitting, error, requireSelfie = true }: Props) {
  const slots: { key: "front" | "back" | "selfie"; label: string }[] = [
    { key: "front", label: "Document Front" },
    ...(images.back ? [{ key: "back" as const, label: "Document Back" }] : []),
    ...(requireSelfie ? [{ key: "selfie" as const, label: "Selfie" }] : []),
  ];

  const canSubmit = !!images.front && (requireSelfie ? !!images.selfie : true);

  return (
    <div className="flex flex-col min-h-dvh bg-zinc-950 sm:min-h-0 sm:rounded-2xl sm:overflow-hidden sm:border sm:border-zinc-200 sm:shadow-sm sm:bg-white">

      {/* Header */}
      <div className="px-4 pt-12 pb-4 sm:pt-5 sm:pb-4">
        <h2 className="text-base font-semibold text-white sm:text-zinc-900">Review Your Photos</h2>
        <p className="text-xs text-zinc-400 sm:text-zinc-500 mt-0.5">
          {DOCUMENT_TYPE_LABELS[documentType]} — confirm all images are clear
        </p>
      </div>

      {/* Image grid */}
      <div className="flex-1 px-4 py-4 overflow-y-auto">
        {error && (
          <div className="mb-4 p-3 bg-red-950/80 border border-red-800 rounded-lg text-red-200 text-sm sm:bg-red-50 sm:border-red-200 sm:text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          {slots.map(({ key, label }) => {
            const img = images[key];
            return (
              <div key={key} className="flex flex-col gap-2">
                <span className="text-xs font-medium text-zinc-400 sm:text-zinc-500 uppercase tracking-wide">
                  {label}
                </span>
                <div className="relative rounded-xl overflow-hidden aspect-[4/3] bg-zinc-800 sm:bg-zinc-100">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img.dataUrl} alt={label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600 sm:text-zinc-300 text-xs">
                      Not captured
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRetake(key)}
                  disabled={submitting}
                  className="w-full text-zinc-400 hover:text-white sm:text-zinc-600 sm:hover:text-zinc-900 hover:bg-zinc-800 sm:hover:bg-zinc-50"
                >
                  <RotateCcw className="w-3 h-3 mr-1.5" />
                  Retake
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Submit */}
      <div className="px-4 py-5 pb-8 sm:pb-5 bg-transparent">
        <Button
          onClick={onSubmit}
          disabled={submitting || !canSubmit}
          className="w-full h-14 sm:h-11 text-base sm:text-sm bg-white text-zinc-900 hover:bg-zinc-100 sm:bg-zinc-900 sm:text-white sm:hover:bg-zinc-700"
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
    </div>
  );
}
