"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { getQueue } from "@/lib/dashboard-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, ClipboardList } from "lucide-react";

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function QueuePage() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["queue"],
    queryFn: () => getQueue(user!.access_token, { limit: 100 }),
    refetchInterval: 15_000,
  });

  const items = query.data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Review Queue</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Verifications pending manual review
          </p>
        </div>
        {query.data && (
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {query.data.total} pending
          </Badge>
        )}
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <ClipboardList className="h-10 w-10 opacity-40" />
          <p className="text-sm">Queue is empty</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Card key={item.verification_id} className="overflow-hidden">
              {item.doc_front_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.doc_front_url}
                  alt="Document front"
                  className="w-full h-36 object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-mono">{item.reference_id}</CardTitle>
                    <CardDescription className="capitalize text-xs mt-0.5">
                      {item.document_type.replace(/_/g, " ")}
                    </CardDescription>
                  </div>
                  {item.score != null && (
                    <Badge variant="outline">Score: {item.score}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{fmt(item.created_at)}</p>
                <Button size="sm" nativeButton={false} render={<Link href={`/dashboard/verifications/${item.verification_id}`} />}>
                  Review <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
