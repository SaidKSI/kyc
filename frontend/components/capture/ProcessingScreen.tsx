"use client";

import { useEffect, useState, useRef } from "react";
import { streamVerificationProgress, getVerificationStatus } from "@/lib/api";
import type { VerificationStatusResponse } from "@/lib/verification";
import { CheckCircle, Circle, XCircle, Loader2 } from "lucide-react";

const STEPS = [
  { key: "doc_auth",    label: "Document Authenticity" },
  { key: "ocr",        label: "Text Extraction (OCR)" },
  { key: "face_match", label: "Face Matching" },
  { key: "liveness",   label: "Liveness Check" },
  { key: "scoring",    label: "Risk Scoring" },
];

type StepStatus = "pending" | "running" | "complete" | "failed";

interface Props {
  verificationId: string;
  apiKey: string;
  onComplete: (result: VerificationStatusResponse) => void;
}

export function ProcessingScreen({ verificationId, apiKey, onComplete }: Props) {
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(
    () => Object.fromEntries(STEPS.map((s) => [s.key, "pending"]))
  );
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let done = false;
    let es: EventSource | null = null;

    const finish = (status: VerificationStatusResponse) => {
      if (done) return;
      done = true;
      es?.close();
      onCompleteRef.current(status);
    };

    const poll = async () => {
      if (done) return;
      try {
        const status = await getVerificationStatus(verificationId, apiKey);
        if (status.checks) {
          setStepStatuses((prev) => {
            const next = { ...prev };
            STEPS.forEach(({ key }) => {
              if (status.checks && key in status.checks) {
                const check = status.checks[key] as Record<string, unknown>;
                next[key] = check.error ? "failed" : "complete";
              }
            });
            return next;
          });
        }
        if (["approved", "rejected", "review", "error"].includes(status.status)) {
          finish(status);
        }
      } catch {
        // transient — ignore
      }
    };

    const pollId = setInterval(poll, 2000);

    // SSE for real-time step indicators (polling is primary)
    try {
      es = streamVerificationProgress(
        verificationId,
        apiKey,
        (data: unknown) => {
          const event = data as Record<string, unknown>;
          if (event.step && typeof event.step === "string") {
            const key = event.step as string;
            if (key !== "done" && STEPS.some((s) => s.key === key)) {
              setStepStatuses((prev) => ({
                ...prev,
                [key]: event.skipped ? "failed" : "complete",
              }));
            }
            if (key === "done") poll();
          }
        },
        () => {} // SSE errors are non-fatal — polling covers it
      );
    } catch {
      // SSE not available — polling handles it
    }

    return () => {
      done = true;
      es?.close();
      clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verificationId, apiKey]);

  const completedCount = STEPS.filter((s) => stepStatuses[s.key] !== "pending").length;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <div className="flex items-center gap-3 mb-6">
        <Loader2 className="w-6 h-6 text-zinc-400 animate-spin shrink-0" />
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">Verifying Identity</h2>
          <p className="text-zinc-500 text-sm">This usually takes 10–30 seconds</p>
        </div>
      </div>

      <div className="space-y-2">
        {STEPS.map(({ key, label }, idx) => {
          const status = stepStatuses[key];
          const isActive = idx === completedCount && status === "pending";

          return (
            <div
              key={key}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                isActive ? "bg-zinc-50" : ""
              }`}
            >
              {status === "complete" ? (
                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
              ) : status === "failed" ? (
                <XCircle className="w-5 h-5 text-red-400 shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-5 h-5 text-zinc-400 animate-spin shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-zinc-200 shrink-0" />
              )}

              <span
                className={`text-sm flex-1 ${
                  status === "complete"
                    ? "text-zinc-900 font-medium"
                    : status === "failed"
                    ? "text-red-500"
                    : isActive
                    ? "text-zinc-700"
                    : "text-zinc-400"
                }`}
              >
                {label}
              </span>

              {status === "complete" && (
                <span className="text-xs text-green-500">Done</span>
              )}
              {status === "failed" && (
                <span className="text-xs text-red-400">Skipped</span>
              )}
              {isActive && (
                <span className="text-xs text-zinc-400">Running...</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
