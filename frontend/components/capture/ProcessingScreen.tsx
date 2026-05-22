"use client";

import { useEffect, useState, useRef } from "react";
import { streamByToken, getStatusByToken } from "@/lib/api";
import type { VerificationStatusResponse } from "@/lib/verification";
import { CheckCircle, Circle, XCircle, Loader2 } from "lucide-react";

const STEPS = [
  { key: "doc_auth",    label: "Document Authenticity" },
  { key: "ocr",        label: "Text Extraction" },
  { key: "face_match", label: "Face Matching" },
  { key: "liveness",   label: "Liveness Check" },
  { key: "scoring",    label: "Risk Scoring" },
];

type StepStatus = "pending" | "running" | "complete" | "failed";

interface Props {
  token: string;
  onComplete: (result: VerificationStatusResponse) => void;
}

export function ProcessingScreen({ token, onComplete }: Props) {
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
        const status = await getStatusByToken(token);
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
        // transient — polling continues
      }
    };

    const pollId = setInterval(poll, 2000);

    try {
      es = streamByToken(
        token,
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
      // SSE not available
    }

    return () => {
      done = true;
      es?.close();
      clearInterval(pollId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const completedCount = STEPS.filter((s) => stepStatuses[s.key] !== "pending").length;

  return (
    <div className="flex flex-col min-h-dvh bg-zinc-950 sm:min-h-0 sm:rounded-2xl sm:overflow-hidden sm:border sm:border-zinc-200 sm:shadow-sm sm:bg-white">

      {/* Header */}
      <div className="px-4 pt-12 pb-4 sm:pt-5 sm:pb-4 sm:border-b sm:border-zinc-100">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-zinc-400 animate-spin shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-white sm:text-zinc-900">Verifying Identity</h2>
            <p className="text-xs text-zinc-400 sm:text-zinc-500 mt-0.5">This usually takes 10–30 seconds</p>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="flex-1 px-4 py-4">
        <div className="space-y-1">
          {STEPS.map(({ key, label }, idx) => {
            const status = stepStatuses[key];
            const isActive = idx === completedCount && status === "pending";

            return (
              <div
                key={key}
                className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  isActive ? "bg-zinc-900 sm:bg-zinc-50" : ""
                }`}
              >
                {status === "complete" ? (
                  <CheckCircle className="w-5 h-5 text-green-400 sm:text-green-500 shrink-0" />
                ) : status === "failed" ? (
                  <XCircle className="w-5 h-5 text-red-400 shrink-0" />
                ) : isActive ? (
                  <Loader2 className="w-5 h-5 text-zinc-400 animate-spin shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-zinc-700 sm:text-zinc-200 shrink-0" />
                )}

                <span
                  className={`text-sm flex-1 ${
                    status === "complete"
                      ? "text-white sm:text-zinc-900 font-medium"
                      : status === "failed"
                      ? "text-red-400"
                      : isActive
                      ? "text-zinc-200 sm:text-zinc-700"
                      : "text-zinc-600 sm:text-zinc-400"
                  }`}
                >
                  {label}
                </span>

                {status === "complete" && (
                  <span className="text-xs text-green-400 sm:text-green-500">Done</span>
                )}
                {status === "failed" && (
                  <span className="text-xs text-red-400">Skipped</span>
                )}
                {isActive && (
                  <span className="text-xs text-zinc-500">Running...</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
