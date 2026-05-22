"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle, Clock, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import type { VerificationStatusResponse, VerificationStatus } from "@/lib/verification";

interface Props {
  result: VerificationStatusResponse;
  onRestart: () => void;
}

const STATUS_CONFIG: Record<
  VerificationStatus,
  {
    icon: React.ElementType;
    color: string;
    bg: string;
    border: string;
    title: string;
    subtitle: string;
  }
> = {
  approved: {
    icon: CheckCircle,
    color: "text-green-500",
    bg: "bg-green-50",
    border: "border-green-200",
    title: "Verified",
    subtitle: "Identity successfully verified.",
  },
  review: {
    icon: Clock,
    color: "text-amber-500",
    bg: "bg-amber-50",
    border: "border-amber-200",
    title: "Under Review",
    subtitle: "Your verification requires manual review. We'll be in touch.",
  },
  rejected: {
    icon: XCircle,
    color: "text-red-500",
    bg: "bg-red-50",
    border: "border-red-200",
    title: "Not Verified",
    subtitle: "We could not verify your identity at this time.",
  },
  error: {
    icon: AlertTriangle,
    color: "text-zinc-500",
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    title: "Error",
    subtitle: "Something went wrong. Please try again.",
  },
  pending: {
    icon: Clock,
    color: "text-zinc-400",
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    title: "Pending",
    subtitle: "",
  },
  processing: {
    icon: Clock,
    color: "text-zinc-400",
    bg: "bg-zinc-50",
    border: "border-zinc-200",
    title: "Processing",
    subtitle: "",
  },
};

export function ResultScreen({ result, onRestart }: Props) {
  const { status, score, extracted_fields } = result;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.error;
  const Icon = cfg.icon;

  const fieldEntries = extracted_fields
    ? Object.entries(extracted_fields).filter(([, v]) => v != null && v !== "")
    : [];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8 text-center">
      <div
        className={`inline-flex p-4 rounded-full ${cfg.bg} border ${cfg.border} mb-5`}
      >
        <Icon className={`w-10 h-10 ${cfg.color}`} />
      </div>

      <h2 className="text-2xl font-bold text-zinc-900 mb-1">{cfg.title}</h2>
      <p className="text-zinc-500 text-sm mb-6">{cfg.subtitle}</p>

      {score != null && (
        <div className="mb-5 inline-flex items-center gap-2 px-4 py-2 bg-zinc-50 rounded-full border border-zinc-200">
          <span className="text-zinc-500 text-sm">Risk Score</span>
          <span className="font-bold text-zinc-900">{score}/100</span>
        </div>
      )}

      {fieldEntries.length > 0 && status === "approved" && (
        <div className="text-left mb-6 rounded-xl bg-zinc-50 border border-zinc-200 divide-y divide-zinc-200 overflow-hidden">
          {fieldEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between items-center px-4 py-2.5">
              <span className="text-xs text-zinc-500 uppercase tracking-wide">
                {key.replace(/_/g, " ")}
              </span>
              <span className="text-sm font-medium text-zinc-900 text-right max-w-[60%] break-words">
                {String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" onClick={onRestart} className="w-full">
        <RotateCcw className="w-4 h-4 mr-2" />
        Start New Verification
      </Button>
    </div>
  );
}
