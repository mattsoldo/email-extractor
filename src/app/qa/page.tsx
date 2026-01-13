"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Plus,
  ClipboardCheck,
  Play,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import Link from "next/link";

interface QaRun {
  id: string;
  setId: string;
  sourceRunId: string;
  modelId: string;
  promptId: string;
  status: string;
  transactionsTotal: number;
  transactionsChecked: number;
  issuesFound: number;
  config: {
    filters?: {
      transactionTypes?: string[];
      minConfidence?: number;
      maxConfidence?: number;
    };
  } | null;
  synthesizedRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  sourceRun: {
    id: string;
    version: number;
    name: string | null;
    transactionsCreated: number;
  } | null;
  set: {
    id: string;
    name: string;
  } | null;
}

interface ExtractionRun {
  id: string;
  version: number;
  name: string | null;
  setId: string;
  transactionsCreated: number;
  status: string;
}

interface Model {
  id: string;
  name: string;
  provider: string;
}

interface Prompt {
  id: string;
  name: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function QAPage() {
  const [qaRuns, setQaRuns] = useState<QaRun[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // New QA run dialog
  const [newRunDialogOpen, setNewRunDialogOpen] = useState(false);
  const [extractionRuns, setExtractionRuns] = useState<ExtractionRun[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedSourceRun, setSelectedSourceRun] = useState<string>("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedPrompt, setSelectedPrompt] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // Fetch QA runs
  const fetchQaRuns = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });

      const res = await fetch(`/api/qa?${params}`);
      const data = await res.json();

      setQaRuns(data.runs || []);
      setPagination(data.pagination);
    } catch (error) {
      console.error("Failed to fetch QA runs:", error);
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, [page]);

  // Initial load
  useEffect(() => {
    fetchQaRuns(true);
  }, [fetchQaRuns]);

  // Poll for updates when there are running QA jobs
  useEffect(() => {
    const hasRunningJobs = qaRuns.some(
      (run) => run.status === "running" || run.status === "pending"
    );
    if (!hasRunningJobs) return;

    const interval = setInterval(() => {
      fetchQaRuns(false);
    }, 2000);

    return () => clearInterval(interval);
  }, [qaRuns, fetchQaRuns]);

  // Fetch data for new run dialog
  const fetchDialogData = async () => {
    try {
      const [runsRes, modelsRes, promptsRes] = await Promise.all([
        fetch("/api/runs?limit=100"),
        fetch("/api/models"),
        fetch("/api/prompts"),
      ]);

      const runsData = await runsRes.json();
      const modelsData = await modelsRes.json();
      const promptsData = await promptsRes.json();

      // Filter to only completed runs
      setExtractionRuns(
        (runsData.runs || []).filter(
          (r: ExtractionRun) => r.status === "completed"
        )
      );
      setModels(modelsData.models || modelsData || []);
      setPrompts(promptsData.prompts || promptsData || []);

      // Set defaults
      const defaultModel = (modelsData.models || modelsData || []).find(
        (m: Model) => m.id.includes("claude-sonnet")
      );
      if (defaultModel) {
        setSelectedModel(defaultModel.id);
      }

      const qaPrompt = (promptsData.prompts || promptsData || []).find(
        (p: Prompt) => p.name.toLowerCase().includes("qa")
      );
      if (qaPrompt) {
        setSelectedPrompt(qaPrompt.id);
      }
    } catch (error) {
      console.error("Failed to fetch dialog data:", error);
      toast.error("Failed to load configuration options");
    }
  };

  const openNewRunDialog = () => {
    setNewRunDialogOpen(true);
    fetchDialogData();
  };

  const createQaRun = async () => {
    if (!selectedSourceRun || !selectedModel || !selectedPrompt) {
      toast.error("Please select all required options");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceRunId: selectedSourceRun,
          modelId: selectedModel,
          promptId: selectedPrompt,
        }),
      });

      if (res.ok) {
        toast.success("QA run started");
        setNewRunDialogOpen(false);
        setSelectedSourceRun("");
        fetchQaRuns(false);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create QA run");
      }
    } catch (error) {
      toast.error("Failed to create QA run");
    } finally {
      setCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-100 text-green-800 gap-1">
            <CheckCircle className="h-3 w-3" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-100 text-red-800 gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-100 text-blue-800 gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        );
      case "pending":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="lg:pl-64 pt-16 lg:pt-0 transition-all duration-300 body-sidebar-offset">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <ClipboardCheck className="h-7 w-7" />
                Quality Assurance
              </h1>
              <p className="text-gray-500 mt-1">
                Verify extracted transaction data against source emails
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => fetchQaRuns(true)}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button onClick={openNewRunDialog}>
                <Plus className="h-4 w-4 mr-2" />
                New QA Run
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Total QA Runs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {pagination?.total || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Running
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">
                  {
                    qaRuns.filter(
                      (r) => r.status === "running" || r.status === "pending"
                    ).length
                  }
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Issues Found (This Page)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">
                  {qaRuns.reduce((sum, r) => sum + (r.issuesFound || 0), 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Synthesized Runs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {qaRuns.filter((r) => r.synthesizedRunId).length}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* QA Runs Table */}
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : qaRuns.length === 0 ? (
                <div className="text-center py-12">
                  <ClipboardCheck className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">
                    No QA runs yet
                  </h3>
                  <p className="text-gray-500 mb-4">
                    Create a QA run to verify your extraction results
                  </p>
                  <Button onClick={openNewRunDialog}>
                    <Plus className="h-4 w-4 mr-2" />
                    New QA Run
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source Run</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Progress</TableHead>
                      <TableHead>Issues</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qaRuns.map((run) => {
                      const progress =
                        run.transactionsTotal > 0
                          ? Math.round(
                              (run.transactionsChecked / run.transactionsTotal) *
                                100
                            )
                          : 0;

                      return (
                        <TableRow key={run.id}>
                          <TableCell>
                            <div className="font-medium">
                              v{run.sourceRun?.version || "?"}{" "}
                              {run.sourceRun?.name && (
                                <span className="text-gray-500">
                                  ({run.sourceRun.name})
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500">
                              {run.set?.name || "Unknown Set"}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(run.status)}</TableCell>
                          <TableCell>
                            <div className="w-32">
                              <Progress value={progress} className="h-2" />
                              <div className="text-xs text-gray-500 mt-1">
                                {run.transactionsChecked} / {run.transactionsTotal}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {run.issuesFound > 0 ? (
                              <Badge className="bg-amber-100 text-amber-800">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                {run.issuesFound}
                              </Badge>
                            ) : run.status === "completed" ? (
                              <Badge className="bg-green-100 text-green-800">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                None
                              </Badge>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-gray-600">
                              {run.modelId?.split("-").slice(0, 2).join("-") ||
                                "Unknown"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              {format(new Date(run.createdAt), "MMM d, yyyy")}
                            </div>
                            <div className="text-xs text-gray-500">
                              {format(new Date(run.createdAt), "h:mm a")}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {run.status === "completed" && (
                                <Link href={`/qa/${run.id}`}>
                                  <Button variant="outline" size="sm">
                                    <Eye className="h-4 w-4 mr-1" />
                                    Review
                                  </Button>
                                </Link>
                              )}
                              {run.synthesizedRunId && (
                                <Link href={`/runs?highlight=${run.synthesizedRunId}`}>
                                  <Button variant="ghost" size="sm">
                                    <Sparkles className="h-4 w-4 mr-1" />
                                    View Result
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-500">
                Showing {(page - 1) * 20 + 1} to{" "}
                {Math.min(page * 20, pagination.total)} of {pagination.total} runs
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page - 1)}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(page + 1)}
                  disabled={page === pagination.totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* New QA Run Dialog */}
      <Dialog open={newRunDialogOpen} onOpenChange={setNewRunDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Start New QA Run</DialogTitle>
            <DialogDescription>
              Select an extraction run to verify against source emails
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Source Extraction Run</Label>
              <Select
                value={selectedSourceRun}
                onValueChange={setSelectedSourceRun}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a run to QA..." />
                </SelectTrigger>
                <SelectContent>
                  {extractionRuns.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      v{run.version} {run.name && `(${run.name})`} -{" "}
                      {run.transactionsCreated} transactions
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a model..." />
                </SelectTrigger>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name} ({model.provider})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>QA Prompt</Label>
              <Select value={selectedPrompt} onValueChange={setSelectedPrompt}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a prompt..." />
                </SelectTrigger>
                <SelectContent>
                  {prompts.map((prompt) => (
                    <SelectItem key={prompt.id} value={prompt.id}>
                      {prompt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewRunDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={createQaRun}
              disabled={
                creating ||
                !selectedSourceRun ||
                !selectedModel ||
                !selectedPrompt
              }
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start QA Run
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
