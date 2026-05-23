"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { listVerifications } from "@/lib/dashboard-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search } from "lucide-react";

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  rejected: "destructive",
  review: "secondary",
  processing: "outline",
  pending: "outline",
  error: "destructive",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function VerificationsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["verifications", statusFilter, isAdmin],
    queryFn: () =>
      listVerifications(user!.access_token, {
        status: statusFilter === "all" ? undefined : statusFilter,
        limit: 200,
        admin: isAdmin,
      }),
  });

  const rows = (query.data ?? []).filter((v) =>
    search
      ? v.reference_id.toLowerCase().includes(search.toLowerCase()) ||
        v.verification_id.toLowerCase().includes(search.toLowerCase())
      : true
  );

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Verifications</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {isAdmin ? "All verifications across the platform" : "Your verifications"}
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by reference ID…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="review">Review</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        {query.isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">
            No verifications found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((v) => (
                <TableRow
                  key={v.verification_id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => router.push(`/dashboard/verifications/${v.verification_id}`)}
                >
                  <TableCell className="font-mono text-xs">{v.reference_id}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {v.verification_id.slice(0, 8)}...
                  </TableCell>
                  <TableCell className="capitalize">
                    {v.document_type.replace(/_/g, " ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[v.status] ?? "outline"}>
                      {v.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {v.score != null ? v.score : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {fmt(v.created_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {v.completed_at ? fmt(v.completed_at) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!query.isLoading && (
        <p className="text-xs text-muted-foreground">{rows.length} result{rows.length !== 1 ? "s" : ""}</p>
      )}
    </div>
  );
}
