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
  ArrowRight,
  ExternalLink,
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

export default function RunsPage() {
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
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

  // Poll for updates when there are running jobs
  useEffect(() => {
    const hasRunningJobs = runs.some((run) => run.status === "running");
    if (!hasRunningJobs) return;

    const interval = setInterval(() => {
      fetchRuns();
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

  const formatExtractionRate = (emailsProcessed: number, processingTimeMs: number | null | undefined) => {
    if (!processingTimeMs || processingTimeMs === 0 || emailsProcessed === 0) return null;
    const minutes = processingTimeMs / 60000;
    const rate = emailsProcessed / minutes;
    if (rate >= 100) return `${Math.round(rate)}/min`;
    if (rate >= 10) return `${rate.toFixed(1)}/min`;
    return `${rate.toFixed(2)}/min`;
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
                  <TableHead>Rate</TableHead>
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
                        <TableCell className="text-gray-600 text-sm">
                          {formatExtractionRate(run.emailsProcessed, run.stats?.processingTimeMs) || "-"}
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
      </main>
    </div>
  );
}
