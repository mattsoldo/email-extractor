"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Clock,
  ArrowRight,
  Loader2,
  FileText,
  History,
  ExternalLink,
  MessageCircle,
  StopCircle,
  Sparkles,
  Plus,
  Database,
  Download,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

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
  discussionCount?: number;
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
}

interface Transaction {
  id: string;
  type: string;
  date: string;
  amount: string | null;
  symbol: string | null;
  account: {
    displayName: string;
    institution: string | null;
  } | null;
  email: {
    id: string;
    filename: string;
    subject: string | null;
  } | null;
}

export default function RunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;

  const [run, setRun] = useState<ExtractionRun | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [flattening, setFlattening] = useState(false);
  const [flattenDialogOpen, setFlattenDialogOpen] = useState(false);
  const [flattenPreview, setFlattenPreview] = useState<{
    newColumns: Array<{ columnName: string; originalKey: string; occurrences: number }>;
    existingColumns: Array<{ columnName: string; originalKey: string; occurrences: number }>;
    totalKeys: number;
    totalTransactions: number;
  } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const handleCancel = async () => {
    if (!run || cancelling) return;

    setCancelling(true);
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to cancel run");
      }
      // Refresh to get updated status
      await fetchRunDetails();
    } catch (error) {
      console.error("Failed to cancel run:", error);
      alert(error instanceof Error ? error.message : "Failed to cancel run");
    } finally {
      setCancelling(false);
    }
  };

  const handleFlattenPreview = async () => {
    if (!run || loadingPreview) return;

    setLoadingPreview(true);
    try {
      const res = await fetch("/api/runs/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "data_flatten",
          runAId: runId,
          preview: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to get preview");
      }

      const data = await res.json();
      setFlattenPreview(data.changes);
      // Select all fields by default
      const allKeys = [
        ...data.changes.newColumns.map((c: { originalKey: string }) => c.originalKey),
        ...data.changes.existingColumns.map((c: { originalKey: string }) => c.originalKey),
      ];
      setSelectedFields(new Set(allKeys));
      setFlattenDialogOpen(true);
    } catch (error) {
      console.error("Failed to get flatten preview:", error);
      toast.error(error instanceof Error ? error.message : "Failed to get preview");
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleFieldSelection = (key: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectAllFields = () => {
    if (!flattenPreview) return;
    const allKeys = [
      ...flattenPreview.newColumns.map((c) => c.originalKey),
      ...flattenPreview.existingColumns.map((c) => c.originalKey),
    ];
    setSelectedFields(new Set(allKeys));
  };

  const deselectAllFields = () => {
    setSelectedFields(new Set());
  };

  const handleFlattenConfirm = async () => {
    if (!run || flattening || selectedFields.size === 0) return;

    setFlattening(true);
    try {
      const res = await fetch("/api/runs/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "data_flatten",
          runAId: runId,
          selectedKeys: Array.from(selectedFields),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to flatten data");
      }

      const data = await res.json();
      toast.success(`Created flattened run: ${data.run.name}`);
      setFlattenDialogOpen(false);
      // Navigate to the new run
      router.push(`/runs/${data.run.id}`);
    } catch (error) {
      console.error("Failed to flatten data:", error);
      toast.error(error instanceof Error ? error.message : "Failed to flatten data");
    } finally {
      setFlattening(false);
    }
  };

  const fetchRunDetails = useCallback(async (isPolling = false) => {
    if (!isPolling) {
      setLoading(true);
    }
    try {
      const res = await fetch(`/api/runs/${runId}?limit=100`);
      if (!res.ok) {
        throw new Error("Failed to fetch run details");
      }
      const data = await res.json();
      setRun(data.run);
      setTransactions(data.transactions || []);
    } catch (error) {
      console.error("Failed to fetch run details:", error);
    } finally {
      if (!isPolling) {
        setLoading(false);
      }
    }
  }, [runId]);

  useEffect(() => {
    fetchRunDetails();
  }, [fetchRunDetails]);

  // Auto-refresh when job is running
  useEffect(() => {
    if (run?.status !== "running") {
      return;
    }

    const interval = setInterval(() => {
      fetchRunDetails(true);
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [run?.status, fetchRunDetails]);

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
      case "cancelled":
        return (
          <Badge className="bg-orange-100 text-orange-800 gap-1">
            <StopCircle className="h-3 w-3" />
            Cancelled
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-100 text-blue-800 gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </main>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-gray-500">Run not found</p>
            <Button onClick={() => router.push("/runs")} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Runs
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/runs")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex items-center gap-3">
              <History className="h-6 w-6 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Extraction Run v{run.version}
                </h1>
                {run.name && (
                  <p className="text-gray-600 text-sm">{run.name}</p>
                )}
              </div>
              {getStatusBadge(run.status)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {run.status === "running" && (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <StopCircle className="h-4 w-4" />
                )}
                Cancel Run
              </Button>
            )}
            {run.jobId && (
              <Link href={`/jobs/${run.jobId}`}>
                <Button variant="outline" size="sm" className="gap-2">
                  <ExternalLink className="h-4 w-4" />
                  View Job
                </Button>
              </Link>
            )}
            {run.status === "completed" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    window.location.href = `/api/transactions/export?runId=${runId}&format=excel`;
                  }}
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                  onClick={handleFlattenPreview}
                  disabled={loadingPreview}
                >
                  {loadingPreview ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Flatten Data
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {getStatusBadge(run.status)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Emails Processed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{run.emailsProcessed}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Transactions Created
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {run.transactionsCreated}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Discussions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {run.discussionCount && run.discussionCount > 0 ? (
                <Link href={`/discussions?runId=${run.id}`}>
                  <div className="text-2xl font-bold text-purple-600 hover:underline cursor-pointer">
                    {run.discussionCount}
                  </div>
                </Link>
              ) : (
                <div className="text-2xl font-bold text-gray-400">0</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Avg Confidence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {run.stats?.avgConfidence
                  ? `${(run.stats.avgConfidence * 100).toFixed(0)}%`
                  : "-"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Run Details */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Run Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Model:</span>{" "}
                <span className="font-mono text-xs">{run.modelId || "-"}</span>
              </div>
              <div>
                <span className="text-gray-500">Duration:</span>{" "}
                {run.stats?.processingTimeMs
                  ? formatDuration(run.stats.processingTimeMs)
                  : "-"}
              </div>
              <div>
                <span className="text-gray-500">Started:</span>{" "}
                {format(new Date(run.startedAt), "MMM d, yyyy 'at' h:mm:ss a")}
              </div>
              <div>
                <span className="text-gray-500">Completed:</span>{" "}
                {run.completedAt
                  ? format(new Date(run.completedAt), "MMM d, yyyy 'at' h:mm:ss a")
                  : "-"}
              </div>
              <div>
                <span className="text-gray-500">Informational:</span>{" "}
                <span className="text-blue-600">{run.informationalCount}</span>
              </div>
              <div>
                <span className="text-gray-500">Discussions:</span>{" "}
                {run.discussionCount && run.discussionCount > 0 ? (
                  <Link
                    href={`/discussions?runId=${run.id}`}
                    className="text-purple-600 hover:underline"
                  >
                    {run.discussionCount}
                  </Link>
                ) : (
                  <span className="text-gray-400">0</span>
                )}
              </div>
              <div>
                <span className="text-gray-500">Errors:</span>{" "}
                <span className={run.errorCount > 0 ? "text-red-600" : "text-gray-400"}>
                  {run.errorCount}
                </span>
              </div>
            </div>

            {run.description && (
              <div className="mt-4 pt-4 border-t">
                <h3 className="font-semibold mb-2 text-sm text-gray-700">
                  Description
                </h3>
                <p className="text-gray-600 text-sm">{run.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transaction Type Breakdown */}
        {run.stats?.byType && Object.keys(run.stats.byType).length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Transactions by Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(run.stats.byType).map(([type, count]) => (
                  <div key={type} className="bg-gray-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-gray-900">{count}</div>
                    <div className="text-sm text-gray-600 capitalize mt-1">
                      {type.replace(/_/g, " ")}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Transactions */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Transactions ({run.transactionsCreated})
              </CardTitle>
              <Link
                href={`/transactions?runId=${run.id}`}
                className="text-sm text-blue-600 hover:underline flex items-center gap-1"
              >
                View all in transactions page
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No transactions found
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-sm text-gray-600">
                        {format(new Date(tx.date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">
                          {tx.type.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {tx.symbol || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>
                          <div>{tx.account?.displayName || "-"}</div>
                          {tx.account?.institution && (
                            <div className="text-xs text-gray-500">
                              {tx.account.institution}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {tx.email ? (
                          <Link
                            href={`/emails/${tx.email.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {tx.email.subject || tx.email.filename}
                          </Link>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatAmount(tx.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {transactions.length > 0 && transactions.length < run.transactionsCreated && (
              <p className="text-sm text-gray-500 mt-4 text-center">
                Showing {transactions.length} of {run.transactionsCreated} transactions
              </p>
            )}
          </CardContent>
        </Card>

        {/* Flatten Data Confirmation Dialog */}
        <Dialog open={flattenDialogOpen} onOpenChange={setFlattenDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" />
                Flatten Data to Columns
              </DialogTitle>
              <DialogDescription>
                This will create a new synthesized run with JSON data moved into database columns.
              </DialogDescription>
            </DialogHeader>

            {flattenPreview && (
              <div className="space-y-4 py-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    Processing <span className="font-semibold">{flattenPreview.totalTransactions}</span> transactions
                    with <span className="font-semibold">{flattenPreview.totalKeys}</span> unique data keys.
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={selectAllFields}
                      className="text-xs h-7"
                    >
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={deselectAllFields}
                      className="text-xs h-7"
                    >
                      Deselect All
                    </Button>
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  {selectedFields.size} of {flattenPreview.totalKeys} fields selected
                </div>

                {flattenPreview.newColumns.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-700">
                      <Plus className="h-4 w-4" />
                      New Columns to Create ({flattenPreview.newColumns.filter(c => selectedFields.has(c.originalKey)).length}/{flattenPreview.newColumns.length})
                    </div>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                      <div className="space-y-1">
                        {flattenPreview.newColumns.map((col) => (
                          <label
                            key={col.columnName}
                            className="flex items-center justify-between text-sm cursor-pointer hover:bg-green-100 rounded px-1 py-0.5"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedFields.has(col.originalKey)}
                                onChange={() => toggleFieldSelection(col.originalKey)}
                                className="rounded border-green-400 text-green-600 focus:ring-green-500"
                              />
                              <code className="text-green-800">{col.columnName}</code>
                            </div>
                            <span className="text-gray-500">
                              {col.occurrences} transactions
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {flattenPreview.existingColumns.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                      <Database className="h-4 w-4" />
                      Existing Columns ({flattenPreview.existingColumns.filter(c => selectedFields.has(c.originalKey)).length}/{flattenPreview.existingColumns.length})
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 max-h-32 overflow-y-auto">
                      <div className="space-y-1">
                        {flattenPreview.existingColumns.map((col) => (
                          <label
                            key={col.columnName}
                            className="flex items-center justify-between text-sm cursor-pointer hover:bg-blue-100 rounded px-1 py-0.5"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedFields.has(col.originalKey)}
                                onChange={() => toggleFieldSelection(col.originalKey)}
                                className="rounded border-blue-400 text-blue-600 focus:ring-blue-500"
                              />
                              <code className="text-blue-800">{col.columnName}</code>
                            </div>
                            <span className="text-gray-500">
                              {col.occurrences} transactions
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {flattenPreview.newColumns.length === 0 && flattenPreview.existingColumns.length === 0 && (
                  <div className="text-sm text-gray-500 italic">
                    No data keys found to flatten.
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setFlattenDialogOpen(false)}
                disabled={flattening}
              >
                Cancel
              </Button>
              <Button
                onClick={handleFlattenConfirm}
                disabled={flattening || !flattenPreview || selectedFields.size === 0}
                className="gap-2 bg-purple-600 hover:bg-purple-700"
              >
                {flattening ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Flatten {selectedFields.size} Field{selectedFields.size !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
