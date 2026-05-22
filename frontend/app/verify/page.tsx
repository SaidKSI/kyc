"use client";

import { useState, useCallback } from "react";
import { DocTypeSelector } from "@/components/capture/DocTypeSelector";
import { CameraCapture, type CapturedImage } from "@/components/capture/CameraCapture";
import { ReviewScreen } from "@/components/capture/ReviewScreen";
import { ProcessingScreen } from "@/components/capture/ProcessingScreen";
import { ResultScreen } from "@/components/capture/ResultScreen";
import {
  createVerification,
  uploadDocument,
  submitVerification,
} from "@/lib/api";
import type { DocumentType, VerificationStatusResponse } from "@/lib/verification";
import { DOCUMENT_REQUIRES_BACK } from "@/lib/verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Step =
  | "setup"
  | "select_type"
  | "capture_front"
  | "capture_back"
  | "capture_selfie"
  | "review"
  | "submitting"
  | "processing"
  | "result";

interface CapturedImages {
  front?: CapturedImage;
  back?: CapturedImage;
  selfie?: CapturedImage;
}

export default function VerifyPage() {
  const [step, setStep] = useState<Step>("setup");
  const [apiKey, setApiKey] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>("national_id");
  const [images, setImages] = useState<CapturedImages>({});
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [result, setResult] = useState<VerificationStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSetup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setStep("select_type");
  };

  const handleDocTypeSelect = useCallback(
    async (docType: DocumentType) => {
      setDocumentType(docType);
      setError(null);
      try {
        const res = await createVerification(
          {
            reference_id: referenceId.trim() || `user_${Date.now()}`,
            document_type: docType,
            locale: "ar-MA",
          },
          apiKey
        );
        setVerificationId(res.verification_id);
        setStep("capture_front");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to create verification"
        );
      }
    },
    [apiKey, referenceId]
  );

  const handleCapture = useCallback(
    (slot: "front" | "back" | "selfie", img: CapturedImage) => {
      setImages((prev) => ({ ...prev, [slot]: img }));
      if (slot === "front") {
        setStep(DOCUMENT_REQUIRES_BACK[documentType] ? "capture_back" : "capture_selfie");
      } else if (slot === "back") {
        setStep("capture_selfie");
      } else {
        setStep("review");
      }
    },
    [documentType]
  );

  const handleRetake = useCallback((slot: "front" | "back" | "selfie") => {
    setImages((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
    if (slot === "front") setStep("capture_front");
    else if (slot === "back") setStep("capture_back");
    else setStep("capture_selfie");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!verificationId) return;
    setStep("submitting");
    setError(null);
    try {
      if (images.front)
        await uploadDocument(verificationId, "doc_front", images.front.file, apiKey);
      if (images.back)
        await uploadDocument(verificationId, "doc_back", images.back.file, apiKey);
      if (images.selfie)
        await uploadDocument(verificationId, "selfie", images.selfie.file, apiKey);
      await submitVerification(verificationId, apiKey);
      setStep("processing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setStep("review");
    }
  }, [verificationId, images, apiKey]);

  const handleResult = useCallback((res: VerificationStatusResponse) => {
    setResult(res);
    setStep("result");
  }, []);

  const handleRestart = () => {
    setStep("setup");
    setApiKey("");
    setReferenceId("");
    setImages({});
    setVerificationId(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {step === "setup" && (
          <SetupForm
            apiKey={apiKey}
            referenceId={referenceId}
            onApiKeyChange={setApiKey}
            onReferenceIdChange={setReferenceId}
            onSubmit={handleSetup}
          />
        )}

        {step === "select_type" && (
          <DocTypeSelector
            onSelect={handleDocTypeSelect}
            error={error ?? undefined}
          />
        )}

        {step === "capture_front" && (
          <CameraCapture
            label="Document Front"
            hint="Place the front of your document flat in good lighting"
            overlayShape="rect"
            facingMode="environment"
            onCapture={(img) => handleCapture("front", img)}
          />
        )}

        {step === "capture_back" && (
          <CameraCapture
            label="Document Back"
            hint="Flip your document over"
            overlayShape="rect"
            facingMode="environment"
            onCapture={(img) => handleCapture("back", img)}
          />
        )}

        {step === "capture_selfie" && (
          <CameraCapture
            label="Selfie"
            hint="Look directly at the camera with good, even lighting"
            overlayShape="oval"
            facingMode="user"
            onCapture={(img) => handleCapture("selfie", img)}
          />
        )}

        {(step === "review" || step === "submitting") && (
          <ReviewScreen
            images={images}
            documentType={documentType}
            onRetake={handleRetake}
            onSubmit={handleSubmit}
            submitting={step === "submitting"}
            error={error ?? undefined}
          />
        )}

        {step === "processing" && verificationId && (
          <ProcessingScreen
            verificationId={verificationId}
            apiKey={apiKey}
            onComplete={handleResult}
          />
        )}

        {step === "result" && result && (
          <ResultScreen result={result} onRestart={handleRestart} />
        )}
      </div>
    </div>
  );
}

function SetupForm({
  apiKey,
  referenceId,
  onApiKeyChange,
  onReferenceIdChange,
  onSubmit,
}: {
  apiKey: string;
  referenceId: string;
  onApiKeyChange: (v: string) => void;
  onReferenceIdChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">KYC Verification</h1>
      <p className="text-zinc-500 text-sm mb-6">
        Enter your operator API key to begin identity verification
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="apiKey">API Key</Label>
          <Input
            id="apiKey"
            type="password"
            placeholder="kyc_..."
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            required
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="refId">
            Reference ID{" "}
            <span className="text-zinc-400 font-normal">(optional)</span>
          </Label>
          <Input
            id="refId"
            placeholder="user_123"
            value={referenceId}
            onChange={(e) => onReferenceIdChange(e.target.value)}
            className="mt-1"
          />
        </div>
        <Button type="submit" className="w-full mt-2">
          Start Verification
        </Button>
      </form>
    </div>
  );
}
