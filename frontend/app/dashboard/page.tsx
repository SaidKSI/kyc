"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getAdminStats, listVerifications } from "@/lib/dashboard-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  review: { label: "Review", variant: "secondary" },
  processing: { label: "Processing", variant: "outline" },
  pending: { label: "Pending", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_BADGE[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getAdminStats(user!.access_token),
    enabled: isAdmin,
  });

  const verQuery = useQuery({
    queryKey: ["verifications", "recent"],
    queryFn: () =>
      listVerifications(user!.access_token, {
        limit: 10,
        admin: isAdmin,
      }),
  });

  const vers = verQuery.data ?? [];
  const stats = statsQuery.data;

  const userStats = !isAdmin
    ? {
        total: vers.length,
        approved: vers.filter((v) => v.status === "approved").length,
        rejected: vers.filter((v) => v.status === "rejected").length,
        review: vers.filter((v) => v.status === "review").length,
      }
    : null;

  const total = isAdmin ? (stats?.total_verifications ?? 0) : (userStats?.total ?? 0);
  const approved = isAdmin ? (stats?.by_status.approved ?? 0) : (userStats?.approved ?? 0);
  const rejected = isAdmin ? (stats?.by_status.rejected ?? 0) : (userStats?.rejected ?? 0);
  const review = isAdmin ? (stats?.by_status.review ?? 0) : (userStats?.review ?? 0);
  const approvalRate = isAdmin && stats ? stats.approval_rate : (approved + rejected > 0 ? approved / (approved + rejected) : 0);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          {isAdmin ? "Platform-wide verification stats" : "Your verification stats"}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total"
          value={total}
          icon={<FileText className="h-4 w-4 text-muted-foreground" />}
          loading={isAdmin ? statsQuery.isLoading : verQuery.isLoading}
        />
        <StatCard
          title="Approved"
          value={approved}
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          loading={isAdmin ? statsQuery.isLoading : verQuery.isLoading}
        />
        <StatCard
          title="Rejected"
          value={rejected}
          icon={<XCircle className="h-4 w-4 text-destructive" />}
          loading={isAdmin ? statsQuery.isLoading : verQuery.isLoading}
        />
        <StatCard
          title="Approval Rate"
          value={`${(approvalRate * 100).toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4 text-primary" />}
          loading={isAdmin ? statsQuery.isLoading : verQuery.isLoading}
          subtitle={`${review} in review`}
        />
      </div>

      {/* Recent verifications */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Verifications</CardTitle>
            <CardDescription>Last {vers.length} verifications</CardDescription>
          </div>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/dashboard/verifications" />}>
            View all <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {verQuery.isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : vers.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              No verifications yet
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vers.map((v) => (
                  <TableRow
                    key={v.verification_id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() =>
                      (location.href = `/dashboard/verifications/${v.verification_id}`)
                    }
                  >
                    <TableCell className="font-mono text-xs">{v.reference_id}</TableCell>
                    <TableCell className="capitalize">
                      {v.document_type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={v.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {v.score != null ? v.score : "—"}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">
                      {fmt(v.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Admin avg score */}
      {isAdmin && stats?.avg_score != null && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Average Score</p>
                <p className="text-3xl font-bold">{stats.avg_score}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-3xl font-bold">{stats.total_users}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  loading,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  loading?: boolean;
  subtitle?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <p className="text-2xl font-bold">{value}</p>
        )}
        {subtitle && !loading && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );
}
