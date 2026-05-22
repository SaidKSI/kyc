"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, AlertCircle, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getVerification, manualDecision } from "@/lib/dashboard-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  rejected: "destructive",
  review: "secondary",
  processing: "outline",
  pending: "outline",
  error: "destructive",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function CheckResult({ label, data }: { label: string; data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <p className="text-sm font-medium capitalize">{label.replace(/_/g, " ")}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {Object.entries(obj)
          .filter(([k]) => k !== "error")
          .map(([k, v]) => (
            <div key={k} className="contents">
              <span className="text-xs text-muted-foreground capitalize">
                {k.replace(/_/g, " ")}
              </span>
              <span className="text-xs font-mono">
                {typeof v === "boolean"
                  ? v ? "✓" : "✗"
                  : typeof v === "number"
                  ? v.toFixed(3)
                  : String(v ?? "—")}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

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
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (!ver) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Verification not found.</p>
        <Button variant="link" className="p-0 mt-2" nativeButton={false} render={<Link href="/dashboard/verifications" />}>
          ← Back
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold font-mono">{ver.reference_id}</h1>
            <Badge variant={STATUS_BADGE[ver.status] ?? "outline"}>{ver.status}</Badge>
            {ver.score != null && (
              <Badge variant="outline">Score: {ver.score}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{ver.verification_id}</p>
        </div>
        {isAdmin && ver.status === "review" && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDecisionDialog("rejected")}
            >
              <XCircle className="h-4 w-4 mr-1" /> Reject
            </Button>
            <Button
              size="sm"
              onClick={() => setDecisionDialog("approved")}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left col */}
        <div className="lg:col-span-2 space-y-4">
          {/* Details */}
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <Field label="Document type" value={ver.document_type.replace(/_/g, " ")} capitalize />
              <Field label="Locale" value={ver.locale} />
              <Field label="Decision" value={ver.decision ?? "—"} capitalize />
              <Field label="Created" value={ver.created_at ? fmt(ver.created_at) : "—"} />
              <Field label="Completed" value={ver.completed_at ? fmt(ver.completed_at) : "—"} />
            </CardContent>
          </Card>

          {/* Extracted fields */}
          {ver.extracted_fields && Object.keys(ver.extracted_fields).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Extracted Fields</CardTitle></CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                {Object.entries(ver.extracted_fields).map(([k, v]) => (
                  <Field key={k} label={k.replace(/_/g, " ")} value={String(v)} capitalize={false} />
                ))}
              </CardContent>
            </Card>
          )}

          {/* ML checks */}
          {ver.checks && Object.keys(ver.checks).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Check Results</CardTitle></CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3">
                {Object.entries(ver.checks).map(([k, v]) => (
                  <CheckResult key={k} label={k} data={v} />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right col — images */}
        <div className="space-y-4">
          {ver.doc_front_url && (
            <ImageCard label="Document Front" url={ver.doc_front_url} />
          )}
          {ver.doc_back_url && (
            <ImageCard label="Document Back" url={ver.doc_back_url} />
          )}
          {ver.selfie_url && (
            <ImageCard label="Selfie" url={ver.selfie_url} />
          )}
          {!ver.doc_front_url && !ver.selfie_url && (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                No images available
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Confirm decision dialog */}
      <Dialog
        open={decisionDialog !== null}
        onOpenChange={(open) => { if (!open) setDecisionDialog(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {decisionDialog === "approved" ? (
                <><CheckCircle2 className="h-5 w-5 text-emerald-500" /> Approve verification</>
              ) : (
                <><AlertCircle className="h-5 w-5 text-destructive" /> Reject verification</>
              )}
            </DialogTitle>
            <DialogDescription>
              {decisionDialog === "approved"
                ? "Mark this verification as approved. The webhook will be triggered."
                : "Mark this verification as rejected. The webhook will be triggered."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecisionDialog(null)}>
              Cancel
            </Button>
            <Button
              variant={decisionDialog === "rejected" ? "destructive" : "default"}
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

function Field({ label, value, capitalize = true }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground capitalize">{label}</p>
      <p className={`font-medium mt-0.5 ${capitalize ? "capitalize" : ""}`}>{value}</p>
    </div>
  );
}

function ImageCard({ label, url }: { label: string; url: string }) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">{label}</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="w-full rounded-b-lg object-cover max-h-64"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </CardContent>
    </Card>
  );
}
