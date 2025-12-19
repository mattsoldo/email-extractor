"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Play,
  RefreshCw,
  Mail,
  ArrowLeftRight,
  Wallet,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeJobs, setActiveJobs] = useState<JobProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const [emailsRes, transactionsRes, accountsRes] = await Promise.all([
        fetch("/api/emails?limit=1"),
        fetch("/api/transactions?limit=1"),
        fetch("/api/accounts"),
      ]);

      const emailsData = await emailsRes.json();
      const transactionsData = await transactionsRes.json();
      const accountsData = await accountsRes.json();

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
      setActiveJobs(data.jobs || []);
    } catch (error) {
      console.error("Failed to fetch jobs:", error);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    fetchActiveJobs();

    // Poll for active jobs
    const interval = setInterval(() => {
      fetchActiveJobs();
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchStats, fetchActiveJobs]);

  const startScanJob = async () => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email_scan" }),
      });
      const data = await res.json();
      toast.success("Email scan job started");
      fetchActiveJobs();
    } catch (error) {
      toast.error("Failed to start scan job");
    }
  };

  const startExtractionJob = async () => {
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "extraction", options: { concurrency: 3 } }),
      });
      const data = await res.json();
      toast.success("Extraction job started");
      fetchActiveJobs();
    } catch (error) {
      toast.error("Failed to start extraction job");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />;
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
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Extract and consolidate financial transactions from email notifications
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-4 mb-8">
          <Button onClick={startScanJob} className="gap-2">
            <Play className="h-4 w-4" />
            Scan Emails Folder
          </Button>
          <Button
            onClick={startExtractionJob}
            variant="outline"
            className="gap-2"
            disabled={!stats || stats.emails.pending === 0}
          >
            <RefreshCw className="h-4 w-4" />
            Extract Transactions
            {stats && stats.emails.pending > 0 && (
              <Badge variant="secondary">{stats.emails.pending} pending</Badge>
            )}
          </Button>
          <Button variant="outline" onClick={fetchStats} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Active Jobs */}
        {activeJobs.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Active Jobs
            </h2>
            <div className="space-y-4">
              {activeJobs.map((job) => (
                <Card key={job.id}>
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
                      </div>
                      <div className="text-sm text-gray-500">
                        {job.processedItems} / {job.totalItems} items
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
                  Place your .eml email files in the <code>emails/</code> folder
                </li>
                <li>
                  Click <strong>Scan Emails Folder</strong> to import emails
                  into the database
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
      </main>
    </div>
  );
}
