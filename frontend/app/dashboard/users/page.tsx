"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { listUsers, type AdminUserItem } from "@/lib/dashboard-api";
import { authRequest } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Search, ShieldCheck, ShieldOff, Ban, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

const PLAN_BADGE: Record<string, string> = {
  free: "outline",
  pro: "secondary",
  enterprise: "default",
};

export default function UsersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listUsers(user!.access_token, { limit: 200 }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, string> }) =>
      authRequest(`/admin/users/${id}`, user!.access_token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function patch(id: string, data: Record<string, string>) {
    updateMutation.mutate({ id, data });
  }

  const rows = (query.data ?? []).filter((u: AdminUserItem) =>
    search
      ? u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
      : true
  );

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-muted-foreground text-sm mt-0.5">All registered users</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or email…"
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-md border">
        {query.isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground text-sm">No users found</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((u: AdminUserItem) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/dashboard/verifications?user_id=${u.id}`)}
                >
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "outline"} className="capitalize">
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={(PLAN_BADGE[u.plan] ?? "outline") as "default" | "secondary" | "outline"}
                      className="capitalize"
                    >
                      {u.plan}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === "active" ? "default" : "destructive"} className="capitalize">
                      {u.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{fmt(u.created_at)}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted">
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => patch(u.id, { role: u.role === "admin" ? "user" : "admin" })}
                        >
                          {u.role === "admin" ? (
                            <><ShieldOff className="mr-2 h-4 w-4" /> Remove admin</>
                          ) : (
                            <><ShieldCheck className="mr-2 h-4 w-4" /> Make admin</>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => patch(u.id, { plan: "free" })}
                          disabled={u.plan === "free"}
                        >
                          Set plan: free
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => patch(u.id, { plan: "pro" })}
                          disabled={u.plan === "pro"}
                        >
                          Set plan: pro
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => patch(u.id, { plan: "enterprise" })}
                          disabled={u.plan === "enterprise"}
                        >
                          Set plan: enterprise
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {u.status === "active" ? (
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => patch(u.id, { status: "suspended" })}
                          >
                            <Ban className="mr-2 h-4 w-4" /> Suspend
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => patch(u.id, { status: "active" })}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" /> Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!query.isLoading && (
        <p className="text-xs text-muted-foreground">{rows.length} user{rows.length !== 1 ? "s" : ""}</p>
      )}
    </div>
  );
}
