"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  getMe,
  updateMe,
  changePassword,
  getSettings,
  updateSettings,
  listKeys,
  createKey,
  revokeKey,
  type ApiKeyCreated,
} from "@/lib/dashboard-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Check, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export default function SettingsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(user!.access_token),
  });
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => getSettings(user!.access_token),
  });
  const keysQuery = useQuery({
    queryKey: ["keys"],
    queryFn: () => listKeys(user!.access_token),
  });

  // ── Profile form ─────────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (meQuery.data) {
      setName(meQuery.data.name);
      setWebhookUrl(meQuery.data.webhook_url ?? "");
    }
  }, [meQuery.data]);

  const profileMutation = useMutation({
    mutationFn: () =>
      updateMe(user!.access_token, {
        name,
        webhook_url: webhookUrl || undefined,
        webhook_secret: webhookSecret || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Password form ─────────────────────────────────────────────────────────────
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");

  const passwordMutation = useMutation({
    mutationFn: () =>
      changePassword(user!.access_token, {
        current_password: currentPwd,
        new_password: newPwd,
      }),
    onSuccess: () => {
      toast.success("Password changed");
      setCurrentPwd("");
      setNewPwd("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── API key creation ──────────────────────────────────────────────────────────
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"sandbox" | "production">("sandbox");
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);

  const createKeyMutation = useMutation({
    mutationFn: () =>
      createKey(user!.access_token, { name: newKeyName, environment: newKeyEnv }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      setCreatedKey(data);
      setNewKeyName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (keyId: string) => revokeKey(user!.access_token, keyId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      toast.success("API key revoked");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Verification settings ────────────────────────────────────────────────────
  const [approveThreshold, setApproveThreshold] = useState<string>("");
  const [rejectThreshold, setRejectThreshold] = useState<string>("");
  const [retentionDays, setRetentionDays] = useState<string>("90");

  useEffect(() => {
    if (settingsQuery.data) {
      setApproveThreshold(String(settingsQuery.data.score_approve_threshold ?? ""));
      setRejectThreshold(String(settingsQuery.data.score_reject_threshold ?? ""));
      setRetentionDays(String(settingsQuery.data.retention_days));
    }
  }, [settingsQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: () =>
      updateSettings(user!.access_token, {
        score_approve_threshold: approveThreshold ? parseInt(approveThreshold) : undefined,
        score_reject_threshold: rejectThreshold ? parseInt(rejectThreshold) : undefined,
        retention_days: parseInt(retentionDays) || 90,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeKeys = keysQuery.data?.filter((k) => !k.revoked_at) ?? [];
  const revokedKeys = keysQuery.data?.filter((k) => k.revoked_at) ?? [];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Manage your account and configuration</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="keys">API Keys</TabsTrigger>
          <TabsTrigger value="verification">Verification</TabsTrigger>
        </TabsList>

        {/* ── Profile ── */}
        <TabsContent value="profile" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Update your name and webhook endpoint</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {meQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Webhook URL</Label>
                    <Input
                      placeholder="https://yourapp.com/webhooks/kyc"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Webhook Secret <span className="text-muted-foreground text-xs">(leave blank to keep current)</span></Label>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        placeholder="New secret…"
                        value={webhookSecret}
                        onChange={(e) => setWebhookSecret(e.target.value)}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7"
                        onClick={() => setShowSecret((s) => !s)}
                      >
                        {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  <Button
                    onClick={() => profileMutation.mutate()}
                    disabled={profileMutation.isPending}
                  >
                    {profileMutation.isPending ? "Saving…" : "Save changes"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Change Password</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Current password</Label>
                <Input
                  type="password"
                  value={currentPwd}
                  onChange={(e) => setCurrentPwd(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>New password</Label>
                <Input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                />
              </div>
              <Button
                onClick={() => passwordMutation.mutate()}
                disabled={passwordMutation.isPending || !currentPwd || newPwd.length < 8}
              >
                {passwordMutation.isPending ? "Updating…" : "Update password"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── API Keys ── */}
        <TabsContent value="keys" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Create API Key</CardTitle>
              <CardDescription>Keys are shown only once on creation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 flex-wrap">
                <Input
                  placeholder="Key name (e.g. Production)"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  className="flex-1 min-w-[180px]"
                />
                <div className="flex gap-2">
                  {(["sandbox", "production"] as const).map((env) => (
                    <Button
                      key={env}
                      variant={newKeyEnv === env ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNewKeyEnv(env)}
                      className="capitalize"
                    >
                      {env}
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={() => createKeyMutation.mutate()}
                  disabled={createKeyMutation.isPending || !newKeyName}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create
                </Button>
              </div>
            </CardContent>
          </Card>

          {keysQuery.isLoading ? (
            <Skeleton className="h-48" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Active Keys</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {activeKeys.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">No active keys</p>
                )}
                {activeKeys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{k.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-1">{k.environment}</Badge>
                        Created {fmt(k.created_at)}
                        {k.last_used_at && ` · Last used ${fmt(k.last_used_at)}`}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => revokeKeyMutation.mutate(k.id)}
                      disabled={revokeKeyMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {revokedKeys.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-muted-foreground text-sm">Revoked Keys</CardTitle>
              </CardHeader>
              <CardContent className="divide-y">
                {revokedKeys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3 py-3 opacity-50">
                    <div className="flex-1">
                      <p className="text-sm line-through">{k.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Revoked {k.revoked_at ? fmt(k.revoked_at) : ""}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Verification Settings ── */}
        <TabsContent value="verification" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Verification Settings</CardTitle>
              <CardDescription>
                Scores 0–100. Verifications above approve threshold auto-approve; below reject threshold auto-reject; between goes to review queue.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {settingsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Approve threshold <span className="text-muted-foreground">(≥)</span></Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="e.g. 75"
                        value={approveThreshold}
                        onChange={(e) => setApproveThreshold(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Reject threshold <span className="text-muted-foreground">(≤)</span></Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        placeholder="e.g. 35"
                        value={rejectThreshold}
                        onChange={(e) => setRejectThreshold(e.target.value)}
                      />
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Data retention <span className="text-muted-foreground">(days)</span></Label>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={retentionDays}
                      onChange={(e) => setRetentionDays(e.target.value)}
                      className="w-40"
                    />
                  </div>
                  <Button
                    onClick={() => settingsMutation.mutate()}
                    disabled={settingsMutation.isPending}
                  >
                    {settingsMutation.isPending ? "Saving…" : "Save settings"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New key reveal dialog */}
      <Dialog open={createdKey !== null} onOpenChange={(open) => { if (!open) setCreatedKey(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy this key now — it will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <code className="flex-1 text-xs break-all font-mono">{createdKey?.raw_key}</code>
            {createdKey && <CopyButton text={createdKey.raw_key} />}
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
