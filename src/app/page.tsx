"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  RefreshCw,
  Mail,
  ArrowLeftRight,
  Wallet,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  DollarSign,
  Cpu,
  FolderOpen,
  Ban,
  Loader2,
  ExternalLink,
  Pause,
  Play,
  Shuffle,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

interface JobProgress {
  id: string;
  type: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  informationalItems: number;
  transactionsCreated: number;
  errorMessage: string | null;
  modelId?: string | null;
  modelName?: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface Stats {
  emails: {
    total: number;
    pending: number;
    completed: number;
    failed: number;
    skipped: number;
    informational: number;
  };
  transactions: {
    total: number;
    byType: Record<string, number>;
  };
  accounts: {
    total: number;
  };
}

interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  description: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  available: boolean;
  recommended?: boolean;
}

interface CostEstimate {
  totalEmails: number;
  estimatedCost: number;
  costPerEmail: number;
  formattedCost: string;
}

interface EmailSet {
  id: string;
  name: string;
  description: string | null;
  emailCount: number;
  createdAt: string;
}

interface EligibilityCheck {
  eligible: boolean;
  reason?: string;
  message: string;
  emailCount?: number;
  softwareVersion: string;
  existingRun?: {
    id: string;
    completedAt: string;
    transactionsCreated: number;
  };
}

interface RecentRun {
  id: string;
  setId: string;
  setName: string | null;
  modelId: string;
  modelName: string | null;
  promptId: string;
  promptName: string | null;
  version: number;
  name: string | null;
  status: string;
  emailsProcessed: number;
  transactionsCreated: number;
  informationalCount: number;
  errorCount: number;
  startedAt: Date;
  completedAt: Date | null;
  canResume?: boolean;
  emailsRemaining?: number;
  totalEmailsInSet?: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeJobs, setActiveJobs] = useState<JobProgress[]>([]);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Model selection state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [costEstimates, setCostEstimates] = useState<Record<string, CostEstimate>>({});

  // Prompt selection state
  const [prompts, setPrompts] = useState<Array<{ id: string; name: string; description: string | null; isDefault: boolean }>>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");

  // Set selection state
  const [emailSets, setEmailSets] = useState<EmailSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("");
  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);

  // Cancellation state
  const [jobToCancel, setJobToCancel] = useState<JobProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Sample size state for small extraction runs
  const [sampleSize, setSampleSize] = useState<string>("");

  const fetchStats = useCallback(async () => {
    try {
      const [emailsRes, transactionsRes, accountsRes] = await Promise.all([
        fetch("/api/emails?limit=1"),
        fetch("/api/transactions?limit=1"),
        fetch("/api/accounts"),
      ]);

      // Safely parse JSON responses with proper typing
      let emailsData: {
        pagination?: { total: number };
        statusCounts?: Record<string, number>;
      } = { pagination: { total: 0 }, statusCounts: {} };
      let transactionsData: {
        pagination?: { total: number };
        typeCounts?: Record<string, number>;
      } = { pagination: { total: 0 }, typeCounts: {} };
      let accountsData: { accounts?: unknown[] } = { accounts: [] };

      try {
        emailsData = await emailsRes.json();
      } catch (e) {
        console.error("Failed to parse emails response:", e);
      }

      try {
        transactionsData = await transactionsRes.json();
      } catch (e) {
        console.error("Failed to parse transactions response:", e);
      }

      try {
        accountsData = await accountsRes.json();
      } catch (e) {
        console.error("Failed to parse accounts response:", e);
      }

      setStats({
        emails: {
          total: emailsData.pagination?.total || 0,
          pending: emailsData.statusCounts?.pending || 0,
          completed: emailsData.statusCounts?.completed || 0,
          failed: emailsData.statusCounts?.failed || 0,
          skipped: emailsData.statusCounts?.skipped || 0,
          informational: emailsData.statusCounts?.informational || 0,
        },
        transactions: {
          total: transactionsData.pagination?.total || 0,
          byType: transactionsData.typeCounts || {},
        },
        accounts: {
          total: accountsData.accounts?.length || 0,
        },
      });
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchActiveJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs?active=true");
      const data = await res.json();
      // Ensure transactionsCreated has a default value
      const jobs = (data.jobs || []).map((job: JobProgress) => ({
        ...job,
        transactionsCreated: job.transactionsCreated ?? 0,
      }));
      setActiveJobs(jobs);
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    }
  }, []);

  const fetchRecentRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/runs/recent");
      const data = await res.json();
      setRecentRuns(data.runs || []);
    } catch (error) {
      console.error("Failed to fetch recent runs:", error);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      // Fetch models with cost estimates for pending emails
      const res = await fetch("/api/models");
      const data = await res.json();

      setModels(data.models || []);
      setCostEstimates(data.costEstimates || {});

      // Set default model if not already set
      if (!selectedModelId && data.defaultModelId) {
        setSelectedModelId(data.defaultModelId);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    }
  }, [selectedModelId]);

  const fetchEmailSets = useCallback(async () => {
    try {
      const res = await fetch("/api/email-sets");
      const data = await res.json();
      setEmailSets(data.sets || []);
    } catch (error) {
      console.error("Failed to fetch email sets:", error);
    }
  }, []);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch("/api/prompts");
      const data = await res.json();
      setPrompts(data.prompts || []);

      // Auto-select default prompt if available
      if (data.defaultPromptId && !selectedPromptId) {
        setSelectedPromptId(data.defaultPromptId);
      }
    } catch (error) {
      console.error("Failed to fetch prompts:", error);
    }
  }, [selectedPromptId]);

  const checkEligibility = useCallback(async (setId: string, modelId: string, promptId: string) => {
    if (!setId || !modelId || !promptId) {
      setEligibility(null);
      return;
    }

    setCheckingEligibility(true);
    try {
      const res = await fetch(`/api/extraction-check?setId=${setId}&modelId=${modelId}&promptId=${promptId}`);
      const data = await res.json();
      setEligibility(data);
    } catch (error) {
      console.error("Failed to check eligibility:", error);
      setEligibility(null);
    } finally {
      setCheckingEligibility(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchActiveJobs();
    fetchRecentRuns();
    fetchModels();
    fetchEmailSets();
    fetchPrompts();

    // Poll for active jobs and recent runs
    const interval = setInterval(() => {
      fetchActiveJobs();
      fetchRecentRuns();
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchStats, fetchActiveJobs, fetchRecentRuns, fetchModels, fetchEmailSets, fetchPrompts]);

  // Auto-select set if there's only one
  useEffect(() => {
    if (emailSets.length === 1 && !selectedSetId) {
      setSelectedSetId(emailSets[0].id);
    }
  }, [emailSets, selectedSetId]);

  // Check eligibility when set, model, or prompt changes
  useEffect(() => {
    checkEligibility(selectedSetId, selectedModelId, selectedPromptId);
  }, [selectedSetId, selectedModelId, selectedPromptId, checkEligibility]);

  const startExtractionJob = async () => {
    if (!selectedSetId || !selectedModelId || !selectedPromptId) {
      toast.error("Please select a set, model, and prompt");
      return;
    }

    try {
      const parsedSampleSize = sampleSize ? parseInt(sampleSize) : undefined;
      const model = models.find((m) => m.id === selectedModelId);
      const set = emailSets.find((s) => s.id === selectedSetId);
      const prompt = prompts.find((p) => p.id === selectedPromptId);
      const sampleInfo = parsedSampleSize && parsedSampleSize > 0
        ? ` (random sample of ${parsedSampleSize})`
        : "";

      // Use Inngest for background job processing
      const res = await fetch("/api/jobs/inngest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setId: selectedSetId,
          modelId: selectedModelId,
          promptId: selectedPromptId,
          concurrency: 3,
          sampleSize: parsedSampleSize && parsedSampleSize > 0 ? parsedSampleSize : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to start extraction");
        return;
      }

      toast.success(`${data.message} - "${set?.name}"${sampleInfo} with ${model?.name || selectedModelId}`);
      setSampleSize(""); // Clear sample size after starting

      // Refresh runs list - job will appear there when it starts
      fetchRecentRuns();
      checkEligibility(selectedSetId, selectedModelId, selectedPromptId);
    } catch (error) {
      console.error("Start extraction error:", error);
      toast.error("Failed to start extraction job");
    }
  };

  const handleCancelJob = async () => {
    if (!jobToCancel) return;

    setIsCancelling(true);
    try {
      const res = await fetch(`/api/jobs/${jobToCancel.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: "Cancelled by user from dashboard",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to cancel job");
        return;
      }

      toast.success(
        data.transactionsDeleted
          ? "Job cancelled and all transactions deleted"
          : "Job cancelled"
      );

      // Refresh active jobs
      fetchActiveJobs();

      // Close dialog
      setJobToCancel(null);
    } catch (error) {
      toast.error("Failed to cancel job");
    } finally {
      setIsCancelling(false);
    }
  };

  const handlePauseJob = async (job: JobProgress) => {
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pause" }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to pause job");
        return;
      }

      toast.success("Job paused");
      fetchActiveJobs();
    } catch (error) {
      toast.error("Failed to pause job");
    }
  };

  const handleResumeJob = async (job: JobProgress) => {
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume" }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to resume job");
        return;
      }

      toast.success("Job resumed");
      fetchActiveJobs();
    } catch (error) {
      toast.error("Failed to resume job");
    }
  };

  // Resume a failed extraction run
  const handleResumeRun = async (run: RecentRun) => {
    try {
      toast.info(`Resuming run v${run.version}...`);

      // Use the streaming endpoint with resumeRunId
      const res = await fetch("/api/jobs/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "extraction",
          options: {
            resumeRunId: run.id,
            concurrency: 3,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const data = JSON.parse(text);
          toast.error(data.error || "Failed to resume run");
        } catch {
          toast.error("Failed to resume run");
        }
        return;
      }

      toast.success(`Resuming run v${run.version} - ${run.emailsRemaining} emails remaining`);

      // Track the streaming job locally
      let streamingJobId: string | null = null;

      // Process the SSE stream
      const reader = res.body?.getReader();
      if (!reader) {
        toast.error("Failed to read extraction stream");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const event = JSON.parse(line.slice(6));

                switch (event.type) {
                  case "started":
                    streamingJobId = event.jobId;
                    setActiveJobs((prev) => [
                      ...prev,
                      {
                        id: event.jobId,
                        type: "extraction",
                        status: "running",
                        totalItems: event.totalItems,
                        processedItems: 0,
                        failedItems: 0,
                        skippedItems: 0,
                        informationalItems: 0,
                        transactionsCreated: 0,
                        errorMessage: null,
                        modelId: event.modelId,
                        modelName: event.modelName,
                        startedAt: new Date().toISOString(),
                        completedAt: null,
                      },
                    ]);
                    // Remove from recent runs since it's now active
                    setRecentRuns((prev) => prev.filter((r) => r.id !== run.id));
                    break;

                  case "progress":
                    if (streamingJobId) {
                      setActiveJobs((prev) =>
                        prev.map((job) =>
                          job.id === streamingJobId
                            ? {
                                ...job,
                                processedItems: event.processedItems,
                                failedItems: event.failedItems,
                                informationalItems: event.informationalItems,
                                totalItems: event.totalItems,
                              }
                            : job
                        )
                      );
                    }
                    break;

                  case "batch_committed":
                    if (streamingJobId) {
                      setActiveJobs((prev) =>
                        prev.map((job) =>
                          job.id === streamingJobId
                            ? {
                                ...job,
                                transactionsCreated: event.totalTransactionsCommitted,
                              }
                            : job
                        )
                      );
                    }
                    break;

                  case "completed":
                    toast.success(
                      `Run v${run.version} resumed and completed! ${event.transactionsCreated} total transactions from ${event.emailsProcessed} emails`
                    );
                    if (streamingJobId) {
                      setActiveJobs((prev) =>
                        prev.filter((job) => job.id !== streamingJobId)
                      );
                    }
                    fetchRecentRuns();
                    break;

                  case "error":
                    toast.error(`Resume failed: ${event.error}`);
                    if (streamingJobId) {
                      setActiveJobs((prev) =>
                        prev.filter((job) => job.id !== streamingJobId)
                      );
                    }
                    fetchRecentRuns();
                    break;

                  case "done":
                    break;
                }
              } catch (e) {
                console.error("Failed to parse SSE event:", line, e);
              }
            }
          }
        }
      } catch (streamError) {
        console.error("Stream error:", streamError);
        toast.error("Resume stream interrupted");
        if (streamingJobId) {
          setActiveJobs((prev) =>
            prev.filter((job) => job.id !== streamingJobId)
          );
        }
        fetchRecentRuns();
      }
    } catch (error) {
      console.error("Resume run error:", error);
      toast.error("Failed to resume run");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />;
      case "paused":
        return <Pause className="h-4 w-4 text-orange-500" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Extract and consolidate financial transactions from email notifications
          </p>
        </div>

        {/* Quick Actions */}
        <Card className="mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-5 w-5" />
              Start Extraction
            </CardTitle>
            <CardDescription>
              Select an email set and AI model to extract transactions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Selectors Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Set Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  <FolderOpen className="h-4 w-4" />
                  Email Set
                </label>
                <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a set" />
                  </SelectTrigger>
                  <SelectContent>
                    {emailSets.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-gray-500 text-center">
                        No sets created yet
                      </div>
                    ) : (
                      emailSets.map((set) => (
                        <SelectItem key={set.id} value={set.id}>
                          <div className="flex items-center gap-2">
                            <span>{set.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {set.emailCount} emails
                            </Badge>
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* Model Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">AI Model</label>
                <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Anthropic Models */}
                    <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50">
                      Anthropic (Claude)
                    </div>
                    {models
                      .filter((m) => m.provider === "anthropic")
                      .map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.id}
                          disabled={!model.available}
                        >
                          <div className="flex items-center gap-2">
                            <span>{model.name}</span>
                            {model.recommended && (
                              <Badge variant="secondary" className="text-xs">Recommended</Badge>
                            )}
                            {!model.available && (
                              <Badge variant="outline" className="text-xs text-orange-600">No API key</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    {/* OpenAI Models */}
                    <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 mt-1">
                      OpenAI (GPT)
                    </div>
                    {models
                      .filter((m) => m.provider === "openai")
                      .map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.id}
                          disabled={!model.available}
                        >
                          <div className="flex items-center gap-2">
                            <span>{model.name}</span>
                            {!model.available && (
                              <Badge variant="outline" className="text-xs text-orange-600">No API key</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    {/* Google Models */}
                    <div className="px-2 py-1 text-xs font-semibold text-gray-500 bg-gray-50 mt-1">
                      Google (Gemini)
                    </div>
                    {models
                      .filter((m) => m.provider === "google")
                      .map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.id}
                          disabled={!model.available}
                        >
                          <div className="flex items-center gap-2">
                            <span>{model.name}</span>
                            {!model.available && (
                              <Badge variant="outline" className="text-xs text-orange-600">No API key</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {/* Model description */}
                {selectedModelId && (
                  <p className="text-xs text-gray-500">
                    {models.find((m) => m.id === selectedModelId)?.description}
                  </p>
                )}
              </div>

              {/* Prompt Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Extraction Prompt</label>
                <Select value={selectedPromptId} onValueChange={setSelectedPromptId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a prompt" />
                  </SelectTrigger>
                  <SelectContent>
                    {prompts.length === 0 ? (
                      <div className="px-2 py-3 text-sm text-gray-500 text-center">
                        No prompts available
                      </div>
                    ) : (
                      prompts.map((prompt) => (
                        <SelectItem key={prompt.id} value={prompt.id}>
                          <div className="flex items-center gap-2">
                            <span>{prompt.name}</span>
                            {prompt.isDefault && (
                              <Badge variant="secondary" className="text-xs">Default</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {/* Prompt description */}
                {selectedPromptId && (
                  <p className="text-xs text-gray-500">
                    {prompts.find((p) => p.id === selectedPromptId)?.description}
                  </p>
                )}
              </div>

              {/* Sample Size (optional) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  <Shuffle className="h-4 w-4" />
                  Sample Size
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <Input
                  type="number"
                  placeholder={selectedSetId
                    ? `All ${emailSets.find(s => s.id === selectedSetId)?.emailCount || 0} emails`
                    : "Leave empty for all"
                  }
                  value={sampleSize}
                  onChange={(e) => setSampleSize(e.target.value)}
                  min={1}
                  max={selectedSetId ? emailSets.find(s => s.id === selectedSetId)?.emailCount : undefined}
                />
                <p className="text-xs text-gray-500">
                  {sampleSize && parseInt(sampleSize) > 0
                    ? `Randomly select ${sampleSize} emails from the set`
                    : "Process all emails in the set"
                  }
                </p>
              </div>
            </div>

            {/* Status and Actions Row */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Start Button */}
              <Button
                onClick={startExtractionJob}
                className="gap-2"
                disabled={
                  !selectedSetId ||
                  !selectedModelId ||
                  checkingEligibility ||
                  !eligibility?.eligible
                }
              >
                <RefreshCw className="h-4 w-4" />
                Extract Transactions
                {eligibility?.eligible && eligibility.emailCount && (
                  <Badge variant="secondary">
                    {sampleSize && parseInt(sampleSize) > 0
                      ? `${sampleSize} of ${eligibility.emailCount}`
                      : `${eligibility.emailCount} emails`
                    }
                  </Badge>
                )}
              </Button>

              {/* Refresh Button */}
              <Button variant="outline" onClick={() => { fetchStats(); fetchModels(); fetchEmailSets(); fetchPrompts(); if (selectedSetId && selectedModelId && selectedPromptId) checkEligibility(selectedSetId, selectedModelId, selectedPromptId); }} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Eligibility Status */}
              {checkingEligibility && (
                <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg border border-gray-200">
                  <Loader2 className="h-4 w-4 text-gray-500 animate-spin" />
                  <span className="text-sm text-gray-600">Checking...</span>
                </div>
              )}

              {!checkingEligibility && eligibility && !eligibility.eligible && (
                <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
                  <Ban className="h-4 w-4 text-amber-600" />
                  <div className="text-sm">
                    <span className="font-medium text-amber-800">
                      {eligibility.reason === "no_emails" ? "No Emails" : "Not Available"}
                    </span>
                  </div>
                </div>
              )}

              {!checkingEligibility && eligibility?.eligible && costEstimates[selectedModelId] && (
                <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-800">
                    Est: {costEstimates[selectedModelId].formattedCost}
                  </span>
                </div>
              )}
            </div>

            {/* Version Info */}
            {eligibility?.softwareVersion && (
              <div className="mt-3 text-xs text-gray-400">
                Software version: {eligibility.softwareVersion}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Jobs */}
        {activeJobs.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Active Jobs
            </h2>
            <div className="space-y-4">
              {activeJobs.map((job) => (
                <Link key={job.id} href={`/jobs/${job.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(job.status)}
                          <span className="font-medium capitalize">
                            {job.type.replace("_", " ")}
                          </span>
                          <Badge
                            variant={
                              job.status === "running"
                                ? "default"
                                : job.status === "completed"
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {job.status}
                          </Badge>
                          {job.modelName && (
                            <Badge variant="outline" className="text-xs font-mono">
                              {job.modelName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-sm text-gray-500">
                            {job.processedItems} / {job.totalItems} items
                            {job.transactionsCreated > 0 && (
                              <span className="text-green-600 ml-2 font-medium">
                                ({job.transactionsCreated} tx saved)
                              </span>
                            )}
                            {job.informationalItems > 0 && (
                              <span className="text-blue-500 ml-2">
                                ({job.informationalItems} info)
                              </span>
                            )}
                            {job.failedItems > 0 && (
                              <span className="text-red-500 ml-2">
                                ({job.failedItems} failed)
                              </span>
                            )}
                            {job.skippedItems > 0 && (
                              <span className="text-yellow-500 ml-2">
                                ({job.skippedItems} skipped)
                              </span>
                            )}
                          </div>
                          {job.status === "running" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handlePauseJob(job);
                                }}
                                title="Pause job"
                              >
                                <Pause className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setJobToCancel(job);
                                }}
                                title="Cancel job"
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {job.status === "paused" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleResumeJob(job);
                              }}
                              title="Resume job"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                          <ExternalLink className="h-4 w-4 text-gray-400" />
                        </div>
                      </div>
                      <Progress
                        value={
                          job.totalItems > 0
                            ? (job.processedItems / job.totalItems) * 100
                            : 0
                        }
                        className="h-2"
                      />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Runs */}
        {recentRuns.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Recent Runs
            </h2>
            <div className="space-y-4">
              {recentRuns.map((run) => (
                <Card key={run.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between mb-2">
                      <Link href={`/runs/${run.id}`} className="flex items-center gap-2 flex-1">
                        <Badge variant="secondary">v{run.version}</Badge>
                        <span className="font-medium">
                          {run.name || run.setName || "Untitled Run"}
                        </span>
                        {run.status === "failed" && (
                          <Badge variant="destructive">Failed</Badge>
                        )}
                        {run.status === "completed" && (
                          <Badge variant="outline" className="text-green-600 border-green-200">
                            Completed
                          </Badge>
                        )}
                      </Link>
                      <div className="flex items-center gap-3">
                        {run.status === "failed" && run.canResume && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1 text-blue-600 border-blue-200 hover:bg-blue-50"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleResumeRun(run);
                            }}
                          >
                            <RotateCcw className="h-4 w-4" />
                            Resume ({run.emailsRemaining} remaining)
                          </Button>
                        )}
                        <div className="text-sm text-gray-500">
                          {run.completedAt && new Date(run.completedAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <Link href={`/runs/${run.id}`}>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-gray-500">Model</div>
                          <div className="font-medium">{run.modelName || run.modelId}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Prompt</div>
                          <div className="font-medium truncate">{run.promptName || "Default"}</div>
                        </div>
                        <div>
                          <div className="text-gray-500">Processed</div>
                          <div className="font-medium">
                            {run.emailsProcessed} emails
                            {run.status === "failed" && run.totalEmailsInSet && (
                              <span className="text-gray-400"> / {run.totalEmailsInSet}</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="text-gray-500">Extracted</div>
                          <div className="font-medium text-green-600">{run.transactionsCreated} transactions</div>
                        </div>
                      </div>
                      {(run.informationalCount > 0 || run.errorCount > 0) && (
                        <div className="flex gap-4 mt-2 text-sm">
                          {run.informationalCount > 0 && (
                            <span className="text-blue-500">
                              {run.informationalCount} informational
                            </span>
                          )}
                          {run.errorCount > 0 && (
                            <span className="text-red-500">
                              {run.errorCount} errors
                            </span>
                          )}
                        </div>
                      )}
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Emails</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? "..." : stats?.emails.total || 0}
              </div>
              <div className="flex flex-wrap gap-2 mt-2 text-xs">
                <Badge variant="secondary">
                  {stats?.emails.completed || 0} processed
                </Badge>
                <Badge variant="outline">
                  {stats?.emails.pending || 0} pending
                </Badge>
                {(stats?.emails.informational || 0) > 0 && (
                  <Badge variant="outline" className="text-blue-600">
                    {stats?.emails.informational} info
                  </Badge>
                )}
                {(stats?.emails.failed || 0) > 0 && (
                  <Badge variant="destructive">{stats?.emails.failed} failed</Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Transactions</CardTitle>
              <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? "..." : stats?.transactions.total || 0}
              </div>
              <div className="flex flex-wrap gap-1 mt-2 text-xs">
                {stats?.transactions.byType &&
                  Object.entries(stats.transactions.byType)
                    .slice(0, 4)
                    .map(([type, count]) => (
                      <Badge key={type} variant="outline" className="text-xs">
                        {type}: {count}
                      </Badge>
                    ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Accounts</CardTitle>
              <Wallet className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? "..." : stats?.accounts.total || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Detected from transactions
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Transaction Types Summary */}
        {stats?.transactions.byType &&
          Object.keys(stats.transactions.byType).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Transaction Types</CardTitle>
                <CardDescription>
                  Breakdown of extracted transactions by type
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Object.entries(stats.transactions.byType).map(
                    ([type, count]) => (
                      <div
                        key={type}
                        className="p-4 bg-gray-50 rounded-lg text-center"
                      >
                        <div className="text-2xl font-bold text-gray-900">
                          {count}
                        </div>
                        <div className="text-sm text-gray-600 capitalize">
                          {type.replace(/_/g, " ")}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>
          )}

        {/* Getting Started */}
        {(!stats || stats.emails.total === 0) && !loading && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
              <CardDescription>
                Follow these steps to extract transactions from your emails
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal list-inside space-y-2 text-gray-600">
                <li>
                  Go to the <strong>Emails</strong> page and upload your .eml or .zip files
                </li>
                <li>
                  Click <strong>Extract Transactions</strong> to process emails
                  with AI
                </li>
                <li>
                  Review extracted transactions and consolidate accounts
                </li>
              </ol>
            </CardContent>
          </Card>
        )}

        {/* Cancellation Confirmation Dialog */}
        <Dialog open={!!jobToCancel} onOpenChange={(open) => !open && setJobToCancel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Extraction Job?</DialogTitle>
            <DialogDescription>
              This will stop the extraction job and <strong>delete all transactions</strong> that have been created during this run.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {jobToCancel && (
            <div className="py-4 space-y-2">
              <div className="text-sm">
                <span className="text-gray-600">Job ID:</span>{" "}
                <span className="font-mono text-xs">{jobToCancel.id}</span>
              </div>
              <div className="text-sm">
                <span className="text-gray-600">Progress:</span>{" "}
                <span>{jobToCancel.processedItems} / {jobToCancel.totalItems} items processed</span>
              </div>
              <div className="text-sm text-amber-600 mt-4">
                ⚠️ All transactions created so far will be permanently deleted
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setJobToCancel(null)}
              disabled={isCancelling}
            >
              Keep Running
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelJob}
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelling..." : "Cancel Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
      </main>
  );
}
