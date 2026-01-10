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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  RefreshCw,
  History,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Trash2,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

interface ExtractionRun {
  id: string;
  jobId: string | null;
  version: number;
  name: string | null;
  description: string | null;
  modelId: string | null;
  emailsProcessed: number;
  transactionsCreated: number;
  informationalCount: number;
  errorCount: number;
  config: Record<string, unknown> | null;
  stats: {
    byType: Record<string, number>;
    avgConfidence: number;
    processingTimeMs: number;
  } | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  job: {
    id: string;
    type: string;
    status: string;
    totalItems: number | null;
    processedItems: number | null;
    failedItems: number | null;
    skippedItems: number | null;
    informationalItems: number | null;
  } | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface Summary {
  totalRuns: number;
  totalTransactions: number;
  totalEmails: number;
}

interface DeleteInfo {
  runId: string;
  runName: string;
  transactionCount: number;
  requiresConfirmation: boolean;
  message: string;
}

export default function RunsPage() {
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [deleteInfo, setDeleteInfo] = useState<DeleteInfo | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [bulkDeleteInfo, setBulkDeleteInfo] = useState<{
    runIds: string[];
    totalTransactions: number;
    runNames: string[];
  } | null>(null);

  // Fetch runs - only show loading spinner on initial load, not on refreshes
  const fetchRuns = useCallback(async (isInitialLoad = false) => {
    if (isInitialLoad) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "20",
      });

      const res = await fetch(`/api/runs?${params}`);
      const data = await res.json();

      setRuns(data.runs || []);
      setPagination(data.pagination);
      setSummary(data.summary);
    } catch (error) {
      console.error("Failed to fetch runs:", error);
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, [page]);

  // Initial load and page changes
  useEffect(() => {
    fetchRuns(true);
  }, [fetchRuns]);

  // Poll for updates when there are running jobs (no loading state)
  useEffect(() => {
    const hasRunningJobs = runs.some((run) => run.status === "running");
    if (!hasRunningJobs) return;

    const interval = setInterval(() => {
      fetchRuns(false); // Silent refresh - no loading spinner
    }, 2000);

    return () => clearInterval(interval);
  }, [runs, fetchRuns]);

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
            <Clock className="h-3 w-3" />
            Running
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatAmount = (amount: string | null) => {
    if (!amount) return "-";
    const num = parseFloat(amount);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num);
  };

  const handleDeleteClick = async (runId: string) => {
    try {
      // First, get the deletion info without confirming
      const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to prepare deletion");
        return;
      }

      // Auto-delete if less than 100 transactions (no confirmation needed)
      if (data.transactionCount < 100) {
        const confirmRes = await fetch(`/api/runs/${runId}?confirm=true`, {
          method: "DELETE",
        });
        const confirmData = await confirmRes.json();

        if (!confirmRes.ok) {
          alert(confirmData.error || "Failed to delete run");
          return;
        }

        fetchRuns();
        return;
      }

      // Otherwise, show confirmation dialog
      setDeleteInfo(data);
    } catch (error) {
      console.error("Failed to get deletion info:", error);
      alert("Failed to prepare deletion");
    }
  };

  // Toggle selection of a single run
  const toggleRunSelection = (runId: string) => {
    setSelectedRuns((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(runId)) {
        newSet.delete(runId);
      } else {
        newSet.add(runId);
      }
      return newSet;
    });
  };

  // Select/deselect all non-running runs on current page
  const toggleSelectAll = () => {
    const selectableRuns = runs.filter((run) => run.status !== "running");
    const allSelected = selectableRuns.every((run) => selectedRuns.has(run.id));

    if (allSelected) {
      setSelectedRuns(new Set());
    } else {
      setSelectedRuns(new Set(selectableRuns.map((run) => run.id)));
    }
  };

  // Prepare bulk delete - always requires confirmation
  const handleBulkDelete = async () => {
    const runIds = Array.from(selectedRuns);
    if (runIds.length === 0) return;

    try {
      // Get transaction counts for all selected runs
      const results = await Promise.all(
        runIds.map(async (runId) => {
          const res = await fetch(`/api/runs/${runId}`, { method: "DELETE" });
          return res.json();
        })
      );

      const totalTransactions = results.reduce(
        (sum, r) => sum + (r.transactionCount || 0),
        0
      );
      const runNames = results.map((r) => r.runName || "Unknown");

      setBulkDeleteInfo({
        runIds,
        totalTransactions,
        runNames,
      });
    } catch (error) {
      console.error("Failed to prepare bulk deletion:", error);
      alert("Failed to prepare bulk deletion");
    }
  };

  // Confirm bulk delete
  const confirmBulkDelete = async () => {
    if (!bulkDeleteInfo) return;

    setDeleting(true);
    try {
      // Delete each run
      await Promise.all(
        bulkDeleteInfo.runIds.map((runId) =>
          fetch(`/api/runs/${runId}?confirm=true`, { method: "DELETE" })
        )
      );

      setSelectedRuns(new Set());
      setBulkDeleteInfo(null);
      fetchRuns();
    } catch (error) {
      console.error("Failed to delete runs:", error);
      alert("Failed to delete some runs");
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteInfo) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/runs/${deleteInfo.runId}?confirm=true`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to delete run");
        return;
      }

      // Refresh the list
      fetchRuns();
      setDeleteInfo(null);
    } catch (error) {
      console.error("Failed to delete run:", error);
      alert("Failed to delete run");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Extraction Runs</h1>
            <p className="text-gray-600 mt-1">
              View history of AI extraction runs and their results
            </p>
          </div>
          <div className="flex gap-2">
            {selectedRuns.size > 0 && (
              <Button
                onClick={handleBulkDelete}
                variant="destructive"
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete {selectedRuns.size} Run{selectedRuns.size > 1 ? "s" : ""}
              </Button>
            )}
            <Button onClick={() => fetchRuns()} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-normal">
                  Total Runs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-blue-600" />
                  <span className="text-2xl font-bold">{summary.totalRuns}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-normal">
                  Total Transactions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-green-600" />
                  <span className="text-2xl font-bold">
                    {summary.totalTransactions || 0}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-normal">
                  Emails Processed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-purple-600" />
                  <span className="text-2xl font-bold">
                    {summary.totalEmails || 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Runs Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={
                        runs.filter((r) => r.status !== "running").length > 0 &&
                        runs
                          .filter((r) => r.status !== "running")
                          .every((r) => selectedRuns.has(r.id))
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Emails</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      No extraction runs found. Start an extraction job to see
                      results here.
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => {
                    const isRunning = run.status === "running";
                    const progress = run.job?.totalItems && run.job.totalItems > 0
                      ? ((run.job.processedItems || 0) / run.job.totalItems) * 100
                      : 0;

                    return (
                      <TableRow key={run.id} className={isRunning ? "bg-blue-50/30" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={selectedRuns.has(run.id)}
                            onCheckedChange={() => toggleRunSelection(run.id)}
                            disabled={isRunning}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold">v{run.version}</span>
                            {run.name && (
                              <span className="text-xs text-gray-500">
                                {run.name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {getStatusBadge(run.status)}
                            {isRunning && run.job && (
                              <div className="w-24">
                                <Progress value={progress} className="h-1.5" />
                                <span className="text-[10px] text-gray-500">
                                  {run.job.processedItems || 0}/{run.job.totalItems || 0}
                                </span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-gray-600 font-mono">
                          {run.modelId ? run.modelId.split("/").pop() : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {isRunning && run.job ? (
                            <span className="text-blue-600">
                              {run.job.processedItems || 0}
                            </span>
                          ) : (
                            run.emailsProcessed
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {run.transactionsCreated}
                        </TableCell>
                        <TableCell className="text-right">
                          {(isRunning ? run.job?.failedItems : run.errorCount) ? (
                            <span className="text-red-600">
                              {isRunning ? run.job?.failedItems || 0 : run.errorCount}
                            </span>
                          ) : (
                            <span className="text-gray-400">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-gray-600 text-sm">
                          {format(new Date(run.startedAt), "MMM d, h:mm a")}
                        </TableCell>
                        <TableCell className="text-gray-600 text-sm">
                          {run.stats?.processingTimeMs
                            ? formatDuration(run.stats.processingTimeMs)
                            : isRunning ? (
                                <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
                              ) : "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Link href={`/runs/${run.id}`}>
                              <Button variant="ghost" size="sm">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            {run.job && (
                              <Link href={`/jobs/${run.job.id}`}>
                                <Button variant="ghost" size="sm">
                                  <ExternalLink className="h-4 w-4" />
                                </Button>
                              </Link>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteClick(run.id)}
                              disabled={isRunning}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-gray-600">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total} runs
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="flex items-center px-3 text-sm">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPage((p) => Math.min(pagination.totalPages, p + 1))
                }
                disabled={page === pagination.totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Single Delete Confirmation Dialog (only for runs with 100+ transactions) */}
        <AlertDialog open={!!deleteInfo} onOpenChange={() => setDeleteInfo(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Delete Extraction Run
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Are you sure you want to delete <strong>{deleteInfo?.runName}</strong>?
                </p>
                <p className="text-amber-600 font-medium">
                  {deleteInfo?.message}
                </p>
                <p className="text-red-600 text-sm">
                  This action cannot be undone.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700"
              >
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Delete Confirmation Dialog (always shown for multi-select) */}
        <AlertDialog open={!!bulkDeleteInfo} onOpenChange={() => setBulkDeleteInfo(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Delete {bulkDeleteInfo?.runIds.length} Extraction Run{bulkDeleteInfo?.runIds.length !== 1 ? "s" : ""}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Are you sure you want to delete the following runs?
                </p>
                <ul className="list-disc list-inside text-sm max-h-32 overflow-y-auto">
                  {bulkDeleteInfo?.runNames.map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
                <p className="text-amber-600 font-medium">
                  This will delete {bulkDeleteInfo?.totalTransactions} transaction{bulkDeleteInfo?.totalTransactions !== 1 ? "s" : ""} total.
                </p>
                <p className="text-red-600 text-sm">
                  This action cannot be undone.
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmBulkDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-700"
              >
                {deleting ? "Deleting..." : `Delete ${bulkDeleteInfo?.runIds.length} Run${bulkDeleteInfo?.runIds.length !== 1 ? "s" : ""}`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
