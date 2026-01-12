"use client";

import { useEffect, useState, useCallback, Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { format } from "date-fns";
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trophy,
  Scale,
  ArrowLeftRight,
  Eye,
  Mail,
  Loader2,
  Equal,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

interface ExtractionRun {
  id: string;
  version: number;
  name: string | null;
  modelId: string | null;
  emailsProcessed: number;
  transactionsCreated: number;
  status: string;
  startedAt: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: string | null;
  currency: string | null;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  fees: string | null;
  date: string;
  accountId: string | null;
  toAccountId: string | null;
  confidence: string | null;
  data: Record<string, unknown> | null;
}

interface TransactionComparison {
  emailId: string;
  emailSubject: string | null;
  runATransaction: Transaction | null;
  runBTransaction: Transaction | null;
  status: "match" | "different" | "only_a" | "only_b";
  differences: string[];
  winnerTransactionId: string | null;
}

interface ComparisonSummary {
  total: number;
  matches: number;
  different: number;
  onlyA: number;
  onlyB: number;
  winnersDesignated: number;
  agreementRate: number;
}

interface ComparisonResult {
  runA: ExtractionRun;
  runB: ExtractionRun;
  summary: ComparisonSummary;
  comparisons: TransactionComparison[];
}

interface EmailContent {
  bodyHtml: string | null;
  bodyText: string | null;
  subject: string | null;
}

function ComparePageContent() {
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [runAId, setRunAId] = useState<string>("");
  const [runBId, setRunBId] = useState<string>("");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [expandedEmailPreviews, setExpandedEmailPreviews] = useState<Set<string>>(new Set());
  const [emailContents, setEmailContents] = useState<Map<string, EmailContent>>(new Map());
  const [loadingEmails, setLoadingEmails] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<Set<string>>(new Set());

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/extraction-runs");
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (error) {
      console.error("Failed to fetch runs:", error);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Compute grouped comparisons
  const { exclusiveItems, differentByType } = useMemo(() => {
    if (!comparison) {
      return { exclusiveItems: [], differentByType: new Map<string, TransactionComparison[]>() };
    }

    const exclusive = comparison.comparisons.filter(
      (c) => c.status === "only_a" || c.status === "only_b"
    );
    const different = comparison.comparisons.filter((c) => c.status === "different");

    // Group different by transaction type
    const byType = new Map<string, TransactionComparison[]>();
    for (const item of different) {
      const type = item.runATransaction?.type || item.runBTransaction?.type || "unknown";
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type)!.push(item);
    }

    return { exclusiveItems: exclusive, differentByType: byType };
  }, [comparison]);

  // Initialize from URL parameters and trigger comparison
  useEffect(() => {
    if (!initialized && runs.length > 0) {
      const urlRunA = searchParams.get("runA");
      const urlRunB = searchParams.get("runB");

      if (urlRunA && urlRunB) {
        setRunAId(urlRunA);
        setRunBId(urlRunB);
        setInitialized(true);

        const loadComparison = async () => {
          setLoading(true);
          try {
            const res = await fetch(`/api/compare?runA=${urlRunA}&runB=${urlRunB}`);
            const data = await res.json();
            if (res.ok) {
              setComparison(data);
              // Start with all type groups collapsed
              setExpandedTypes(new Set());
            }
          } catch (error) {
            console.error("Failed to load comparison:", error);
          } finally {
            setLoading(false);
          }
        };

        loadComparison();
      }
    }
  }, [runs, searchParams, initialized]);

  const fetchComparison = async () => {
    if (!runAId || !runBId) {
      toast.error("Please select both runs to compare");
      return;
    }
    if (runAId === runBId) {
      toast.error("Please select different runs");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/compare?runA=${runAId}&runB=${runBId}`);
      const data = await res.json();
      if (res.ok) {
        setComparison(data);
        // Start with all type groups collapsed
        setExpandedTypes(new Set());
      } else {
        toast.error(data.error || "Failed to compare runs");
      }
    } catch (error) {
      toast.error("Failed to compare runs");
    } finally {
      setLoading(false);
    }
  };

  const designateWinner = async (
    emailId: string,
    winnerTransactionId: string | null
  ) => {
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId,
          winnerTransactionId,
        }),
      });

      if (res.ok) {
        const message = !winnerTransactionId
          ? "Winner cleared"
          : winnerTransactionId === "tie"
            ? "Marked as tie"
            : "Winner set";
        toast.success(message);
        fetchComparison();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to set winner");
      }
    } catch (error) {
      toast.error("Failed to set winner");
    }
  };

  const bulkDesignateWinner = async (
    items: TransactionComparison[],
    winnerType: "a" | "b" | "tie"
  ) => {
    const typeKey = items[0]?.runATransaction?.type || items[0]?.runBTransaction?.type || "unknown";
    setBulkLoading((prev) => new Set(prev).add(typeKey));

    try {
      const updates = items.map((item) => ({
        emailId: item.emailId,
        winnerTransactionId:
          winnerType === "tie"
            ? "tie"
            : winnerType === "a"
              ? item.runATransaction?.id || null
              : item.runBTransaction?.id || null,
      }));

      const res = await fetch("/api/compare", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        fetchComparison();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to bulk set winners");
      }
    } catch (error) {
      toast.error("Failed to bulk set winners");
    } finally {
      setBulkLoading((prev) => {
        const next = new Set(prev);
        next.delete(typeKey);
        return next;
      });
    }
  };

  const toggleEmailPreview = async (emailId: string) => {
    if (expandedEmailPreviews.has(emailId)) {
      setExpandedEmailPreviews((prev) => {
        const next = new Set(prev);
        next.delete(emailId);
        return next;
      });
    } else {
      setExpandedEmailPreviews((prev) => new Set(prev).add(emailId));

      if (!emailContents.has(emailId)) {
        setLoadingEmails((prev) => new Set(prev).add(emailId));
        try {
          const res = await fetch(`/api/emails/${emailId}`);
          if (res.ok) {
            const data = await res.json();
            setEmailContents((prev) => {
              const next = new Map(prev);
              next.set(emailId, {
                bodyHtml: data.email.bodyHtml,
                bodyText: data.email.bodyText,
                subject: data.email.subject,
              });
              return next;
            });
          }
        } catch (error) {
          console.error("Failed to fetch email content:", error);
          toast.error("Failed to load email content");
        } finally {
          setLoadingEmails((prev) => {
            const next = new Set(prev);
            next.delete(emailId);
            return next;
          });
        }
      }
    }
  };

  const toggleExpanded = (emailId: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(emailId)) {
        next.delete(emailId);
      } else {
        next.add(emailId);
      }
      return next;
    });
  };

  const toggleTypeExpanded = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const getStatusBadge = (status: TransactionComparison["status"]) => {
    switch (status) {
      case "match":
        return (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Match
          </Badge>
        );
      case "different":
        return (
          <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Different
          </Badge>
        );
      case "only_a":
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            Only in {runALabel}
          </Badge>
        );
      case "only_b":
        return (
          <Badge variant="secondary" className="bg-purple-100 text-purple-800">
            Only in {runBLabel}
          </Badge>
        );
    }
  };

  const getWinnerBadge = (item: TransactionComparison) => {
    if (!item.winnerTransactionId) return null;

    if (item.winnerTransactionId === "tie") {
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-800 gap-1">
          <Equal className="h-3 w-3" />
          Tie
        </Badge>
      );
    }

    if (item.winnerTransactionId === item.runATransaction?.id) {
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-800 gap-1">
          <Trophy className="h-3 w-3" />
          {runALabel} wins
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="bg-green-100 text-green-800 gap-1">
        <Trophy className="h-3 w-3" />
        {runBLabel} wins
      </Badge>
    );
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "number" || !isNaN(Number(value))) {
      const num = Number(value);
      if (Number.isInteger(num)) return num.toLocaleString();
      return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    if (value instanceof Date || (typeof value === "string" && !isNaN(Date.parse(value)))) {
      try {
        return format(new Date(value as string), "MMM d, yyyy h:mm a");
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const formatTypeName = (type: string): string => {
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const renderTransactionDetail = (
    label: string,
    valueA: unknown,
    valueB: unknown,
    isDifferent: boolean
  ) => {
    const formattedA = formatValue(valueA);
    const formattedB = formatValue(valueB);

    return (
      <div
        className={`grid grid-cols-3 gap-4 py-2 px-3 rounded ${
          isDifferent ? "bg-yellow-50 border border-yellow-200" : ""
        }`}
      >
        <div className="text-sm font-medium text-gray-600">{label}</div>
        <div className={`text-sm ${isDifferent ? "font-semibold text-blue-700" : "text-gray-900"}`}>
          {formattedA}
        </div>
        <div className={`text-sm ${isDifferent ? "font-semibold text-purple-700" : "text-gray-900"}`}>
          {formattedB}
        </div>
      </div>
    );
  };

  const getRunLabel = (run: ExtractionRun) => {
    const modelName = run.modelId?.split("-").slice(0, 2).join(" ") || "Unknown";
    return `v${run.version} - ${modelName} (${run.transactionsCreated} txns)`;
  };

  // Short label for display in comparison UI (e.g., "v11 (Claude)")
  const getShortRunLabel = (run: ExtractionRun | null | undefined) => {
    if (!run) return "Unknown";
    const modelShort = run.modelId?.split("-")[0] || "Unknown";
    return `v${run.version} (${modelShort})`;
  };

  // Get labels for the two runs being compared
  const runALabel = comparison ? getShortRunLabel(comparison.runA) : "Run A";
  const runBLabel = comparison ? getShortRunLabel(comparison.runB) : "Run B";

  const renderComparisonItem = (item: TransactionComparison, showTypeColumn = false) => (
    <Card
      key={item.emailId}
      className={
        item.winnerTransactionId
          ? item.winnerTransactionId === "tie"
            ? "border-gray-300 bg-gray-50/50"
            : "border-green-300 bg-green-50/50"
          : ""
      }
    >
      <Collapsible open={expandedItems.has(item.emailId)} onOpenChange={() => toggleExpanded(item.emailId)}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <ChevronDown
                  className={`h-4 w-4 text-gray-400 transition-transform flex-shrink-0 ${
                    expandedItems.has(item.emailId) ? "rotate-180" : ""
                  }`}
                />
                <span className="text-sm font-medium truncate">
                  {item.emailSubject || "No subject"}
                </span>
                {showTypeColumn && (
                  <Badge variant="outline" className="text-xs">
                    {formatTypeName(item.runATransaction?.type || item.runBTransaction?.type || "unknown")}
                  </Badge>
                )}
                <Link
                  href={`/emails/${item.emailId}?from=compare&runA=${runAId}&runB=${runBId}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-gray-500 hover:text-blue-600"
                    title="View in email detail page"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
              <div className="flex items-center gap-2">
                {getWinnerBadge(item)}
                {getStatusBadge(item.status)}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            {/* Side by side comparison */}
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-3 gap-4 py-2 px-3 bg-gray-100 border-b font-medium text-sm">
                <div>Field</div>
                <div className="text-blue-700">{runALabel}</div>
                <div className="text-purple-700">{runBLabel}</div>
              </div>

              {renderTransactionDetail(
                "Type",
                item.runATransaction?.type,
                item.runBTransaction?.type,
                item.differences.includes("type")
              )}
              {renderTransactionDetail(
                "Amount",
                item.runATransaction?.amount,
                item.runBTransaction?.amount,
                item.differences.includes("amount")
              )}
              {renderTransactionDetail(
                "Currency",
                item.runATransaction?.currency,
                item.runBTransaction?.currency,
                item.differences.includes("currency")
              )}
              {renderTransactionDetail(
                "Symbol",
                item.runATransaction?.symbol,
                item.runBTransaction?.symbol,
                item.differences.includes("symbol")
              )}
              {renderTransactionDetail(
                "Quantity",
                item.runATransaction?.quantity,
                item.runBTransaction?.quantity,
                item.differences.includes("quantity")
              )}
              {renderTransactionDetail(
                "Price",
                item.runATransaction?.price,
                item.runBTransaction?.price,
                item.differences.includes("price")
              )}
              {renderTransactionDetail(
                "Fees",
                item.runATransaction?.fees,
                item.runBTransaction?.fees,
                item.differences.includes("fees")
              )}
              {renderTransactionDetail(
                "Date",
                item.runATransaction?.date,
                item.runBTransaction?.date,
                item.differences.includes("date")
              )}
              {renderTransactionDetail(
                "Confidence",
                item.runATransaction?.confidence
                  ? `${(parseFloat(item.runATransaction.confidence) * 100).toFixed(0)}%`
                  : null,
                item.runBTransaction?.confidence
                  ? `${(parseFloat(item.runBTransaction.confidence) * 100).toFixed(0)}%`
                  : null,
                false
              )}
            </div>

            {/* View Email button and preview */}
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 mb-3"
                onClick={() => toggleEmailPreview(item.emailId)}
              >
                {loadingEmails.has(item.emailId) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                {expandedEmailPreviews.has(item.emailId) ? "Hide" : "View"} Original Email
                {expandedEmailPreviews.has(item.emailId) ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>

              {expandedEmailPreviews.has(item.emailId) && (
                <div className="mb-4 border rounded-lg overflow-hidden bg-white">
                  <div className="px-3 py-2 bg-gray-100 border-b text-sm font-medium text-gray-700">
                    Original Email Content
                  </div>
                  {loadingEmails.has(item.emailId) ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                      <span className="ml-2 text-gray-500">Loading email...</span>
                    </div>
                  ) : emailContents.has(item.emailId) ? (
                    <div className="max-h-96 overflow-auto">
                      {emailContents.get(item.emailId)?.bodyHtml ? (
                        <iframe
                          srcDoc={emailContents.get(item.emailId)?.bodyHtml || ""}
                          sandbox="allow-same-origin"
                          className="w-full min-h-[300px] border-0"
                          style={{ height: "400px" }}
                          title="Email content"
                        />
                      ) : emailContents.get(item.emailId)?.bodyText ? (
                        <pre className="p-4 text-sm whitespace-pre-wrap font-mono text-gray-700">
                          {emailContents.get(item.emailId)?.bodyText}
                        </pre>
                      ) : (
                        <div className="p-4 text-sm text-gray-500 italic">
                          No email content available
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-gray-500 italic">
                      Failed to load email content
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Winner designation buttons */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-gray-600">Designate winner:</span>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={item.winnerTransactionId === item.runATransaction?.id ? "default" : "outline"}
                  className={`gap-1 ${
                    item.winnerTransactionId === item.runATransaction?.id
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "border-blue-300 text-blue-700 hover:bg-blue-50"
                  }`}
                  onClick={() =>
                    designateWinner(item.emailId, item.runATransaction?.id || null)
                  }
                  disabled={!item.runATransaction}
                >
                  <Trophy className="h-3 w-3" />
                  {runALabel}
                </Button>
                <Button
                  size="sm"
                  variant={item.winnerTransactionId === item.runBTransaction?.id ? "default" : "outline"}
                  className={`gap-1 ${
                    item.winnerTransactionId === item.runBTransaction?.id
                      ? "bg-purple-600 hover:bg-purple-700"
                      : "border-purple-300 text-purple-700 hover:bg-purple-50"
                  }`}
                  onClick={() =>
                    designateWinner(item.emailId, item.runBTransaction?.id || null)
                  }
                  disabled={!item.runBTransaction}
                >
                  <Trophy className="h-3 w-3" />
                  {runBLabel}
                </Button>
                <Button
                  size="sm"
                  variant={item.winnerTransactionId === "tie" ? "default" : "outline"}
                  className={`gap-1 ${
                    item.winnerTransactionId === "tie"
                      ? "bg-gray-600 hover:bg-gray-700"
                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                  onClick={() => designateWinner(item.emailId, "tie")}
                >
                  <Equal className="h-3 w-3" />
                  Tie
                </Button>
                {item.winnerTransactionId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-gray-500"
                    onClick={() => designateWinner(item.emailId, null)}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Scale className="h-8 w-8" />
              A/B Comparison
            </h1>
            <p className="text-gray-600 mt-1">
              Compare extraction results between two runs and designate winners
            </p>
          </div>
        </div>

        {/* Run Selector */}
        <Card className="mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              Select Runs to Compare
            </CardTitle>
            <CardDescription>
              Choose two extraction runs to see how they differ
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px] space-y-2">
                <label className="text-sm font-medium text-gray-700">Run A</label>
                <Select value={runAId} onValueChange={setRunAId}>
                  <SelectTrigger className="bg-blue-50 border-blue-200">
                    <SelectValue placeholder="Select first run" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((run) => (
                      <SelectItem key={run.id} value={run.id} disabled={run.id === runBId}>
                        {getRunLabel(run)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 min-w-[200px] space-y-2">
                <label className="text-sm font-medium text-gray-700">Run B</label>
                <Select value={runBId} onValueChange={setRunBId}>
                  <SelectTrigger className="bg-purple-50 border-purple-200">
                    <SelectValue placeholder="Select second run" />
                  </SelectTrigger>
                  <SelectContent>
                    {runs.map((run) => (
                      <SelectItem key={run.id} value={run.id} disabled={run.id === runAId}>
                        {getRunLabel(run)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={fetchComparison} disabled={loading || !runAId || !runBId} className="gap-2">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Scale className="h-4 w-4" />}
                Compare Runs
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Comparison Results */}
        {comparison && (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-gray-900">{comparison.summary.total}</div>
                  <p className="text-sm text-gray-500">Total Emails</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-green-600">{comparison.summary.matches}</div>
                  <p className="text-sm text-gray-500">Matching</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-yellow-600">{comparison.summary.different}</div>
                  <p className="text-sm text-gray-500">Different</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-blue-600">
                    {comparison.summary.onlyA + comparison.summary.onlyB}
                  </div>
                  <p className="text-sm text-gray-500">Exclusive</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <div className="text-2xl font-bold text-purple-600">{comparison.summary.agreementRate}%</div>
                  <p className="text-sm text-gray-500">Agreement</p>
                </CardContent>
              </Card>
            </div>

            {/* Progress of winners */}
            {(comparison.summary.different > 0 || comparison.summary.onlyA > 0 || comparison.summary.onlyB > 0) && (
              <Card className="mb-8 border-orange-200 bg-orange-50">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-orange-600" />
                      <span className="font-medium text-orange-800">
                        Winners Designated: {comparison.summary.winnersDesignated} /{" "}
                        {comparison.summary.different + comparison.summary.onlyA + comparison.summary.onlyB}
                      </span>
                    </div>
                    <div className="text-sm text-orange-600">
                      Use bulk actions or individual buttons to mark correct extractions
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Run Labels */}
            <div className="grid grid-cols-3 gap-4 mb-4 px-4">
              <div className="text-sm font-medium text-gray-500">Email</div>
              <div className="text-sm font-medium text-blue-700 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                {runALabel}
              </div>
              <div className="text-sm font-medium text-purple-700 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500" />
                {runBLabel}
              </div>
            </div>

            {/* SECTION: Different Transactions (grouped by type) */}
            {differentByType.size > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-yellow-600" />
                  Different Transactions ({comparison.summary.different})
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  These transactions exist in both runs but have different values. Grouped by transaction type.
                </p>

                <div className="space-y-4">
                  {Array.from(differentByType.entries()).map(([type, items]) => {
                    const resolvedCount = items.filter((i) => i.winnerTransactionId).length;
                    const typeKey = type;

                    return (
                      <Card key={type} className="border-yellow-200">
                        <Collapsible
                          open={expandedTypes.has(type)}
                          onOpenChange={() => toggleTypeExpanded(type)}
                        >
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover:bg-yellow-50 transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <ChevronDown
                                    className={`h-5 w-5 text-gray-400 transition-transform ${
                                      expandedTypes.has(type) ? "rotate-180" : ""
                                    }`}
                                  />
                                  <CardTitle className="text-lg">{formatTypeName(type)}</CardTitle>
                                  <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                                    {items.length} items
                                  </Badge>
                                  <Badge
                                    variant="secondary"
                                    className={
                                      resolvedCount === items.length
                                        ? "bg-green-100 text-green-800"
                                        : "bg-gray-100 text-gray-600"
                                    }
                                  >
                                    {resolvedCount}/{items.length} resolved
                                  </Badge>
                                </div>
                                {/* Bulk action buttons */}
                                <div
                                  className="flex items-center gap-2"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span className="text-xs text-gray-500 mr-2">Set all to:</span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                                    onClick={() => bulkDesignateWinner(items, "a")}
                                    disabled={bulkLoading.has(typeKey)}
                                  >
                                    {bulkLoading.has(typeKey) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <>
                                        <Trophy className="h-3 w-3 mr-1" />{runALabel}
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                                    onClick={() => bulkDesignateWinner(items, "b")}
                                    disabled={bulkLoading.has(typeKey)}
                                  >
                                    {bulkLoading.has(typeKey) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <>
                                        <Trophy className="h-3 w-3 mr-1" />{runBLabel}
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
                                    onClick={() => bulkDesignateWinner(items, "tie")}
                                    disabled={bulkLoading.has(typeKey)}
                                  >
                                    {bulkLoading.has(typeKey) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <>
                                        <Equal className="h-3 w-3 mr-1" />
                                        Tie
                                      </>
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0 space-y-3">
                              {items.map((item) => renderComparisonItem(item))}
                            </CardContent>
                          </CollapsibleContent>
                        </Collapsible>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECTION: Exclusive Transactions */}
            {exclusiveItems.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <ArrowLeftRight className="h-5 w-5 text-blue-600" />
                  Exclusive Transactions ({exclusiveItems.length})
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  These transactions exist in only one run. Designate which run&apos;s extraction is correct.
                </p>

                <div className="space-y-3">
                  {exclusiveItems.map((item) => renderComparisonItem(item, true))}
                </div>
              </div>
            )}

            {comparison.comparisons.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-gray-500">
                  No overlapping emails found between these runs.
                </CardContent>
              </Card>
            )}

            {comparison.summary.matches > 0 && (
              <Card className="border-green-200 bg-green-50/30">
                <CardContent className="py-6 text-center">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-green-600 mb-2" />
                  <p className="text-green-800 font-medium">
                    {comparison.summary.matches} transactions match perfectly between runs
                  </p>
                  <p className="text-sm text-green-600 mt-1">
                    These are not shown as they don&apos;t require review
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Empty state */}
        {!comparison && runs.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <Scale className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No extraction runs yet</h3>
              <p className="text-gray-500">
                Run some extractions first, then come back to compare results.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50">
          <Navigation />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center justify-center h-64">
              <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          </main>
        </div>
      }
    >
      <ComparePageContent />
    </Suspense>
  );
}
