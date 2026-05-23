"use client";

import * as React from "react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import {
  getMe,
  updateMe,
  changePassword,
  getSettings,
  updateSettings,
  listKeys,
  createKey,
  regenerateKey,
  revokeKey,
  type ApiKeyCreated,
} from "@/lib/dashboard-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Copy, Check, Eye, EyeOff, Plus, Trash2, X, RotateCw } from "lucide-react";
import { toast } from "sonner";

const DOC_TYPES = [
  { value: "national_id", label: "National ID" },
  { value: "passport", label: "Passport" },
  { value: "residence_permit", label: "Residence Permit" },
  { value: "drivers_license", label: "Driver's License" },
];

// ── Schemas ──────────────────────────────────────────────────────────────
const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  webhook_url: z.string().url("Invalid URL").or(z.literal("")).optional(),
  webhook_secret: z.string().optional(),
});

const passwordSchema = z
  .object({
    current_password: z.string().min(1, "Current password required"),
    new_password: z
      .string()
      .min(8, "Password must be at least 8 characters"),
    confirm_password: z.string(),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: "Passwords don't match",
    path: ["confirm_password"],
  });

const settingsSchema = z.object({
  allowed_doc_types: z.array(z.string()).optional(),
  require_liveness: z.boolean().default(true),
  require_selfie: z.boolean().default(true),
  retention_days: z.number().min(1).max(3650).default(90),
  allowed_origins: z
    .array(z.string().url("Invalid URL"))
    .optional()
    .refine((v) => !v || v.length >= 0, "Invalid origins"),
  score_approve_threshold: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .nullable(),
  score_reject_threshold: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .nullable(),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;
type SettingsFormData = z.infer<typeof settingsSchema>;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  const currentTab = searchParams.get("tab") || "profile";

  const handleTabChange = (tab: string) => {
    router.push(`?tab=${tab}`);
  };

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

  // ── Profile form ─────────────────────────────────────────────────────────
  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: "", webhook_url: "", webhook_secret: "" },
  });

  useEffect(() => {
    if (meQuery.data) {
      profileForm.reset({
        name: meQuery.data.name,
        webhook_url: meQuery.data.webhook_url ?? "",
      });
    }
  }, [meQuery.data, profileForm]);

  const profileMutation = useMutation({
    mutationFn: (data: ProfileFormData) =>
      updateMe(user!.access_token, {
        name: data.name,
        webhook_url: data.webhook_url || undefined,
        webhook_secret: data.webhook_secret || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Password form ────────────────────────────────────────────────────────
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  const passwordMutation = useMutation({
    mutationFn: (data: PasswordFormData) =>
      changePassword(user!.access_token, {
        current_password: data.current_password,
        new_password: data.new_password,
      }),
    onSuccess: () => {
      toast.success("Password changed");
      passwordForm.reset();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Settings form ────────────────────────────────────────────────────────
  const settingsForm = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      allowed_doc_types: [],
      require_liveness: true,
      require_selfie: true,
      retention_days: 90,
      allowed_origins: [],
      score_approve_threshold: null,
      score_reject_threshold: null,
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      settingsForm.reset({
        allowed_doc_types: settingsQuery.data.allowed_doc_types ?? [],
        require_liveness: settingsQuery.data.require_liveness ?? true,
        require_selfie: settingsQuery.data.require_selfie ?? true,
        retention_days: settingsQuery.data.retention_days ?? 90,
        allowed_origins: settingsQuery.data.allowed_origins ?? [],
        score_approve_threshold:
          settingsQuery.data.score_approve_threshold ?? null,
        score_reject_threshold:
          settingsQuery.data.score_reject_threshold ?? null,
      });
    }
  }, [settingsQuery.data, settingsForm]);

  const settingsMutation = useMutation({
    mutationFn: (data: SettingsFormData) =>
      updateSettings(user!.access_token, {
        allowed_doc_types: data.allowed_doc_types,
        require_liveness: data.require_liveness,
        retention_days: data.retention_days,
        allowed_origins: data.allowed_origins,
        score_approve_threshold: data.score_approve_threshold,
        score_reject_threshold: data.score_reject_threshold,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── API key creation ──────────────────────────────────────────────────────
  const [newKeyName, setNewKeyName] = React.useState("");
  const [newKeyEnv, setNewKeyEnv] = React.useState<"sandbox" | "production">(
    "sandbox"
  );
  const [createdKey, setCreatedKey] = React.useState<ApiKeyCreated | null>(null);
  const [keyAction, setKeyAction] = React.useState<"create" | "regenerate">("create");

  const createKeyMutation = useMutation({
    mutationFn: () =>
      createKey(user!.access_token, {
        name: newKeyName,
        environment: newKeyEnv,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      setCreatedKey(data);
      setKeyAction("create");
      setNewKeyName("");
      toast.success("API key created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const regenerateKeyMutation = useMutation({
    mutationFn: (keyId: string) => regenerateKey(user!.access_token, keyId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["keys"] });
      setCreatedKey(data);
      setKeyAction("regenerate");
      toast.success("API key regenerated");
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

  const activeKeys = keysQuery.data?.filter((k) => !k.revoked_at) ?? [];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage your account and configuration
        </p>
      </div>

      <Tabs value={currentTab} onValueChange={handleTabChange}>
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
              <CardDescription>
                Update your name and webhook endpoint
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {meQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      {...profileForm.register("name")}
                    />
                    {profileForm.formState.errors.name && (
                      <p className="text-sm text-destructive">
                        {profileForm.formState.errors.name.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webhook_url">Webhook URL</Label>
                    <Input
                      id="webhook_url"
                      placeholder="https://yourapp.com/webhooks/kyc"
                      {...profileForm.register("webhook_url")}
                    />
                    {profileForm.formState.errors.webhook_url && (
                      <p className="text-sm text-destructive">
                        {profileForm.formState.errors.webhook_url.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webhook_secret">
                      Webhook Secret{" "}
                      <span className="text-muted-foreground text-xs">
                        (leave blank to keep current)
                      </span>
                    </Label>
                    <div className="relative">
                      <Input
                        id="webhook_secret"
                        type="password"
                        placeholder="New secret…"
                        {...profileForm.register("webhook_secret")}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1 h-7 w-7"
                        onClick={() => {
                          const input = document.getElementById(
                            "webhook_secret"
                          ) as HTMLInputElement;
                          input.type =
                            input.type === "password" ? "text" : "password";
                        }}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <Button
                    onClick={profileForm.handleSubmit((data) =>
                      profileMutation.mutate(data)
                    )}
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
                <Label htmlFor="current_password">Current password</Label>
                <Input
                  id="current_password"
                  type="password"
                  {...passwordForm.register("current_password")}
                />
                {passwordForm.formState.errors.current_password && (
                  <p className="text-sm text-destructive">
                    {passwordForm.formState.errors.current_password.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_password">New password</Label>
                <Input
                  id="new_password"
                  type="password"
                  {...passwordForm.register("new_password")}
                />
                {passwordForm.formState.errors.new_password && (
                  <p className="text-sm text-destructive">
                    {passwordForm.formState.errors.new_password.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm_password">Confirm password</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  {...passwordForm.register("confirm_password")}
                />
                {passwordForm.formState.errors.confirm_password && (
                  <p className="text-sm text-destructive">
                    {passwordForm.formState.errors.confirm_password.message}
                  </p>
                )}
              </div>
              <Button
                onClick={passwordForm.handleSubmit((data) =>
                  passwordMutation.mutate(data)
                )}
                disabled={passwordMutation.isPending}
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
              <CardDescription>
                Keys are shown only once on creation
              </CardDescription>
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
                  <p className="text-sm text-muted-foreground py-2">
                    No active keys
                  </p>
                )}
                {activeKeys.map((k) => (
                  <div key={k.id} className="flex items-center gap-3 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{k.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-1">
                          {k.environment}
                        </Badge>
                        Created {fmt(k.created_at)}
                        {k.last_used_at &&
                          ` · Last used ${fmt(k.last_used_at)}`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-amber-600 hover:text-amber-700"
                        title="Regenerate key"
                        onClick={() => regenerateKeyMutation.mutate(k.id)}
                        disabled={regenerateKeyMutation.isPending}
                      >
                        <RotateCw className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Revoke key"
                        onClick={() => revokeKeyMutation.mutate(k.id)}
                        disabled={revokeKeyMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Verification Settings ── */}
        <TabsContent value="verification" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Verification Settings</CardTitle>
              <CardDescription>
                Configure document types, liveness detection, data retention,
                and scoring thresholds
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {settingsQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              ) : (
                <>
                  {/* Allowed document types */}
                  <div className="space-y-3">
                    <Label>Allowed Document Types</Label>
                    <div className="space-y-2">
                      {DOC_TYPES.map((type) => (
                        <label
                          key={type.value}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            value={type.value}
                            checked={
                              settingsForm
                                .watch("allowed_doc_types")
                                ?.includes(type.value) ?? false
                            }
                            onChange={(e) => {
                              const current =
                                settingsForm.getValues("allowed_doc_types") ?? [];
                              if (e.target.checked) {
                                settingsForm.setValue("allowed_doc_types", [
                                  ...current,
                                  type.value,
                                ]);
                              } else {
                                settingsForm.setValue(
                                  "allowed_doc_types",
                                  current.filter((v) => v !== type.value)
                                );
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-sm">{type.label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to allow all types
                    </p>
                  </div>

                  <Separator />

                  {/* Require liveness */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="require_liveness">
                        Require Liveness Check
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        Selfie must pass liveness detection
                      </p>
                    </div>
                    <input
                      id="require_liveness"
                      type="checkbox"
                      checked={
                        settingsForm.watch("require_liveness") ?? true
                      }
                      onChange={(e) =>
                        settingsForm.setValue(
                          "require_liveness",
                          e.target.checked
                        )
                      }
                      className="h-4 w-4 rounded"
                    />
                  </div>

                  <Separator />

                  {/* Require selfie */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label htmlFor="require_selfie">
                        Require Selfie
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        User must submit selfie (can disable to skip this step)
                      </p>
                    </div>
                    <input
                      id="require_selfie"
                      type="checkbox"
                      checked={
                        settingsForm.watch("require_selfie") ?? true
                      }
                      onChange={(e) =>
                        settingsForm.setValue(
                          "require_selfie",
                          e.target.checked
                        )
                      }
                      className="h-4 w-4 rounded"
                    />
                  </div>

                  <Separator />

                  {/* Data retention */}
                  <div className="space-y-2">
                    <Label htmlFor="retention_days">
                      Data Retention{" "}
                      <span className="text-muted-foreground">(days)</span>
                    </Label>
                    <Input
                      id="retention_days"
                      type="number"
                      min={1}
                      max={3650}
                      {...settingsForm.register("retention_days", {
                        valueAsNumber: true,
                      })}
                      className="w-40"
                    />
                    {settingsForm.formState.errors.retention_days && (
                      <p className="text-sm text-destructive">
                        {settingsForm.formState.errors.retention_days.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Documents auto-delete after this period
                    </p>
                  </div>

                  <Separator />

                  {/* Allowed origins */}
                  <div className="space-y-3">
                    <Label>Allowed Origins (CORS)</Label>
                    <div className="space-y-2">
                      {(
                        settingsForm.watch("allowed_origins") ?? []
                      ).map((origin, idx) => (
                        <div key={idx} className="flex gap-2">
                          <Input
                            value={origin}
                            onChange={(e) => {
                              const current =
                                settingsForm.getValues("allowed_origins") ?? [];
                              current[idx] = e.target.value;
                              settingsForm.setValue("allowed_origins", current);
                            }}
                            placeholder="https://example.com"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              const current =
                                settingsForm.getValues("allowed_origins") ?? [];
                              settingsForm.setValue(
                                "allowed_origins",
                                current.filter((_, i) => i !== idx)
                              );
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const current =
                            settingsForm.getValues("allowed_origins") ?? [];
                          settingsForm.setValue("allowed_origins", [
                            ...current,
                            "",
                          ]);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add origin
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Leave empty to use global default
                    </p>
                  </div>

                  <Separator />

                  {/* Scoring thresholds */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="approve_threshold">
                        Approve Threshold{" "}
                        <span className="text-muted-foreground">(≥)</span>
                      </Label>
                      <Input
                        id="approve_threshold"
                        type="number"
                        min={0}
                        max={100}
                        placeholder="e.g. 75"
                        {...settingsForm.register(
                          "score_approve_threshold",
                          { valueAsNumber: true }
                        )}
                      />
                      {settingsForm.formState.errors
                        .score_approve_threshold && (
                        <p className="text-sm text-destructive">
                          {
                            settingsForm.formState.errors
                              .score_approve_threshold.message
                          }
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Leave empty for global default (75)
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reject_threshold">
                        Reject Threshold{" "}
                        <span className="text-muted-foreground">(≤)</span>
                      </Label>
                      <Input
                        id="reject_threshold"
                        type="number"
                        min={0}
                        max={100}
                        placeholder="e.g. 35"
                        {...settingsForm.register("score_reject_threshold", {
                          valueAsNumber: true,
                        })}
                      />
                      {settingsForm.formState.errors.score_reject_threshold && (
                        <p className="text-sm text-destructive">
                          {
                            settingsForm.formState.errors
                              .score_reject_threshold.message
                          }
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Leave empty for global default (35)
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={settingsForm.handleSubmit((data) =>
                      settingsMutation.mutate(data)
                    )}
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

      {/* Key reveal dialog (create or regenerate) */}
      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {keyAction === "regenerate" ? "API Key Regenerated" : "API Key Created"}
            </DialogTitle>
            <DialogDescription>
              Copy this key now — {keyAction === "regenerate" ? "the old key will be invalid." : "it will not be shown again."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <code className="flex-1 text-xs break-all font-mono">
              {createdKey?.raw_key}
            </code>
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
