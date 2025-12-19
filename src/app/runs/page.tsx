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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
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
  ArrowRight,
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
  } | null;
}

interface RunWithTransactions extends ExtractionRun {
  transactions: Array<{
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
  }>;
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

export default function RunsPage() {
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<RunWithTransactions | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [page, setPage] = useState(1);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const fetchRunDetails = async (runId: string) => {
    setLoadingRun(true);
    try {
      const res = await fetch(`/api/runs/${runId}?limit=50`);
      const data = await res.json();
      setSelectedRun({
        ...data.run,
        transactions: data.transactions,
      });
    } catch (error) {
      console.error("Failed to fetch run details:", error);
    } finally {
      setLoadingRun(false);
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
          <Button onClick={fetchRuns} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
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
                    <TableCell colSpan={9} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : runs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      No extraction runs found. Start an extraction job to see
                      results here.
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => (
                    <TableRow key={run.id}>
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
                      <TableCell>{getStatusBadge(run.status)}</TableCell>
                      <TableCell className="text-xs text-gray-600 font-mono">
                        {run.modelId ? run.modelId.split("/").pop() : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {run.emailsProcessed}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {run.transactionsCreated}
                      </TableCell>
                      <TableCell className="text-right">
                        {run.errorCount > 0 ? (
                          <span className="text-red-600">{run.errorCount}</span>
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
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fetchRunDetails(run.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
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

        {/* Run Detail Dialog */}
        <Dialog open={!!selectedRun} onOpenChange={() => setSelectedRun(null)}>
          <DialogContent className="max-w-4xl max-h-[85vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                Extraction Run v{selectedRun?.version}
                {selectedRun?.name && (
                  <span className="text-gray-500 font-normal">
                    - {selectedRun.name}
                  </span>
                )}
              </DialogTitle>
            </DialogHeader>

            {loadingRun ? (
              <div className="flex items-center justify-center py-8">
                Loading run details...
              </div>
            ) : selectedRun ? (
              <ScrollArea className="h-[70vh]">
                <div className="space-y-6 pr-4">
                  {/* Run Overview */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500">Status</div>
                      <div className="mt-1">
                        {getStatusBadge(selectedRun.status)}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500">Emails</div>
                      <div className="text-lg font-semibold">
                        {selectedRun.emailsProcessed}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500">Transactions</div>
                      <div className="text-lg font-semibold text-green-600">
                        {selectedRun.transactionsCreated}
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500">Avg Confidence</div>
                      <div className="text-lg font-semibold">
                        {selectedRun.stats?.avgConfidence
                          ? `${(selectedRun.stats.avgConfidence * 100).toFixed(0)}%`
                          : "-"}
                      </div>
                    </div>
                  </div>

                  {/* Transaction Type Breakdown */}
                  {selectedRun.stats?.byType &&
                    Object.keys(selectedRun.stats.byType).length > 0 && (
                      <div>
                        <h3 className="font-semibold mb-2">
                          Transactions by Type
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedRun.stats.byType).map(
                            ([type, count]) => (
                              <Badge
                                key={type}
                                variant="secondary"
                                className="text-sm"
                              >
                                {type.replace(/_/g, " ")}: {count}
                              </Badge>
                            )
                          )}
                        </div>
                      </div>
                    )}

                  {/* Run Metadata */}
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Model:</span>{" "}
                      <span className="font-mono text-xs">
                        {selectedRun.modelId || "-"}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Duration:</span>{" "}
                      {selectedRun.stats?.processingTimeMs
                        ? formatDuration(selectedRun.stats.processingTimeMs)
                        : "-"}
                    </div>
                    <div>
                      <span className="text-gray-500">Started:</span>{" "}
                      {format(
                        new Date(selectedRun.startedAt),
                        "MMM d, yyyy h:mm:ss a"
                      )}
                    </div>
                    <div>
                      <span className="text-gray-500">Completed:</span>{" "}
                      {selectedRun.completedAt
                        ? format(
                            new Date(selectedRun.completedAt),
                            "MMM d, yyyy h:mm:ss a"
                          )
                        : "-"}
                    </div>
                  </div>

                  {/* Description */}
                  {selectedRun.description && (
                    <div>
                      <h3 className="font-semibold mb-1">Description</h3>
                      <p className="text-gray-600 text-sm">
                        {selectedRun.description}
                      </p>
                    </div>
                  )}

                  {/* Sample Transactions */}
                  {selectedRun.transactions &&
                    selectedRun.transactions.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-semibold">
                            Transactions ({selectedRun.transactionsCreated})
                          </h3>
                          <Link
                            href={`/transactions?runId=${selectedRun.id}`}
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          >
                            View all
                            <ArrowRight className="h-3 w-3" />
                          </Link>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Symbol</TableHead>
                              <TableHead>Account</TableHead>
                              <TableHead className="text-right">
                                Amount
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedRun.transactions
                              .slice(0, 10)
                              .map((tx) => (
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
                                    {tx.account?.displayName || "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-medium">
                                    {formatAmount(tx.amount)}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                        {selectedRun.transactions.length > 10 && (
                          <p className="text-sm text-gray-500 mt-2 text-center">
                            Showing 10 of {selectedRun.transactionsCreated}{" "}
                            transactions
                          </p>
                        )}
                      </div>
                    )}
                </div>
              </ScrollArea>
            ) : null}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
