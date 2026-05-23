"use client";

import { useParams } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { getSessionInfo, uploadDocumentByToken, submitByToken } from "@/lib/api";
import type { SessionInfoResponse, VerificationStatusResponse } from "@/lib/verification";
import { DOCUMENT_REQUIRES_BACK } from "@/lib/verification";
import { CameraCapture, type CapturedImage } from "@/components/capture/CameraCapture";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { ProcessingScreen } from "@/components/capture/ProcessingScreen";
import { ResultScreen } from "@/components/capture/ResultScreen";
import { Loader2, AlertCircle } from "lucide-react";

type Step =
  | "loading"
  | "error"
  | "capture_front"
  | "capture_back"
  | "capture_selfie"
  | "review"
  | "submitting"
  | "processing"
  | "result";

interface Images {
  front?: CapturedImage;
  back?: CapturedImage;
  selfie?: CapturedImage;
}

export default function VerifyTokenPage() {
  const { token } = useParams<{ token: string }>();
  const [step, setStep] = useState<Step>("loading");
  const [session, setSession] = useState<SessionInfoResponse | null>(null);
  const [images, setImages] = useState<Images>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationStatusResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    getSessionInfo(token)
      .then((info) => {
        setSession(info);
        if (["approved", "rejected", "review", "error"].includes(info.status)) {
          setResult({
            verification_id: info.verification_id,
            status: info.status,
            score: null,
            decision: null,
            extracted_fields: null,
            checks: null,
            completed_at: null,
          });
          setStep("result");
        } else if (info.status === "processing") {
          setStep("processing");
        } else {
          setStep("capture_front");
        }
      })
      .catch((err) => {
        setErrorMsg(err instanceof Error ? err.message : "Session not found or expired");
        setStep("error");
      });
  }, [token]);

  const handleCapture = useCallback(
    (slot: "front" | "back" | "selfie", img: CapturedImage) => {
      setImages((prev) => ({ ...prev, [slot]: img }));
      if (slot === "front") {
        const needsBack = session && DOCUMENT_REQUIRES_BACK[session.document_type];
        setStep(needsBack ? "capture_back" : session?.require_selfie ? "capture_selfie" : "review");
      } else if (slot === "back") {
        setStep(session?.require_selfie ? "capture_selfie" : "review");
      } else {
        setStep("review");
      }
    },
    [session]
  );

  const handleRetake = useCallback((slot: "front" | "back" | "selfie") => {
    setImages((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    setSubmitError(null);
    if (slot === "front") {
      setStep("capture_front");
    } else if (slot === "back") {
      setStep("capture_back");
    } else {
      setStep("capture_selfie");
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const selfieRequired = session?.require_selfie ?? true;
    if (!images.front || (selfieRequired && !images.selfie)) return;
    setStep("submitting");
    setSubmitError(null);
    try {
      await uploadDocumentByToken(token, "doc_front", images.front.file);
      if (images.back) {
        await uploadDocumentByToken(token, "doc_back", images.back.file);
      }
      if (images.selfie) {
        await uploadDocumentByToken(token, "selfie", images.selfie.file);
      }
      await submitByToken(token);
      setStep("processing");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Upload failed. Please try again.");
      setStep("review");
    }
  }, [token, images, session?.require_selfie]);

  if (step === "loading") {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-zinc-400 animate-spin" />
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="min-h-dvh bg-zinc-950 flex items-center justify-center p-6">
        <div className="text-center max-w-xs">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-white font-semibold text-lg mb-2">Session Invalid</h2>
          <p className="text-zinc-400 text-sm">{errorMsg}</p>
        </div>
      </div>
    );
  }

  const wrapperClass =
    "min-h-dvh sm:min-h-0 sm:flex sm:items-center sm:justify-center sm:p-4 sm:bg-zinc-100";
  const cardClass = "w-full sm:max-w-sm";

  if (step === "capture_front") {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <CameraCapture
            key="capture_front"
            label="Document Front"
            hint="Place the front of your ID within the frame"
            overlayShape="rect"
            facingMode="environment"
            onCapture={(img) => handleCapture("front", img)}
          />
        </div>
      </div>
    );
  }

  if (step === "capture_back") {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <CameraCapture
            key="capture_back"
            label="Document Back"
            hint="Flip your ID and capture the back"
            overlayShape="rect"
            facingMode="environment"
            onCapture={(img) => handleCapture("back", img)}
            onBack={() => setStep("capture_front")}
          />
        </div>
      </div>
    );
  }

  if (step === "capture_selfie") {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <CameraCapture
            key="capture_selfie"
            label="Selfie"
            hint="Look straight at the camera and blink once"
            overlayShape="oval"
            facingMode="user"
            onCapture={(img) => handleCapture("selfie", img)}
            onBack={() => {
              const needsBack = session && DOCUMENT_REQUIRES_BACK[session.document_type];
              setStep(needsBack ? "capture_back" : "capture_front");
            }}
          />
        </div>
      </div>
    );
  }

  if (step === "review" || step === "submitting") {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <ReviewScreen
            images={images}
            documentType={session!.document_type}
            onRetake={handleRetake}
            onSubmit={handleSubmit}
            submitting={step === "submitting"}
            error={submitError ?? undefined}
            requireSelfie={session?.require_selfie ?? true}
          />
        </div>
      </div>
    );
  }

  if (step === "processing") {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <ProcessingScreen
            token={token}
            onComplete={(res) => {
              setResult(res);
              setStep("result");
            }}
          />
        </div>
      </div>
    );
  }

  if (step === "result" && result) {
    return (
      <div className={wrapperClass}>
        <div className={cardClass}>
          <ResultScreen result={result} redirectUrl={session?.redirect_url ?? null} />
        </div>
      </div>
    );
  }

  return null;
}
