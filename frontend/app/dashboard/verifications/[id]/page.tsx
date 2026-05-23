"use client";

import { useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, CheckCircle2, XCircle, AlertTriangle, ExternalLink,
  FileText, Shield, User, Eye, Zap, BarChart2, ChevronDown, ChevronUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getVerification, manualDecision } from "@/lib/dashboard-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function resolveUrl(url: string): string {
  if (url.startsWith("/")) {
    return `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}${url}`;
  }
  return url;
}

// ─── Status pill ──────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { cls: string; icon?: ReactNode }> = {
  approved:   { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  rejected:   { cls: "bg-red-50 text-red-700 border-red-200",            icon: <XCircle className="h-3.5 w-3.5" /> },
  review:     { cls: "bg-amber-50 text-amber-700 border-amber-200",       icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  processing: { cls: "bg-blue-50 text-blue-700 border-blue-200",          icon: <span className="h-3 w-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin inline-block" /> },
  pending:    { cls: "bg-zinc-100 text-zinc-600 border-zinc-300" },
  error:      { cls: "bg-red-50 text-red-700 border-red-200",             icon: <XCircle className="h-3.5 w-3.5" /> },
};

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { cls: "bg-zinc-100 text-zinc-600 border-zinc-300" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg.cls}`}>
      {cfg.icon} {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Flag badges ──────────────────────────────────────────────────────────────

const CRITICAL = new Set([
  "document_expired","holder_under_16","invalid_cin_format","mrz_checksum_failed",
  "no_face_detected","decode_failed","no_match",
]);
const WARN = new Set([
  "low_liveness_confidence","low_confidence","doc_type_mismatch","face_no_match",
  "arabic_latin_mismatch","viz_mrz_mismatch","missing_fields",
]);

function FlagBadge({ flag }: { flag: string }) {
  const label = flag.replace(/_/g, " ");
  const cls = CRITICAL.has(flag)
    ? "bg-red-100 text-red-700 border-red-200"
    : WARN.has(flag)
    ? "bg-amber-100 text-amber-700 border-amber-200"
    : "bg-zinc-100 text-zinc-500 border-zinc-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {label}
    </span>
  );
}

// ─── Score gauge ──────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const s = Math.round(Math.min(100, Math.max(0, score)));
  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - s / 100);
  const color = s >= 75 ? "#10b981" : s >= 35 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative inline-flex items-center justify-center w-28 h-28">
      <svg width="112" height="112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="#e4e4e7" strokeWidth="9" />
        <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round" />
      </svg>
      <div className="absolute flex flex-col items-center leading-none">
        <span className="text-2xl font-bold" style={{ color }}>{s}</span>
        <span className="text-[10px] text-zinc-400 mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ─── Value renderer ───────────────────────────────────────────────────────────

function renderValue(value: unknown, keyHint = "", depth = 0): ReactNode {
  if (value === null || value === undefined) return <span className="text-zinc-400">—</span>;

  if (typeof value === "boolean") {
    return value
      ? <span className="inline-flex items-center gap-1 text-emerald-600 font-medium text-xs"><CheckCircle2 className="h-3.5 w-3.5" />Yes</span>
      : <span className="inline-flex items-center gap-1 text-red-500 font-medium text-xs"><XCircle className="h-3.5 w-3.5" />No</span>;
  }

  if (typeof value === "number") {
    if (Number.isInteger(value) || (value > 1 && Math.abs(value - Math.round(value)) < 0.01)) {
      return <span className="font-mono text-xs">{Math.round(value)}</span>;
    }
    if (keyHint === "distance") return <span className="font-mono text-xs">{value.toFixed(4)}</span>;
    if (value >= 0 && value <= 1) return <span className="font-mono text-xs">{(value * 100).toFixed(1)}%</span>;
    return <span className="font-mono text-xs">{value.toFixed(3)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-400 text-xs">none</span>;
    if (value.every(x => typeof x === "string")) {
      return (
        <div className="flex flex-wrap gap-1">
          {(value as string[]).map((f, i) => <FlagBadge key={i} flag={f} />)}
        </div>
      );
    }
    return (
      <div className="space-y-1">
        {value.map((item, i) => <div key={i}>{renderValue(item, "", depth + 1)}</div>)}
      </div>
    );
  }

  if (typeof value === "object") {
    if (depth >= 2) return <span className="text-zinc-400 text-xs italic">…nested</span>;
    return (
      <div className={`space-y-1 ${depth > 0 ? "pl-3 border-l border-zinc-200 mt-1" : ""}`}>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex gap-3 items-start text-xs">
            <span className="text-zinc-400 capitalize shrink-0 w-28">{k.replace(/_/g, " ")}</span>
            <div className="text-zinc-700">{renderValue(v, k, depth + 1)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "string") {
    if (value.length > 300) return <TruncatedText text={value} />;
    return <span className="font-mono text-xs break-all text-zinc-700">{value}</span>;
  }
  return <span className="text-xs text-zinc-700">{String(value)}</span>;
}

// ─── Truncated text ───────────────────────────────────────────────────────────

function TruncatedText({ text }: { text: string }) {
  const [exp, setExp] = useState(false);
  return (
    <div>
      <pre className="text-xs text-zinc-600 whitespace-pre-wrap break-all font-mono bg-zinc-50 rounded-lg p-2.5 max-h-36 overflow-y-auto leading-relaxed">
        {exp ? text : text.slice(0, 300) + (text.length > 300 ? "…" : "")}
      </pre>
      {text.length > 300 && (
        <button onClick={() => setExp(e => !e)}
          className="text-[11px] text-blue-500 hover:text-blue-700 mt-1 flex items-center gap-1">
          {exp ? <><ChevronUp className="h-3 w-3" />Show less</> : <><ChevronDown className="h-3 w-3" />Show full ({text.length.toLocaleString()} chars)</>}
        </button>
      )}
    </div>
  );
}

// ─── Check card ───────────────────────────────────────────────────────────────

function CheckCard({ icon, title, passed, confidence, skipped, children }: {
  icon: ReactNode; title: string; passed?: boolean | null;
  confidence?: number | null; skipped?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const headerCls = skipped
    ? "bg-zinc-50 border-zinc-200"
    : passed === true  ? "bg-emerald-50 border-emerald-100"
    : passed === false ? "bg-red-50 border-red-100"
    : "bg-zinc-50 border-zinc-200";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden shadow-sm">
      <button
        className={`w-full flex items-center justify-between px-4 py-3 border-b transition-colors ${headerCls}`}
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2.5">
          <span className="text-zinc-400">{icon}</span>
          <span className="font-medium text-sm text-zinc-800">{title}</span>
          {!skipped && passed === true  && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
          {!skipped && passed === false && <XCircle className="h-3.5 w-3.5 text-red-500" />}
          {skipped && <span className="text-[11px] text-zinc-400 italic">skipped</span>}
          {confidence != null && !skipped && (
            <span className="text-[11px] text-zinc-400">{(confidence * 100).toFixed(0)}%</span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
      </button>
      {open && <div className="px-4 py-4 space-y-4">{children}</div>}
    </div>
  );
}

// ─── Sub-section label ────────────────────────────────────────────────────────

function SLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">{children}</p>
  );
}

// ─── KV row ───────────────────────────────────────────────────────────────────

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 items-start py-2 border-b border-zinc-100 last:border-0">
      <span className="text-xs text-zinc-400 capitalize shrink-0 w-32">{label.replace(/_/g, " ")}</span>
      <div className="text-xs text-zinc-800 flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ─── Metric tile ──────────────────────────────────────────────────────────────

function MetricTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-50 border border-zinc-100 p-3 text-center">
      <p className="text-[11px] text-zinc-400 mb-1">{label}</p>
      <div className="font-semibold text-zinc-800">{children}</div>
    </div>
  );
}

// ─── Section renderers ────────────────────────────────────────────────────────

function OcrSection({ data }: { data: Record<string, unknown> }) {
  const {
    extracted_fields, raw_text, mrz_valid, mrz_source, mrz_fields,
    viz_mrz_cross_check, arabic_latin_name_check, validation_flags, ocr_confidence, error
  } = data;

  if (data.skipped) {
    return <p className="text-sm text-zinc-400 italic">Skipped: {String(error ?? "")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label="Confidence">
          {typeof ocr_confidence === "number" ? `${(ocr_confidence * 100).toFixed(0)}%` : "—"}
        </MetricTile>
        <MetricTile label="MRZ Valid">
          {mrz_valid === true
            ? <span className="text-emerald-600">✓ Yes</span>
            : mrz_valid === false
            ? <span className="text-red-500">✗ No</span>
            : <span className="text-zinc-400">—</span>}
        </MetricTile>
        <MetricTile label="MRZ Source">
          <span className="text-sm capitalize">{mrz_source ? String(mrz_source) : "—"}</span>
        </MetricTile>
      </div>

      {Array.isArray(validation_flags) && validation_flags.length > 0 && (
        <div>
          <SLabel>Validation Flags</SLabel>
          <div className="flex flex-wrap gap-1.5">
            {(validation_flags as string[]).map((f, i) => <FlagBadge key={i} flag={f} />)}
          </div>
        </div>
      )}

      {mrz_fields && typeof mrz_fields === "object" && Object.keys(mrz_fields as object).length > 0 && (
        <div>
          <SLabel>MRZ Fields</SLabel>
          <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {Object.entries(mrz_fields as Record<string, unknown>).map(([k, v]) => (
              <KV key={k} label={k}>{renderValue(v, k)}</KV>
            ))}
          </div>
        </div>
      )}

      {viz_mrz_cross_check && typeof viz_mrz_cross_check === "object" && (
        <div>
          <SLabel>VIZ ↔ MRZ Cross-check</SLabel>
          <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {Object.entries(viz_mrz_cross_check as Record<string, unknown>).map(([k, v]) => (
              <KV key={k} label={k}>{renderValue(v, k)}</KV>
            ))}
          </div>
        </div>
      )}

      {arabic_latin_name_check && typeof arabic_latin_name_check === "object" && (
        <div>
          <SLabel>Arabic ↔ Latin Name</SLabel>
          <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {Object.entries(arabic_latin_name_check as Record<string, unknown>).map(([k, v]) => (
              <KV key={k} label={k}>{renderValue(v, k)}</KV>
            ))}
          </div>
        </div>
      )}

      {typeof raw_text === "string" && raw_text.length > 0 && (
        <div>
          <SLabel>Raw OCR Text</SLabel>
          <TruncatedText text={raw_text} />
        </div>
      )}
    </div>
  );
}

function DocAuthSection({ data }: { data: Record<string, unknown> }) {
  const { authentic, confidence, flags, error } = data;
  if (data.skipped) return <p className="text-sm text-zinc-400 italic">Skipped: {String(error ?? "")}</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Authentic">
          {authentic === true
            ? <span className="text-emerald-600">✓ Genuine</span>
            : <span className="text-red-500">✗ Suspect</span>}
        </MetricTile>
        <MetricTile label="Confidence">
          {typeof confidence === "number" ? `${(confidence * 100).toFixed(0)}%` : "—"}
        </MetricTile>
      </div>
      {Array.isArray(flags) && flags.length > 0 && (
        <div>
          <SLabel>Flags</SLabel>
          <div className="flex flex-wrap gap-1.5">
            {(flags as string[]).map((f, i) => <FlagBadge key={i} flag={f} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function FaceMatchSection({ data }: { data: Record<string, unknown> }) {
  const { match, distance, confidence, flags, llm_opinion, error } = data;
  if (data.skipped) return <p className="text-sm text-zinc-400 italic">Skipped: {String(error ?? "")}</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label="Match">
          {match === true
            ? <span className="text-emerald-600">✓ Match</span>
            : <span className="text-red-500">✗ No match</span>}
        </MetricTile>
        <MetricTile label="Distance">
          <span className="font-mono text-sm">
            {typeof distance === "number" ? distance.toFixed(3) : "—"}
          </span>
        </MetricTile>
        <MetricTile label="Confidence">
          <span className="text-sm capitalize">
            {typeof confidence === "string" ? confidence : typeof confidence === "number" ? `${(confidence * 100).toFixed(0)}%` : "—"}
          </span>
        </MetricTile>
      </div>
      {Array.isArray(flags) && flags.length > 0 && (
        <div>
          <SLabel>Flags</SLabel>
          <div className="flex flex-wrap gap-1.5">
            {(flags as string[]).map((f, i) => <FlagBadge key={i} flag={f} />)}
          </div>
        </div>
      )}
      {llm_opinion && typeof llm_opinion === "object" && (
        <div>
          <SLabel>AI Second Opinion</SLabel>
          <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {Object.entries(llm_opinion as Record<string, unknown>).map(([k, v]) => (
              <KV key={k} label={k}>{renderValue(v, k)}</KV>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LivenessSection({ data }: { data: Record<string, unknown> }) {
  const { live, confidence, method, flags, error } = data;
  if (data.skipped) return <p className="text-sm text-zinc-400 italic">Skipped: {String(error ?? "")}</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MetricTile label="Live">
          {live === true
            ? <span className="text-emerald-600">✓ Live</span>
            : <span className="text-red-500">✗ Spoof</span>}
        </MetricTile>
        <MetricTile label="Confidence">
          {typeof confidence === "number" ? `${(confidence * 100).toFixed(0)}%` : "—"}
        </MetricTile>
        <MetricTile label="Method">
          <span className="text-sm capitalize">{typeof method === "string" ? method : "—"}</span>
        </MetricTile>
      </div>
      {Array.isArray(flags) && flags.length > 0 && (
        <div>
          <SLabel>Flags</SLabel>
          <div className="flex flex-wrap gap-1.5">
            {(flags as string[]).map((f, i) => <FlagBadge key={i} flag={f} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function LlmAnalysisSection({ data }: { data: Record<string, unknown> }) {
  const {
    doc_type_detected, doc_type_confirmed, authentic_assessment,
    confidence, flags, field_cross_check, risk_narrative, error
  } = data;
  if (data.skipped) return <p className="text-sm text-zinc-400 italic">Skipped: {String(error ?? "")}</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Doc Type Detected">
          <span className="text-sm capitalize">{typeof doc_type_detected === "string" ? doc_type_detected : "—"}</span>
        </MetricTile>
        <MetricTile label="Confirmed">
          {doc_type_confirmed === true
            ? <span className="text-emerald-600 text-sm">✓ Yes</span>
            : doc_type_confirmed === false
            ? <span className="text-red-500 text-sm">✗ No</span>
            : <span className="text-zinc-400 text-sm">—</span>}
        </MetricTile>
      </div>
      {typeof authentic_assessment === "string" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">Assessment:</span>
          <span className="text-xs font-medium text-zinc-700 capitalize">{authentic_assessment}</span>
          {typeof confidence === "number" && (
            <span className="text-xs text-zinc-400">({(confidence * 100).toFixed(0)}% confidence)</span>
          )}
        </div>
      )}
      {typeof risk_narrative === "string" && risk_narrative.length > 0 && (
        <div>
          <SLabel>Risk Narrative</SLabel>
          <p className="text-xs text-zinc-600 leading-relaxed bg-zinc-50 rounded-lg p-3 border border-zinc-100">
            {risk_narrative}
          </p>
        </div>
      )}
      {field_cross_check && typeof field_cross_check === "object" && Object.keys(field_cross_check as object).length > 0 && (
        <div>
          <SLabel>Field Cross-check</SLabel>
          <div className="rounded-lg border border-zinc-200 overflow-hidden divide-y divide-zinc-100">
            {Object.entries(field_cross_check as Record<string, unknown>).map(([k, v]) => (
              <KV key={k} label={k}>{renderValue(v, k)}</KV>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(flags) && flags.length > 0 && (
        <div>
          <SLabel>Flags</SLabel>
          <div className="flex flex-wrap gap-1.5">
            {(flags as string[]).map((f, i) => <FlagBadge key={i} flag={f} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoringSection({ data }: { data: Record<string, unknown> }) {
  const { score, decision, breakdown } = data;
  const bp = breakdown && typeof breakdown === "object" ? breakdown as Record<string, unknown> : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Score">
          <span className="text-2xl">{typeof score === "number" ? Math.round(score) : "—"}</span>
        </MetricTile>
        <MetricTile label="Decision">
          <span className="text-sm capitalize">{typeof decision === "string" ? decision : "—"}</span>
        </MetricTile>
      </div>
      {bp && Object.keys(bp).length > 0 && (
        <div>
          <SLabel>Score Breakdown</SLabel>
          <div className="space-y-2">
            {Object.entries(bp).map(([k, v]) => {
              const pct = typeof v === "number" ? Math.min(100, v > 1 ? v : v * 100) : 0;
              return (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400 capitalize w-28 shrink-0">{k.replace(/_/g, " ")}</span>
                  <div className="flex-1 bg-zinc-100 rounded-full h-1.5 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs font-mono text-zinc-500 w-10 text-right">
                    {typeof v === "number" ? (v > 1 ? Math.round(v) : `${(v * 100).toFixed(0)}%`) : String(v)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GenericCheckSection({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="divide-y divide-zinc-100">
      {Object.entries(data)
        .filter(([k]) => !["error", "skipped"].includes(k))
        .map(([k, v]) => (
          <KV key={k} label={k}>{renderValue(v, k)}</KV>
        ))}
    </div>
  );
}

// ─── Check metadata ───────────────────────────────────────────────────────────

function getCheckMeta(key: string, data: Record<string, unknown>) {
  switch (key) {
    case "ocr":          return { icon: <FileText className="h-4 w-4" />, title: "OCR Extraction",        passed: typeof data.mrz_valid === "boolean" ? data.mrz_valid : null, conf: typeof data.ocr_confidence === "number" ? data.ocr_confidence : null };
    case "doc_auth":     return { icon: <Shield className="h-4 w-4" />,   title: "Document Authenticity", passed: typeof data.authentic === "boolean" ? data.authentic : null,  conf: typeof data.confidence === "number"     ? data.confidence     : null };
    case "face_match":   return { icon: <User className="h-4 w-4" />,     title: "Face Match",            passed: typeof data.match === "boolean"     ? data.match     : null,  conf: null };
    case "liveness":     return { icon: <Eye className="h-4 w-4" />,      title: "Liveness Detection",    passed: typeof data.live === "boolean"       ? data.live      : null,  conf: typeof data.confidence === "number"     ? data.confidence     : null };
    case "llm_analysis": return { icon: <Zap className="h-4 w-4" />,      title: "AI Analysis",           passed: typeof data.doc_type_confirmed === "boolean" ? data.doc_type_confirmed : null, conf: typeof data.confidence === "number" ? data.confidence : null };
    case "scoring":      return { icon: <BarChart2 className="h-4 w-4" />, title: "Risk Scoring",         passed: data.decision === "approved" ? true : data.decision === "rejected" ? false : null, conf: null };
    default:             return { icon: <FileText className="h-4 w-4" />, title: key.replace(/_/g, " "),  passed: null, conf: null };
  }
}

function renderCheckBody(key: string, data: Record<string, unknown>): ReactNode {
  switch (key) {
    case "ocr":          return <OcrSection data={data} />;
    case "doc_auth":     return <DocAuthSection data={data} />;
    case "face_match":   return <FaceMatchSection data={data} />;
    case "liveness":     return <LivenessSection data={data} />;
    case "llm_analysis": return <LlmAnalysisSection data={data} />;
    case "scoring":      return <ScoringSection data={data} />;
    default:             return <GenericCheckSection data={data} />;
  }
}

// ─── Image card ───────────────────────────────────────────────────────────────

function ImageCard({ label, url }: { label: string; url: string }) {
  const src = resolveUrl(url);
  return (
    <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
        <h3 className="text-sm font-medium text-zinc-700">{label}</h3>
        <a href={src} target="_blank" rel="noreferrer"
          className="text-zinc-400 hover:text-zinc-700 transition-colors">
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="w-full object-cover max-h-72"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
    </div>
  );
}

// ─── Details field ────────────────────────────────────────────────────────────

function DetailsField({ label, value, mono, capitalize }: {
  label: string; value: string; mono?: boolean; capitalize?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-zinc-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm text-zinc-800 font-medium truncate ${mono ? "font-mono text-xs" : ""} ${capitalize ? "capitalize" : ""}`}>
        {value || "—"}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const CHECK_ORDER = ["doc_auth", "ocr", "face_match", "liveness", "llm_analysis", "scoring"];

export default function VerificationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const router = useRouter();
  const qc = useQueryClient();
  const [decisionDialog, setDecisionDialog] = useState<"approved" | "rejected" | null>(null);

  const query = useQuery({
    queryKey: ["verification", id],
    queryFn: () => getVerification(user!.access_token, id, isAdmin),
  });

  const decideMutation = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      manualDecision(user!.access_token, id, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["verification", id] });
      qc.invalidateQueries({ queryKey: ["verifications"] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      setDecisionDialog(null);
    },
  });

  const ver = query.data;

  if (query.isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 p-6 space-y-6">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
          </div>
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!ver) {
    return (
      <div className="p-6">
        <p className="text-zinc-500 text-sm">Verification not found.</p>
        <button onClick={() => router.back()} className="text-blue-500 text-sm mt-2 hover:underline flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      </div>
    );
  }

  const checks = ver.checks ?? {};
  const rejectionReason = checks.rejection_reason;

  // Build ordered check list (known order first, then unknown)
  const orderedChecks: [string, unknown][] = [
    ...CHECK_ORDER
      .filter(k => k in checks)
      .map(k => [k, checks[k]] as [string, unknown]),
    ...Object.entries(checks)
      .filter(([k]) => !CHECK_ORDER.includes(k) && k !== "rejection_reason"),
  ];

  return (
    <div className="min-h-screen bg-zinc-50">
      {/* Breadcrumb nav */}
      <div className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center gap-2 text-xs text-zinc-500">
        <button onClick={() => router.back()}
          className="hover:text-zinc-800 transition-colors flex items-center gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" /> Verifications
        </button>
        <span className="text-zinc-300">/</span>
        <span className="text-zinc-700 font-mono">{ver.verification_id.slice(0, 12)}…</span>
      </div>

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Hero status card */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden">
          <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center gap-6">
            {ver.score != null && (
              <div className="shrink-0 flex flex-col items-center">
                <ScoreGauge score={ver.score} />
                <p className="text-[11px] text-zinc-400 mt-1 text-center">Risk Score</p>
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <StatusPill status={ver.status} />
                {ver.score != null && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    ver.score >= 75 ? "text-emerald-700 bg-emerald-50" :
                    ver.score >= 35 ? "text-amber-700 bg-amber-50" :
                    "text-red-700 bg-red-50"
                  }`}>
                    Score {Math.round(ver.score)}
                  </span>
                )}
              </div>
              <h1 className="text-xl font-bold text-zinc-900 font-mono">{ver.reference_id}</h1>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">{ver.verification_id}</p>

              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                {[
                  ver.document_type.replace(/_/g, " "),
                  ver.locale,
                  ver.created_at ? `Created ${fmt(ver.created_at)}` : null,
                  ver.completed_at ? `Completed ${fmt(ver.completed_at)}` : null,
                ].filter(Boolean).map((item, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <span className="h-1 w-1 rounded-full bg-zinc-300 inline-block" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {isAdmin && ver.status === "review" && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300"
                  onClick={() => setDecisionDialog("rejected")}>
                  <XCircle className="h-4 w-4 mr-1.5" /> Reject
                </Button>
                <Button size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                  onClick={() => setDecisionDialog("approved")}>
                  <CheckCircle2 className="h-4 w-4 mr-1.5" /> Approve
                </Button>
              </div>
            )}
          </div>

          {rejectionReason && (
            <div className="border-t border-red-100 bg-red-50 px-6 py-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-red-700">Rejection Reason</p>
                <p className="text-xs text-red-600 mt-0.5">
                  {typeof rejectionReason === "string"
                    ? rejectionReason
                    : JSON.stringify(rejectionReason)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Content grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left — details + checks */}
          <div className="lg:col-span-2 space-y-4">
            {/* Details card */}
            <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-100">
                <h2 className="text-sm font-semibold text-zinc-700">Verification Details</h2>
              </div>
              <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-100">
                <div className="p-4 space-y-4">
                  <DetailsField label="Verification Token" value={ver.verification_id} mono />
                  <DetailsField label="Reference ID" value={ver.reference_id} mono />
                  <DetailsField label="Document Type" value={ver.document_type.replace(/_/g, " ")} capitalize />
                  {ver.locale && <DetailsField label="Locale" value={ver.locale} />}
                </div>
                <div className="p-4 space-y-4">
                  <DetailsField label="Status" value={ver.status} capitalize />
                  <DetailsField label="Decision" value={ver.decision ?? "Pending"} capitalize />
                  <DetailsField label="Created" value={ver.created_at ? fmt(ver.created_at) : "—"} />
                  <DetailsField label="Completed" value={ver.completed_at ? fmt(ver.completed_at) : "—"} />
                </div>
              </div>
            </div>

            {/* Extracted fields */}
            {ver.extracted_fields && Object.keys(ver.extracted_fields).length > 0 && (
              <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-100">
                  <h2 className="text-sm font-semibold text-zinc-700">Extracted Fields</h2>
                </div>
                <div className="divide-y divide-zinc-100">
                  {Object.entries(ver.extracted_fields).map(([k, v]) => (
                    <div key={k} className="flex gap-4 px-4 py-2.5 items-baseline">
                      <span className="text-xs text-zinc-400 capitalize shrink-0 w-40">
                        {k.replace(/_/g, " ")}
                      </span>
                      <span className="text-sm text-zinc-800 font-medium">{v || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Check results */}
            {orderedChecks.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-zinc-700 px-0.5">Check Results</h2>
                {orderedChecks.map(([key, value]) => {
                  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
                  const data = value as Record<string, unknown>;
                  const { icon, title, passed, conf } = getCheckMeta(key, data);
                  const skipped = !!data.skipped;
                  return (
                    <CheckCard key={key} icon={icon} title={title}
                      passed={skipped ? null : passed}
                      confidence={skipped ? null : conf}
                      skipped={skipped}>
                      {renderCheckBody(key, data)}
                    </CheckCard>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right — images */}
          <div className="space-y-4">
            {ver.doc_front_url && <ImageCard label="Document Front" url={ver.doc_front_url} />}
            {ver.doc_back_url  && <ImageCard label="Document Back"  url={ver.doc_back_url} />}
            {ver.selfie_url    && <ImageCard label="Selfie"         url={ver.selfie_url} />}
            {!ver.doc_front_url && !ver.selfie_url && (
              <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center">
                <p className="text-sm text-zinc-400">No images available</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm decision dialog */}
      <Dialog open={decisionDialog !== null} onOpenChange={(open) => { if (!open) setDecisionDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decisionDialog === "approved"
                ? <><CheckCircle2 className="h-5 w-5 text-emerald-500" /> Approve verification</>
                : <><AlertTriangle className="h-5 w-5 text-red-500" /> Reject verification</>}
            </DialogTitle>
            <DialogDescription>
              {decisionDialog === "approved"
                ? "Mark this verification as approved. The webhook will fire if configured."
                : "Mark this verification as rejected. The webhook will fire if configured."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionDialog(null)}>Cancel</Button>
            <Button
              variant={decisionDialog === "rejected" ? "destructive" : "default"}
              className={decisionDialog === "approved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
              disabled={decideMutation.isPending}
              onClick={() => decisionDialog && decideMutation.mutate(decisionDialog)}
            >
              {decideMutation.isPending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
