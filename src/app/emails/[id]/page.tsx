"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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

export default function EmailViewerPage() {
  const params = useParams();
  const router = useRouter();
  const emailId = params.id as string;

  const [email, setEmail] = useState<Email | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [transactionsByRun, setTransactionsByRun] = useState<Record<string, Transaction[]>>({});
  const [winnerTransactionId, setWinnerTransactionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("rendered");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchEmail = async () => {
    try {
      const res = await fetch(`/api/emails/${emailId}`);
      const data = await res.json();
      setEmail(data.email);
      setTransactions(data.transactions || []);
      setRuns(data.runs || []);
      setTransactionsByRun(data.transactionsByRun || {});
      setWinnerTransactionId(data.winnerTransactionId || null);
    } catch (error) {
      console.error("Failed to fetch email:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmail();
  }, [emailId]);

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
          <Button variant="ghost" size="sm" onClick={() => router.push("/emails")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
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
      </main>
    </div>
  );
}
