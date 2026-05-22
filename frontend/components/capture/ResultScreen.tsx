"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle, Clock, XCircle, AlertTriangle, ExternalLink } from "lucide-react";
import type { VerificationStatusResponse, VerificationStatus } from "@/lib/verification";

interface Props {
  result: VerificationStatusResponse;
  redirectUrl?: string | null;
}

const STATUS_CONFIG: Record<
  VerificationStatus,
  {
    icon: React.ElementType;
    iconColor: string;
    iconBg: string;
    title: string;
    subtitle: string;
  }
> = {
  approved: {
    icon: CheckCircle,
    iconColor: "text-green-400 sm:text-green-500",
    iconBg: "bg-green-950/40 sm:bg-green-50 sm:border sm:border-green-200",
    title: "Verified",
    subtitle: "Your identity has been successfully verified.",
  },
  review: {
    icon: Clock,
    iconColor: "text-amber-400 sm:text-amber-500",
    iconBg: "bg-amber-950/40 sm:bg-amber-50 sm:border sm:border-amber-200",
    title: "Under Review",
    subtitle: "Your verification requires manual review. We'll be in touch.",
  },
  rejected: {
    icon: XCircle,
    iconColor: "text-red-400 sm:text-red-500",
    iconBg: "bg-red-950/40 sm:bg-red-50 sm:border sm:border-red-200",
    title: "Not Verified",
    subtitle: "We could not verify your identity at this time.",
  },
  error: {
    icon: AlertTriangle,
    iconColor: "text-zinc-400",
    iconBg: "bg-zinc-900 sm:bg-zinc-50 sm:border sm:border-zinc-200",
    title: "Error",
    subtitle: "Something went wrong. Please try again.",
  },
  pending: {
    icon: Clock,
    iconColor: "text-zinc-400",
    iconBg: "bg-zinc-900 sm:bg-zinc-50 sm:border sm:border-zinc-200",
    title: "Pending",
    subtitle: "",
  },
  processing: {
    icon: Clock,
    iconColor: "text-zinc-400",
    iconBg: "bg-zinc-900 sm:bg-zinc-50 sm:border sm:border-zinc-200",
    title: "Processing",
    subtitle: "",
  },
};

const TERMINAL = new Set(["approved", "rejected", "review", "error"]);

export function ResultScreen({ result, redirectUrl }: Props) {
  const { status, score, extracted_fields } = result;
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.error;
  const Icon = cfg.icon;
  const isTerminal = TERMINAL.has(status);

  const fieldEntries = extracted_fields
    ? Object.entries(extracted_fields).filter(([, v]) => v != null && v !== "")
    : [];

  // Auto-redirect on approved if operator supplied a redirect_url
  useEffect(() => {
    if (redirectUrl && status === "approved") {
      const t = setTimeout(() => { window.location.href = redirectUrl; }, 3000);
      return () => clearTimeout(t);
    }
  }, [redirectUrl, status]);

  return (
    <div className="flex flex-col min-h-dvh bg-zinc-950 sm:min-h-0 sm:rounded-2xl sm:overflow-hidden sm:border sm:border-zinc-200 sm:shadow-sm sm:bg-white">

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className={`inline-flex p-5 rounded-full ${cfg.iconBg} mb-6`}>
          <Icon className={`w-12 h-12 ${cfg.iconColor}`} />
        </div>

        <h2 className="text-2xl font-bold text-white sm:text-zinc-900 mb-2">{cfg.title}</h2>
        <p className="text-zinc-400 sm:text-zinc-500 text-sm mb-6 max-w-xs">{cfg.subtitle}</p>

        {score != null && (
          <div className="mb-5 inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 sm:bg-zinc-50 rounded-full border border-zinc-800 sm:border-zinc-200">
            <span className="text-zinc-400 sm:text-zinc-500 text-sm">Risk Score</span>
            <span className="font-bold text-white sm:text-zinc-900">{score}/100</span>
          </div>
        )}

        {fieldEntries.length > 0 && status === "approved" && (
          <div className="w-full text-left rounded-xl bg-zinc-900 sm:bg-zinc-50 border border-zinc-800 sm:border-zinc-200 divide-y divide-zinc-800 sm:divide-zinc-200 overflow-hidden">
            {fieldEntries.map(([key, value]) => (
              <div key={key} className="flex justify-between items-center px-4 py-2.5">
                <span className="text-xs text-zinc-500 uppercase tracking-wide">
                  {key.replace(/_/g, " ")}
                </span>
                <span className="text-sm font-medium text-white sm:text-zinc-900 text-right max-w-[60%] break-words">
                  {String(value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {redirectUrl && status === "approved" && (
          <p className="text-xs text-zinc-500 mt-4">Redirecting you automatically…</p>
        )}
      </div>

      {/* Bottom action */}
      {redirectUrl && isTerminal && (
        <div className="px-4 py-5 pb-8 sm:pb-5 sm:border-t sm:border-zinc-100 bg-zinc-950 sm:bg-white">
          <Button
            onClick={() => { window.location.href = redirectUrl; }}
            className="w-full h-14 sm:h-11 text-base sm:text-sm bg-white text-zinc-900 hover:bg-zinc-100 sm:bg-zinc-900 sm:text-white sm:hover:bg-zinc-700"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
