"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import {
  ArrowLeft,
  Mail,
  User,
  Calendar,
  FileText,
  Code,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  Info,
  Loader2,
  Trophy,
  Cpu,
  Scale,
  MessageSquare,
  Hash,
} from "lucide-react";
import { toast } from "sonner";

interface Email {
  id: string;
  filename: string;
  subject: string | null;
  sender: string | null;
  recipient: string | null;
  date: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rawContent: string | null;
  extractionStatus: string;
  extractionError: string | null;
  skipReason: string | null;
  informationalNotes: string | null;
  rawExtraction: Record<string, unknown> | null;
  winnerTransactionId: string | null;
}

interface Transaction {
  id: string;
  type: string;
  date: string;
  amount: string | null;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  confidence: string | null;
  extractionRunId: string | null;
}

interface ExtractionRun {
  id: string;
  modelId: string | null;
  version: number;
  startedAt: string;
}

interface EmailExtraction {
  id: string;
  emailId: string;
  runId: string;
  status: string;
  rawExtraction: Record<string, unknown> | null;
  confidence: string | null;
  processingTimeMs: number | null;
  transactionIds: string[] | null;
  createdAt: string;
  error: string | null;
  runVersion: number | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
  modelId: string | null;
  modelName: string | null;
  promptId: string | null;
  promptName: string | null;
}

interface DiscussionSummary {
  id: string;
  emailId: string;
  runId: string;
  summary: string;
  relatedReferenceNumbers: string[] | null;
  createdAt: string;
  runVersion: number | null;
}

export default function EmailViewerPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailId = params.id as string;

  // Check if we're in comparison mode from the compare page
  const fromCompare = searchParams.get("from") === "compare";
  const runAId = searchParams.get("runA");
  const runBId = searchParams.get("runB");

  const [email, setEmail] = useState<Email | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [transactionsByRun, setTransactionsByRun] = useState<Record<string, Transaction[]>>({});
  const [extractions, setExtractions] = useState<EmailExtraction[]>([]);
  const [discussionSummaries, setDiscussionSummaries] = useState<DiscussionSummary[]>([]);
  const [winnerTransactionId, setWinnerTransactionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("rendered");
  const [compareMode, setCompareMode] = useState(false);
  const [selectedExtractions, setSelectedExtractions] = useState<string[]>([]);
  const [comparisonData, setComparisonData] = useState<{
    runATransaction: Transaction | null;
    runBTransaction: Transaction | null;
    differences: string[];
  } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchEmail = async () => {
    try {
      const res = await fetch(`/api/emails/${emailId}`);
      const data = await res.json();
      setEmail(data.email);
      setTransactions(data.transactions || []);
      setRuns(data.runs || []);
      setTransactionsByRun(data.transactionsByRun || {});
      setExtractions(data.extractions || []);
      setDiscussionSummaries(data.discussionSummaries || []);
      setWinnerTransactionId(data.winnerTransactionId || null);
    } catch (error) {
      console.error("Failed to fetch email:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchComparisonData = async () => {
    if (!fromCompare || !runAId || !runBId) return;

    try {
      const res = await fetch(`/api/compare?runA=${runAId}&runB=${runBId}`);
      const data = await res.json();

      if (res.ok) {
        // Find the comparison for this specific email
        const emailComparison = data.comparisons.find(
          (c: any) => c.emailId === emailId
        );

        if (emailComparison) {
          setComparisonData({
            runATransaction: emailComparison.runATransaction,
            runBTransaction: emailComparison.runBTransaction,
            differences: emailComparison.differences,
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch comparison data:", error);
    }
  };

  useEffect(() => {
    fetchEmail();
    if (fromCompare) {
      fetchComparisonData();
    }
  }, [emailId, fromCompare]);

  // Update iframe content when email or tab changes
  useEffect(() => {
    if (iframeRef.current && email?.bodyHtml && activeTab === "rendered") {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                line-height: 1.5;
                color: #333;
                padding: 16px;
                margin: 0;
                background: white;
              }
              img { max-width: 100%; height: auto; }
              a { color: #2563eb; }
              table { max-width: 100%; }
            </style>
          </head>
          <body>${email.bodyHtml}</body>
          </html>
        `);
        doc.close();
      }
    }
  }, [email, activeTab]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle className="h-3 w-3" /> Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" /> Failed
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" /> Pending
          </Badge>
        );
      case "skipped":
        return (
          <Badge variant="outline" className="gap-1 text-yellow-600">
            <Ban className="h-3 w-3" /> Skipped
          </Badge>
        );
      case "informational":
        return (
          <Badge variant="outline" className="gap-1 text-blue-600">
            <Info className="h-3 w-3" /> Informational
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleReprocess = async () => {
    try {
      await fetch(`/api/emails/${emailId}`, { method: "POST" });
      fetchEmail();
    } catch (error) {
      console.error("Failed to reprocess:", error);
    }
  };

  const setWinner = async (transactionId: string | null) => {
    try {
      const res = await fetch(`/api/emails/${emailId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ winnerTransactionId: transactionId }),
      });
      if (res.ok) {
        setWinnerTransactionId(transactionId);
        toast.success(transactionId ? "Winner transaction set" : "Winner cleared");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to set winner");
      }
    } catch (error) {
      console.error("Failed to set winner:", error);
      toast.error("Failed to set winner");
    }
  };

  const getRunLabel = (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return `Run ${runId.slice(0, 8)}`;
    const modelName = run.modelId?.split("-").slice(0, 2).join(" ") || "Unknown model";
    return `v${run.version} - ${modelName}`;
  };

  const toggleCompareMode = () => {
    setCompareMode(!compareMode);
    setSelectedExtractions([]);
  };

  const toggleExtractionSelection = (extractionId: string) => {
    setSelectedExtractions((prev) => {
      if (prev.includes(extractionId)) {
        return prev.filter((id) => id !== extractionId);
      } else if (prev.length < 2) {
        return [...prev, extractionId];
      }
      return prev;
    });
  };

  const getSelectedExtractionData = () => {
    return selectedExtractions.map((id) => extractions.find((e) => e.id === id)).filter(Boolean) as EmailExtraction[];
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        </main>
      </div>
    );
  }

  if (!email) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="text-center py-20">
            <h2 className="text-xl font-semibold text-gray-900">Email not found</h2>
            <Button onClick={() => router.push("/emails")} className="mt-4">
              Back to Emails
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (fromCompare && runAId && runBId) {
                router.push(`/compare?runA=${runAId}&runB=${runBId}`);
              } else {
                router.push("/emails");
              }
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {fromCompare ? "Back to Comparison" : "Back"}
          </Button>
          <div className="flex-1" />
          {(email.extractionStatus === "failed" || email.extractionStatus === "skipped") && (
            <Button variant="outline" size="sm" onClick={handleReprocess}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Reprocess
            </Button>
          )}
        </div>

        {/* Email Card */}
        <Card className="mb-6">
          {/* Email Header */}
          <div className="border-b p-6">
            <div className="flex items-start justify-between mb-4">
              <h1 className="text-xl font-semibold text-gray-900 flex-1">
                {email.subject || "(no subject)"}
              </h1>
              {getStatusBadge(email.extractionStatus)}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <User className="h-4 w-4 text-gray-400" />
                <span className="font-medium">From:</span>
                <span>{email.sender || "(unknown)"}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Mail className="h-4 w-4 text-gray-400" />
                <span className="font-medium">To:</span>
                <span>{email.recipient || "(unknown)"}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span className="font-medium">Date:</span>
                <span>
                  {email.date
                    ? format(new Date(email.date), "MMMM d, yyyy 'at' h:mm a")
                    : "(unknown)"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <FileText className="h-4 w-4 text-gray-400" />
                <span className="font-medium">File:</span>
                <span className="font-mono text-xs truncate">{email.filename}</span>
              </div>
            </div>

            {email.extractionError && (
              <div className="mt-4 p-3 bg-red-50 rounded-lg text-sm text-red-700">
                <strong>Error:</strong> {email.extractionError}
              </div>
            )}

            {email.skipReason && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm text-yellow-700">
                <strong>Skipped:</strong> {email.skipReason}
              </div>
            )}

            {email.informationalNotes && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                {email.informationalNotes}
              </div>
            )}

            {/* Discussion Summaries - Evidence/Discussion Context */}
            {discussionSummaries.length > 0 && (
              <div className="mt-4 space-y-3">
                {discussionSummaries.map((summary) => (
                  <div
                    key={summary.id}
                    className="p-4 bg-purple-50 border border-purple-200 rounded-lg"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="gap-1 text-purple-700 border-purple-300 bg-purple-100">
                          <MessageSquare className="h-3 w-3" />
                          Evidence
                        </Badge>
                        {summary.runVersion && (
                          <span className="text-xs text-purple-500">
                            v{summary.runVersion}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-purple-400">
                        {format(new Date(summary.createdAt), "MMM d, yyyy")}
                      </span>
                    </div>
                    <p className="text-sm text-purple-900 leading-relaxed">
                      {summary.summary}
                    </p>
                    {summary.relatedReferenceNumbers && summary.relatedReferenceNumbers.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-purple-200">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-purple-600 font-medium flex items-center gap-1">
                            <Hash className="h-3 w-3" />
                            Reference Numbers:
                          </span>
                          {summary.relatedReferenceNumbers.map((ref, i) => (
                            <Badge
                              key={i}
                              variant="secondary"
                              className="text-xs bg-purple-100 text-purple-700 font-mono"
                            >
                              {ref}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Email Body */}
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="border-b px-4">
                <TabsList className="h-12">
                  {email.bodyHtml && (
                    <TabsTrigger value="rendered" className="gap-2">
                      <Mail className="h-4 w-4" />
                      Rendered
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="text" className="gap-2">
                    <FileText className="h-4 w-4" />
                    Plain Text
                  </TabsTrigger>
                  {email.rawContent && (
                    <TabsTrigger value="raw" className="gap-2">
                      <Code className="h-4 w-4" />
                      Raw Source
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>

              {email.bodyHtml && (
                <TabsContent value="rendered" className="m-0">
                  <iframe
                    ref={iframeRef}
                    className="w-full border-0"
                    style={{ minHeight: "500px" }}
                    sandbox="allow-same-origin"
                    title="Email content"
                  />
                </TabsContent>
              )}

              <TabsContent value="text" className="m-0">
                <div className="p-6">
                  <pre className="whitespace-pre-wrap font-mono text-sm text-gray-700 leading-relaxed">
                    {email.bodyText || "(no text content)"}
                  </pre>
                </div>
              </TabsContent>

              {email.rawContent && (
                <TabsContent value="raw" className="m-0">
                  <div className="p-4 bg-gray-50 max-h-[600px] overflow-auto">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-gray-600">
                      {email.rawContent}
                    </pre>
                  </div>
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>

        {/* Comparison View (when coming from compare page) */}
        {fromCompare && comparisonData && (
          <Card className="mb-6">
            <div className="p-4 border-b">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Scale className="h-5 w-5" />
                Run Comparison
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Compare extractions from the two selected runs
              </p>
            </div>
            <CardContent className="p-4">
              {/* Side by side comparison */}
              <div className="border rounded-lg overflow-hidden mb-4">
                {/* Header row */}
                <div className="grid grid-cols-3 gap-4 py-2 px-3 bg-gray-100 border-b font-medium text-sm">
                  <div>Field</div>
                  <div className="text-blue-700">Run A</div>
                  <div className="text-purple-700">Run B</div>
                </div>

                {/* Data rows */}
                {[
                  { label: "Type", key: "type" },
                  { label: "Amount", key: "amount" },
                  { label: "Currency", key: "currency" },
                  { label: "Symbol", key: "symbol" },
                  { label: "Quantity", key: "quantity" },
                  { label: "Price", key: "price" },
                  { label: "Fees", key: "fees" },
                  { label: "Date", key: "date" },
                ].map(({ label, key }) => {
                  const valueA = comparisonData.runATransaction?.[key as keyof Transaction];
                  const valueB = comparisonData.runBTransaction?.[key as keyof Transaction];
                  const isDifferent = comparisonData.differences.includes(key);

                  return (
                    <div
                      key={key}
                      className={`grid grid-cols-3 gap-4 py-2 px-3 rounded ${
                        isDifferent ? "bg-yellow-50 border border-yellow-200" : ""
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-600">{label}</div>
                      <div className={`text-sm ${isDifferent ? "font-semibold text-blue-700" : "text-gray-900"}`}>
                        {valueA || "-"}
                      </div>
                      <div className={`text-sm ${isDifferent ? "font-semibold text-purple-700" : "text-gray-900"}`}>
                        {valueB || "-"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Winner designation buttons */}
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-600">Designate winner:</span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={winnerTransactionId === comparisonData.runATransaction?.id ? "default" : "outline"}
                    className={`gap-1 ${
                      winnerTransactionId === comparisonData.runATransaction?.id
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "border-blue-300 text-blue-700 hover:bg-blue-50"
                    }`}
                    onClick={() => setWinner(comparisonData.runATransaction?.id || null)}
                    disabled={!comparisonData.runATransaction}
                  >
                    <Trophy className="h-3 w-3" />
                    Run A Wins
                  </Button>
                  <Button
                    size="sm"
                    variant={winnerTransactionId === comparisonData.runBTransaction?.id ? "default" : "outline"}
                    className={`gap-1 ${
                      winnerTransactionId === comparisonData.runBTransaction?.id
                        ? "bg-purple-600 hover:bg-purple-700"
                        : "border-purple-300 text-purple-700 hover:bg-purple-50"
                    }`}
                    onClick={() => setWinner(comparisonData.runBTransaction?.id || null)}
                    disabled={!comparisonData.runBTransaction}
                  >
                    <Trophy className="h-3 w-3" />
                    Run B Wins
                  </Button>
                  {winnerTransactionId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-gray-500"
                      onClick={() => setWinner(null)}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Extracted Transactions - Grouped by Run */}
        {transactions.length > 0 && (
          <Card>
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  Extracted Transactions
                </h2>
                {transactions.length > 1 && (
                  <div className="text-sm text-gray-500">
                    {Object.keys(transactionsByRun).length} extraction run(s)
                  </div>
                )}
              </div>
              {winnerTransactionId && (
                <div className="mt-2 flex items-center gap-2 text-sm text-green-700">
                  <Trophy className="h-4 w-4" />
                  Winner selected - this will be used as the canonical transaction
                </div>
              )}
            </div>
            <CardContent className="p-4">
              {Object.entries(transactionsByRun).length > 1 ? (
                // Multiple runs - show grouped
                <div className="space-y-6">
                  {Object.entries(transactionsByRun).map(([runId, runTxns]) => (
                    <div key={runId} className="border rounded-lg overflow-hidden">
                      <div className="bg-gray-100 px-4 py-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Cpu className="h-4 w-4 text-gray-500" />
                          <span className="font-medium text-sm">{getRunLabel(runId)}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {runTxns.length} transaction(s)
                        </Badge>
                      </div>
                      <div className="divide-y">
                        {runTxns.map((tx) => (
                          <div
                            key={tx.id}
                            className={`flex items-center justify-between p-3 ${
                              tx.id === winnerTransactionId
                                ? "bg-green-50 border-l-4 border-green-500"
                                : "hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {tx.id === winnerTransactionId ? (
                                <Trophy className="h-5 w-5 text-green-600" />
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-gray-400 hover:text-green-600"
                                  onClick={() => setWinner(tx.id)}
                                  title="Set as winner"
                                >
                                  <Trophy className="h-4 w-4" />
                                </Button>
                              )}
                              <Badge variant="secondary">{tx.type}</Badge>
                              {tx.symbol && (
                                <span className="font-medium text-gray-900">{tx.symbol}</span>
                              )}
                              {tx.quantity && (
                                <span className="text-sm text-gray-500">
                                  x{parseFloat(tx.quantity).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              {tx.confidence && (
                                <span className="text-xs text-gray-500">
                                  {(parseFloat(tx.confidence) * 100).toFixed(0)}% conf
                                </span>
                              )}
                              {tx.amount && (
                                <span className="font-medium text-gray-900">
                                  ${parseFloat(tx.amount).toLocaleString()}
                                </span>
                              )}
                              <span className="text-sm text-gray-500">
                                {format(new Date(tx.date), "MMM d, yyyy")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {winnerTransactionId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setWinner(null)}
                      className="text-gray-500"
                    >
                      Clear winner selection
                    </Button>
                  )}
                </div>
              ) : (
                // Single run - simple list
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        tx.id === winnerTransactionId
                          ? "bg-green-50 border border-green-200"
                          : "bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {transactions.length > 1 && (
                          tx.id === winnerTransactionId ? (
                            <Trophy className="h-5 w-5 text-green-600" />
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-gray-400 hover:text-green-600"
                              onClick={() => setWinner(tx.id)}
                              title="Set as winner"
                            >
                              <Trophy className="h-4 w-4" />
                            </Button>
                          )
                        )}
                        <Badge variant="secondary">{tx.type}</Badge>
                        {tx.symbol && (
                          <span className="font-medium text-gray-900">{tx.symbol}</span>
                        )}
                      </div>
                      <div className="text-right">
                        {tx.amount && (
                          <span className="font-medium text-gray-900">
                            ${parseFloat(tx.amount).toLocaleString()}
                          </span>
                        )}
                        <span className="text-sm text-gray-500 ml-2">
                          {format(new Date(tx.date), "MMM d, yyyy")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Raw Extraction Data */}
        {email.rawExtraction && (
          <Card className="mt-6">
            <div className="p-4 border-b">
              <h2 className="font-semibold text-gray-900">Raw Extraction Data</h2>
            </div>
            <CardContent className="p-4">
              <pre className="p-3 bg-gray-100 rounded-lg text-xs overflow-auto max-h-[300px]">
                {JSON.stringify(email.rawExtraction, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}

        {/* Extraction History */}
        {extractions.length > 0 && (
          <Card className="mt-6">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Extraction History
                    </h2>
                    <Badge variant="outline" className="text-xs">
                      {extractions.length} attempt(s)
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {compareMode
                      ? "Select 2 extractions to compare (click cards to select)"
                      : "All extraction attempts for this email across different runs"}
                  </p>
                </div>
                {extractions.length >= 2 && (
                  <div className="flex items-center gap-2">
                    {compareMode && selectedExtractions.length === 2 && (
                      <Button
                        size="sm"
                        onClick={() => {
                          // Comparison view will be shown below
                          const element = document.getElementById("comparison-view");
                          element?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        View Comparison
                      </Button>
                    )}
                    <Button
                      variant={compareMode ? "default" : "outline"}
                      size="sm"
                      onClick={toggleCompareMode}
                    >
                      {compareMode ? "Cancel Compare" : "Compare"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <CardContent className="p-4">
              <div className="space-y-4">
                {extractions.map((extraction) => {
                  const isSelected = selectedExtractions.includes(extraction.id);
                  const isSelectable = compareMode && (isSelected || selectedExtractions.length < 2);

                  return (
                  <div
                    key={extraction.id}
                    onClick={() => compareMode && isSelectable && toggleExtractionSelection(extraction.id)}
                    className={`relative border rounded-lg p-4 transition-all ${
                      compareMode && isSelectable
                        ? "cursor-pointer hover:border-blue-500"
                        : "hover:bg-gray-50"
                    } ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                        : ""
                    } ${
                      compareMode && !isSelectable && !isSelected
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {getStatusBadge(extraction.status)}
                        <div className="text-sm text-gray-500">
                          {format(new Date(extraction.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </div>
                      </div>
                      {extraction.runVersion && (
                        <Badge variant="outline" className="text-xs">
                          v{extraction.runVersion}
                        </Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-3">
                      {extraction.modelName && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Cpu className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">Model:</span>
                          <span className="font-mono text-xs">{extraction.modelName}</span>
                        </div>
                      )}
                      {extraction.promptName && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <FileText className="h-4 w-4 text-gray-400" />
                          <span className="font-medium">Prompt:</span>
                          <span className="truncate">{extraction.promptName}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-6 text-sm text-gray-600">
                      {extraction.confidence && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Confidence:</span>
                          <span className="font-mono">
                            {(parseFloat(extraction.confidence) * 100).toFixed(0)}%
                          </span>
                        </div>
                      )}
                      {extraction.processingTimeMs !== null && (
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>{extraction.processingTimeMs}ms</span>
                        </div>
                      )}
                      {extraction.transactionIds && extraction.transactionIds.length > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Transactions:</span>
                          <span>{extraction.transactionIds.length}</span>
                        </div>
                      )}
                    </div>

                    {extraction.error && (
                      <div className="mt-3 p-2 bg-red-50 rounded text-xs text-red-700">
                        <strong>Error:</strong> {extraction.error}
                      </div>
                    )}

                    {extraction.rawExtraction && (
                      <details className="mt-3">
                        <summary className="text-xs text-blue-600 cursor-pointer hover:underline">
                          View raw extraction data
                        </summary>
                        <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-[200px]">
                          {JSON.stringify(extraction.rawExtraction, null, 2)}
                        </pre>
                      </details>
                    )}

                    {compareMode && isSelected && (
                      <div className="absolute top-2 right-2">
                        <Badge variant="default" className="bg-blue-600">
                          Selected {selectedExtractions.indexOf(extraction.id) + 1}
                        </Badge>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Comparison View */}
        {compareMode && selectedExtractions.length === 2 && (
          <Card className="mt-6" id="comparison-view">
            <div className="p-4 border-b">
              <h2 className="font-semibold text-gray-900">Extraction Comparison</h2>
              <p className="text-sm text-gray-500 mt-1">
                Side-by-side comparison of selected extractions
              </p>
            </div>
            <CardContent className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getSelectedExtractionData().map((extraction, index) => (
                  <div key={extraction.id} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b">
                      <Badge variant="default" className="bg-blue-600">
                        Extraction {index + 1}
                      </Badge>
                      {getStatusBadge(extraction.status)}
                    </div>

                    <div className="space-y-3 text-sm">
                      <div>
                        <span className="font-medium text-gray-700">Date:</span>
                        <div className="text-gray-600 mt-1">
                          {format(new Date(extraction.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </div>
                      </div>

                      {extraction.runVersion && (
                        <div>
                          <span className="font-medium text-gray-700">Version:</span>
                          <div className="text-gray-600 mt-1">v{extraction.runVersion}</div>
                        </div>
                      )}

                      {extraction.modelName && (
                        <div>
                          <span className="font-medium text-gray-700">Model:</span>
                          <div className="text-gray-600 mt-1 font-mono text-xs">
                            {extraction.modelName}
                          </div>
                        </div>
                      )}

                      {extraction.promptName && (
                        <div>
                          <span className="font-medium text-gray-700">Prompt:</span>
                          <div className="text-gray-600 mt-1">{extraction.promptName}</div>
                        </div>
                      )}

                      <div className="pt-2 border-t space-y-2">
                        {extraction.confidence && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Confidence:</span>
                            <span className="font-medium">
                              {(parseFloat(extraction.confidence) * 100).toFixed(0)}%
                            </span>
                          </div>
                        )}
                        {extraction.processingTimeMs !== null && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Processing Time:</span>
                            <span className="font-medium">{extraction.processingTimeMs}ms</span>
                          </div>
                        )}
                        {extraction.transactionIds && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Transactions:</span>
                            <span className="font-medium">{extraction.transactionIds.length}</span>
                          </div>
                        )}
                      </div>

                      {extraction.error && (
                        <div className="p-2 bg-red-50 rounded text-xs text-red-700">
                          <strong>Error:</strong> {extraction.error}
                        </div>
                      )}

                      {extraction.rawExtraction && (
                        <details className="pt-2 border-t">
                          <summary className="text-xs text-blue-600 cursor-pointer hover:underline">
                            View raw data
                          </summary>
                          <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-[300px]">
                            {JSON.stringify(extraction.rawExtraction, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2">Key Differences</h3>
                <div className="text-sm text-blue-800 space-y-1">
                  {(() => {
                    const [ex1, ex2] = getSelectedExtractionData();
                    const diffs: string[] = [];

                    if (ex1.modelName !== ex2.modelName) {
                      diffs.push(`Different models: ${ex1.modelName || "unknown"} vs ${ex2.modelName || "unknown"}`);
                    }
                    if (ex1.promptName !== ex2.promptName) {
                      diffs.push(`Different prompts: ${ex1.promptName || "unknown"} vs ${ex2.promptName || "unknown"}`);
                    }
                    if (ex1.status !== ex2.status) {
                      diffs.push(`Different statuses: ${ex1.status} vs ${ex2.status}`);
                    }
                    if ((ex1.transactionIds?.length || 0) !== (ex2.transactionIds?.length || 0)) {
                      diffs.push(
                        `Different transaction counts: ${ex1.transactionIds?.length || 0} vs ${ex2.transactionIds?.length || 0}`
                      );
                    }
                    if (ex1.confidence && ex2.confidence) {
                      const diff = Math.abs(parseFloat(ex1.confidence) - parseFloat(ex2.confidence));
                      if (diff > 0.05) {
                        diffs.push(
                          `Confidence difference: ${(diff * 100).toFixed(1)}% (${(parseFloat(ex1.confidence) * 100).toFixed(0)}% vs ${(parseFloat(ex2.confidence) * 100).toFixed(0)}%)`
                        );
                      }
                    }

                    if (diffs.length === 0) {
                      return <div>No significant differences detected in metadata</div>;
                    }

                    return (
                      <ul className="list-disc list-inside space-y-1">
                        {diffs.map((diff, i) => (
                          <li key={i}>{diff}</li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
