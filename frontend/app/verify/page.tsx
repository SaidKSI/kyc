"use client";

// Dev / operator testing tool.
// In production, operators call POST /v1/verify from their backend and
// send the returned verify_url directly to their end-user.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createVerification } from "@/lib/api";
import type { DocumentType } from "@/lib/verification";
import { DOCUMENT_TYPE_LABELS } from "@/lib/verification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const DOC_TYPES: DocumentType[] = [
  "national_id",
  "passport",
  "residence_permit",
  "drivers_license",
];

export default function DevVerifyPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [docType, setDocType] = useState<DocumentType>("national_id");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await createVerification(
        {
          reference_id: referenceId.trim() || `user_${Date.now()}`,
          document_type: docType,
          locale: "ar-MA",
          redirect_url: redirectUrl.trim() || undefined,
        },
        apiKey
      );
      router.push(`/verify/${res.session_token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zinc-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-zinc-200 p-7 shadow-sm">
        <p className="text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1 inline-block mb-4">
          Dev tool — operator use only
        </p>
        <h1 className="text-xl font-semibold text-zinc-900 mb-1">Create Verification</h1>
        <p className="text-zinc-500 text-sm mb-5">
          Simulates an operator backend creating a session and redirecting the user.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="apiKey">API Key</Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="kyc_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="refId">Reference ID <span className="text-zinc-400 font-normal">(optional)</span></Label>
            <Input
              id="refId"
              placeholder="user_123"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="redirectUrl">Redirect URL <span className="text-zinc-400 font-normal">(optional)</span></Label>
            <Input
              id="redirectUrl"
              placeholder="https://yourapp.com/kyc-complete"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="docType">Document Type</Label>
            <select
              id="docType"
              value={docType}
              onChange={(e) => setDocType(e.target.value as DocumentType)}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <Button type="submit" className="w-full h-11" disabled={loading}>
            {loading ? "Creating..." : "Create & Start Verification"}
          </Button>
        </form>
      </div>
    </div>
  );
}
