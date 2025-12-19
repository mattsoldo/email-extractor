"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import {
  RefreshCw,
  ArrowLeft,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  Info,
  Ban,
  Loader2,
} from "lucide-react";

interface JobProgress {
  id: string;
  type: string;
  status: string;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  informationalItems: number;
  errorMessage: string | null;
  cancelNotes?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt?: string | null;
}

interface ExtractionLog {
  id: string;
  emailId: string | null;
  jobId: string;
  level: string;
  message: string;
  errorType: string | null;
  stackTrace: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface JobDetailResponse {
  job: JobProgress;
  live: boolean;
  dbJob: JobProgress | null;
  logs: ExtractionLog[];
  extractionRun: {
    id: string;
    transactionsCreated: number;
    informationalCount: number;
    errorCount: number;
  } | null;
  summary: {
    transactionsCreated: number;
    informationalCount: number;
    errorCount: number;
    recentTransactions: Array<{
      id: string;
      type: string;
      symbol: string | null;
      amount: string | null;
      date: string;
    }>;
  } | null;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;

  const [data, setData] = useState<JobDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelNotes, setCancelNotes] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const fetchJobDetails = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Job not found");
          router.push("/");
          return;
        }
        throw new Error("Failed to fetch job");
      }
      const jobData = await res.json();
      setData(jobData);
    } catch (error) {
      console.error("Failed to fetch job:", error);
    } finally {
      setLoading(false);
    }
  }, [jobId, router]);

  useEffect(() => {
    fetchJobDetails();

    // Poll for updates if job is running
    const interval = setInterval(() => {
      if (data?.job.status === "running" || data?.job.status === "pending") {
        fetchJobDetails();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchJobDetails, data?.job.status]);

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: cancelNotes || null }),
      });

      if (res.ok) {
        toast.success("Job cancelled");
        setShowCancelDialog(false);
        setCancelNotes("");
        fetchJobDetails();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || "Failed to cancel job");
      }
    } catch (error) {
      toast.error("Failed to cancel job");
    } finally {
      setCancelling(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />;
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "cancelled":
        return <Ban className="h-5 w-5 text-orange-500" />;
      case "pending":
        return <Clock className="h-5 w-5 text-yellow-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "running":
        return "default";
      case "completed":
        return "secondary";
      case "failed":
        return "destructive";
      case "cancelled":
        return "outline";
      default:
        return "outline";
    }
  };

  const getLogIcon = (level: string) => {
    switch (level) {
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      case "info":
        return <Info className="h-4 w-4 text-blue-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </main>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center">
            <p className="text-gray-500">Job not found</p>
            <Button onClick={() => router.push("/")} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const { job, live, logs, summary } = data;
  const progress = job.totalItems > 0 ? (job.processedItems / job.totalItems) * 100 : 0;
  const isRunning = job.status === "running" || job.status === "pending";

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => router.push("/")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              {getStatusIcon(job.status)}
              <h1 className="text-2xl font-bold text-gray-900 capitalize">
                {job.type.replace("_", " ")} Job
              </h1>
              <Badge variant={getStatusBadgeVariant(job.status) as "default" | "secondary" | "destructive" | "outline"}>
                {job.status}
              </Badge>
              {live && (
                <Badge variant="outline" className="text-green-600 border-green-300">
                  Live
                </Badge>
              )}
            </div>
          </div>

          {isRunning && (
            <Button
              variant="destructive"
              onClick={() => setShowCancelDialog(true)}
            >
              <Ban className="h-4 w-4 mr-2" />
              Cancel Job
            </Button>
          )}
        </div>

        {/* Progress Card */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {job.processedItems} / {job.totalItems} items processed
                </span>
                <span className="font-medium">{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="h-3" />

              {/* Stats */}
              <div className="grid grid-cols-4 gap-4 pt-2">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {job.processedItems - job.failedItems - job.skippedItems - job.informationalItems}
                  </div>
                  <div className="text-xs text-gray-500">Successful</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{job.informationalItems}</div>
                  <div className="text-xs text-gray-500">Informational</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">{job.skippedItems}</div>
                  <div className="text-xs text-gray-500">Skipped</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">{job.failedItems}</div>
                  <div className="text-xs text-gray-500">Failed</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Cancel Notes */}
        {job.cancelNotes && (
          <Card className="mb-6 border-orange-200 bg-orange-50">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-orange-800">Cancellation Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-orange-700">{job.cancelNotes}</p>
            </CardContent>
          </Card>
        )}

        {/* Summary (for completed jobs) */}
        {summary && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Results Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{summary.transactionsCreated}</div>
                  <div className="text-xs text-gray-600">Transactions Created</div>
                </div>
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">{summary.informationalCount}</div>
                  <div className="text-xs text-gray-600">Informational</div>
                </div>
                <div className="text-center p-3 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">{summary.errorCount}</div>
                  <div className="text-xs text-gray-600">Errors</div>
                </div>
              </div>

              {summary.recentTransactions.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Recent Transactions</h4>
                  <div className="space-y-2">
                    {summary.recentTransactions.slice(0, 5).map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs capitalize">
                            {tx.type.replace("_", " ")}
                          </Badge>
                          {tx.symbol && <span className="font-medium">{tx.symbol}</span>}
                        </div>
                        {tx.amount && (
                          <span className="font-medium">
                            ${parseFloat(tx.amount).toLocaleString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Logs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center justify-between">
              <span>Extraction Logs</span>
              <Badge variant="outline">{logs.length} entries</Badge>
            </CardTitle>
            <CardDescription>
              {isRunning ? "Real-time log of extraction progress" : "Log of extraction events"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {isRunning ? "Waiting for logs..." : "No logs recorded"}
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-3 rounded border ${
                        log.level === "error"
                          ? "bg-red-50 border-red-200"
                          : log.level === "warning"
                          ? "bg-yellow-50 border-yellow-200"
                          : "bg-gray-50 border-gray-200"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {getLogIcon(log.level)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-gray-500">
                              {new Date(log.createdAt).toLocaleTimeString()}
                            </span>
                            {log.errorType && (
                              <Badge variant="outline" className="text-xs">
                                {log.errorType}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 break-words">{log.message}</p>
                          {log.stackTrace && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-500 cursor-pointer">
                                Stack trace
                              </summary>
                              <pre className="mt-1 text-xs bg-gray-100 p-2 rounded overflow-x-auto">
                                {log.stackTrace}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Cancel Dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Job</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this extraction job? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="cancel-notes">Notes (optional)</Label>
            <textarea
              id="cancel-notes"
              className="mt-2 w-full h-24 px-3 py-2 border rounded-md text-sm resize-none"
              placeholder="Why are you cancelling this job?"
              value={cancelNotes}
              onChange={(e) => setCancelNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCancelDialog(false)}>
              Keep Running
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Cancelling...
                </>
              ) : (
                <>
                  <Ban className="h-4 w-4 mr-2" />
                  Cancel Job
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
