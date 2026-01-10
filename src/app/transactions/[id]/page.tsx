"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  ArrowLeft,
  Mail,
  DollarSign,
  Calendar,
  Building2,
  TrendingUp,
  Hash,
  Percent,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FileText,
  Code,
  Cpu,
  Clock,
  ExternalLink,
  Loader2,
  Send,
  Edit3,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Transaction {
  id: string;
  type: string;
  date: string | null;
  amount: string | null;
  currency: string | null;
  description: string | null;
  fees: string | null;
  symbol: string | null;
  category: string | null;
  quantity: string | null;
  quantityExecuted: string | null;
  quantityRemaining: string | null;
  price: string | null;
  executionPrice: string | null;
  priceType: string | null;
  limitPrice: string | null;
  contractSize: number | null;
  orderId: string | null;
  orderQuantity: string | null;
  orderPrice: string | null;
  orderStatus: string | null;
  timeInForce: string | null;
  partiallyExecuted: boolean | null;
  executionTime: string | null;
  accountId: string | null;
  toAccountId: string | null;
  sourceEmailId: string | null;
  extractionRunId: string | null;
  confidence: string | null;
  llmModel: string | null;
  data: Record<string, unknown> | null;
  unclassifiedData: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface Email {
  id: string;
  filename: string;
  subject: string | null;
  sender: string | null;
  senderName: string | null;
  recipient: string | null;
  recipientName: string | null;
  cc: string | null;
  date: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rawContent: string | null;
}

interface Account {
  id: string;
  accountNumber: string | null;
  accountName: string | null;
  institution: string | null;
  accountType: string | null;
}

interface ExtractionRun {
  id: string;
  version: number;
  modelName: string | null;
  promptName: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface Prompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
}

// Field definitions for organized display
const FIELD_GROUPS = {
  core: {
    label: "Core Details",
    fields: ["type", "date", "amount", "currency", "description", "fees"],
  },
  security: {
    label: "Security & Symbol",
    fields: ["symbol", "category"],
  },
  quantity: {
    label: "Quantity",
    fields: ["quantity", "quantityExecuted", "quantityRemaining"],
  },
  pricing: {
    label: "Pricing",
    fields: ["price", "executionPrice", "priceType", "limitPrice"],
  },
  options: {
    label: "Options",
    fields: ["contractSize"],
  },
  order: {
    label: "Order Details",
    fields: ["orderId", "orderQuantity", "orderPrice", "orderStatus", "timeInForce", "partiallyExecuted", "executionTime"],
  },
  metadata: {
    label: "Extraction Metadata",
    fields: ["confidence", "llmModel", "extractionRunId", "createdAt", "updatedAt"],
  },
};

const FIELD_LABELS: Record<string, string> = {
  type: "Transaction Type",
  date: "Date",
  amount: "Amount",
  currency: "Currency",
  description: "Description",
  fees: "Fees",
  symbol: "Symbol",
  category: "Category",
  quantity: "Quantity",
  quantityExecuted: "Quantity Executed",
  quantityRemaining: "Quantity Remaining",
  price: "Price",
  executionPrice: "Execution Price",
  priceType: "Price Type",
  limitPrice: "Limit Price",
  contractSize: "Contract Size",
  orderId: "Order ID",
  orderQuantity: "Order Quantity",
  orderPrice: "Order Price",
  orderStatus: "Order Status",
  timeInForce: "Time In Force",
  partiallyExecuted: "Partially Executed",
  executionTime: "Execution Time",
  confidence: "Confidence",
  llmModel: "AI Model",
  extractionRunId: "Extraction Run",
  createdAt: "Created",
  updatedAt: "Updated",
};

export default function TransactionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const transactionId = params.id as string;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [email, setEmail] = useState<Email | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [toAccount, setToAccount] = useState<Account | null>(null);
  const [extractionRun, setExtractionRun] = useState<ExtractionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [emptyFieldsOpen, setEmptyFieldsOpen] = useState(false);
  const [emailTab, setEmailTab] = useState("rendered");

  // Re-analyze state
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [useCustomPrompt, setUseCustomPrompt] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);

  const fetchTransaction = async () => {
    try {
      const res = await fetch(`/api/transactions/${transactionId}`);
      if (!res.ok) {
        toast.error("Transaction not found");
        router.push("/transactions");
        return;
      }
      const data = await res.json();
      setTransaction(data.transaction);
      setEmail(data.email);
      setAccount(data.account);
      setToAccount(data.toAccount);
      setExtractionRun(data.extractionRun);
    } catch (error) {
      console.error("Failed to fetch transaction:", error);
      toast.error("Failed to load transaction");
    } finally {
      setLoading(false);
    }
  };

  const fetchPrompts = async () => {
    try {
      const res = await fetch("/api/prompts");
      const data = await res.json();
      setPrompts(data.prompts || []);
      if (data.defaultPromptId) {
        setSelectedPromptId(data.defaultPromptId);
        // Load the default prompt content
        const defaultPrompt = data.prompts?.find((p: Prompt) => p.id === data.defaultPromptId);
        if (defaultPrompt) {
          setCustomPrompt(defaultPrompt.content);
        }
      }
    } catch (error) {
      console.error("Failed to fetch prompts:", error);
    }
  };

  useEffect(() => {
    fetchTransaction();
    fetchPrompts();
  }, [transactionId]);

  // Update custom prompt when selected prompt changes
  useEffect(() => {
    if (selectedPromptId && !useCustomPrompt) {
      const prompt = prompts.find(p => p.id === selectedPromptId);
      if (prompt) {
        setCustomPrompt(prompt.content);
      }
    }
  }, [selectedPromptId, prompts, useCustomPrompt]);

  const handleReanalyze = async () => {
    if (!email) return;

    setReanalyzing(true);
    try {
      const res = await fetch(`/api/emails/${email.id}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptId: selectedPromptId,
          customPromptContent: useCustomPrompt ? customPrompt : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to re-analyze email");
        return;
      }

      toast.success("Email re-analyzed successfully");

      // Navigate to the email page to see all extractions
      router.push(`/emails/${email.id}`);
    } catch (error) {
      console.error("Re-analyze failed:", error);
      toast.error("Failed to re-analyze email");
    } finally {
      setReanalyzing(false);
    }
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return "";

    if (key === "date" || key === "createdAt" || key === "updatedAt") {
      try {
        return format(new Date(value as string), "MMM d, yyyy h:mm a");
      } catch {
        return String(value);
      }
    }

    if (key === "amount" || key === "fees" || key === "price" || key === "executionPrice" || key === "limitPrice" || key === "orderPrice") {
      const num = parseFloat(value as string);
      if (!isNaN(num)) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: transaction?.currency || "USD",
        }).format(num);
      }
    }

    if (key === "confidence") {
      const num = parseFloat(value as string);
      if (!isNaN(num)) {
        return `${(num * 100).toFixed(0)}%`;
      }
    }

    if (key === "partiallyExecuted") {
      return value ? "Yes" : "No";
    }

    return String(value);
  };

  const getFieldValue = (key: string): unknown => {
    if (!transaction) return null;
    return (transaction as unknown as Record<string, unknown>)[key];
  };

  const isFieldEmpty = (key: string): boolean => {
    const value = getFieldValue(key);
    return value === null || value === undefined || value === "";
  };

  const getPopulatedFields = (fields: string[]): string[] => {
    return fields.filter(f => !isFieldEmpty(f));
  };

  const getEmptyFields = (): string[] => {
    const allFields = Object.values(FIELD_GROUPS).flatMap(g => g.fields);
    return allFields.filter(f => isFieldEmpty(f));
  };

  const renderEmailContent = () => {
    if (!email) return null;

    if (emailTab === "rendered" && email.bodyHtml) {
      return (
        <iframe
          ref={iframeRef}
          srcDoc={email.bodyHtml}
          className="w-full min-h-[600px] border-0 bg-white"
          sandbox="allow-same-origin"
          title="Email content"
          onLoad={() => {
            if (iframeRef.current) {
              const doc = iframeRef.current.contentDocument;
              if (doc) {
                // Adjust iframe height to content
                const height = doc.body.scrollHeight;
                iframeRef.current.style.height = `${Math.max(600, height + 50)}px`;
              }
            }
          }}
        />
      );
    }

    if (emailTab === "text" || (!email.bodyHtml && emailTab === "rendered")) {
      return (
        <pre className="whitespace-pre-wrap font-mono text-sm p-4 bg-gray-50 rounded-lg overflow-auto max-h-[800px]">
          {email.bodyText || "No text content available"}
        </pre>
      );
    }

    if (emailTab === "html") {
      return (
        <pre className="whitespace-pre-wrap font-mono text-xs p-4 bg-gray-900 text-green-400 rounded-lg overflow-auto max-h-[800px]">
          {email.bodyHtml || "No HTML content available"}
        </pre>
      );
    }

    if (emailTab === "raw") {
      return (
        <pre className="whitespace-pre-wrap font-mono text-xs p-4 bg-gray-900 text-gray-300 rounded-lg overflow-auto max-h-[800px]">
          {email.rawContent || "No raw content available"}
        </pre>
      );
    }

    return null;
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </main>
    );
  }

  if (!transaction) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <p className="text-gray-500">Transaction not found</p>
          <Button onClick={() => router.push("/transactions")} className="mt-4">
            Back to Transactions
          </Button>
        </div>
      </main>
    );
  }

  const emptyFields = getEmptyFields();

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-4 gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900 capitalize">
                {transaction.type.replace(/_/g, " ")}
              </h1>
              <Badge variant="outline" className="text-sm">
                {transaction.type}
              </Badge>
              {transaction.confidence && (
                <Badge
                  variant={parseFloat(transaction.confidence) >= 0.8 ? "default" : "secondary"}
                  className="gap-1"
                >
                  <Percent className="h-3 w-3" />
                  {(parseFloat(transaction.confidence) * 100).toFixed(0)}% confidence
                </Badge>
              )}
            </div>
            <p className="text-gray-500 font-mono text-sm">{transaction.id}</p>
          </div>

          {transaction.amount && (
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900">
                {formatValue("amount", transaction.amount)}
              </div>
              {transaction.symbol && (
                <div className="text-lg text-gray-600 font-medium">
                  {transaction.symbol}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Transaction Details */}
        <div className="space-y-6">
          {/* Core Details */}
          {Object.entries(FIELD_GROUPS).map(([groupKey, group]) => {
            const populatedFields = getPopulatedFields(group.fields);
            if (populatedFields.length === 0) return null;

            return (
              <Card key={groupKey}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">{group.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-4">
                    {populatedFields.map(field => (
                      <div key={field} className="space-y-1">
                        <dt className="text-sm text-gray-500">{FIELD_LABELS[field] || field}</dt>
                        <dd className="text-sm font-medium text-gray-900">
                          {formatValue(field, getFieldValue(field))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            );
          })}

          {/* Account Information */}
          {(account || toAccount) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Account Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {account && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">From Account</h4>
                    <div className="p-3 bg-gray-50 rounded-lg space-y-1">
                      <p className="font-medium">{account.accountName || "Unnamed Account"}</p>
                      {account.institution && (
                        <p className="text-sm text-gray-600">{account.institution}</p>
                      )}
                      {account.accountNumber && (
                        <p className="text-sm text-gray-500 font-mono">
                          {account.accountNumber}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                {toAccount && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">To Account</h4>
                    <div className="p-3 bg-gray-50 rounded-lg space-y-1">
                      <p className="font-medium">{toAccount.accountName || "Unnamed Account"}</p>
                      {toAccount.institution && (
                        <p className="text-sm text-gray-600">{toAccount.institution}</p>
                      )}
                      {toAccount.accountNumber && (
                        <p className="text-sm text-gray-500 font-mono">
                          {toAccount.accountNumber}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Additional Data */}
          {(transaction.data || transaction.unclassifiedData) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Additional Data</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {transaction.data && Object.keys(transaction.data).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Structured Data</h4>
                    <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-48">
                      {JSON.stringify(transaction.data, null, 2)}
                    </pre>
                  </div>
                )}
                {transaction.unclassifiedData && Object.keys(transaction.unclassifiedData).length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Unclassified Data</h4>
                    <pre className="text-xs bg-amber-50 p-3 rounded-lg overflow-auto max-h-48">
                      {JSON.stringify(transaction.unclassifiedData, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Empty Fields (Collapsible) */}
          {emptyFields.length > 0 && (
            <Collapsible open={emptyFieldsOpen} onOpenChange={setEmptyFieldsOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer hover:bg-gray-50 transition-colors">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {emptyFieldsOpen ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                      Empty Fields
                      <Badge variant="secondary" className="ml-2">
                        {emptyFields.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {emptyFields.map(field => (
                        <Badge key={field} variant="outline" className="text-gray-400">
                          {FIELD_LABELS[field] || field}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}

          {/* Extraction Run Info */}
          {extractionRun && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Cpu className="h-5 w-5" />
                  Extraction Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Run Version</dt>
                    <dd className="font-medium">v{extractionRun.version}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Model</dt>
                    <dd className="font-medium">{extractionRun.modelName || transaction.llmModel || "Unknown"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Prompt</dt>
                    <dd className="font-medium">{extractionRun.promptName || "Default"}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Extracted At</dt>
                    <dd className="font-medium">
                      {extractionRun.completedAt
                        ? format(new Date(extractionRun.completedAt), "MMM d, yyyy h:mm a")
                        : "In progress"
                      }
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Email & Re-analyze */}
        <div className="space-y-6">
          {/* Source Email */}
          {email ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Source Email
                  </CardTitle>
                  <Link href={`/emails/${email.id}`}>
                    <Button variant="ghost" size="sm" className="gap-1">
                      <ExternalLink className="h-4 w-4" />
                      View Full
                    </Button>
                  </Link>
                </div>
                <CardDescription>
                  {email.subject || "No subject"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Email Metadata */}
                <div className="grid grid-cols-2 gap-3 text-sm p-3 bg-gray-50 rounded-lg">
                  <div>
                    <span className="text-gray-500">From:</span>{" "}
                    <span className="font-medium">
                      {email.senderName || email.sender || "Unknown"}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">To:</span>{" "}
                    <span className="font-medium">
                      {email.recipientName || email.recipient || "Unknown"}
                    </span>
                  </div>
                  {email.date && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Date:</span>{" "}
                      <span className="font-medium">
                        {format(new Date(email.date), "MMMM d, yyyy h:mm a")}
                      </span>
                    </div>
                  )}
                </div>

                {/* Email Content Tabs */}
                <Tabs value={emailTab} onValueChange={setEmailTab}>
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="rendered" className="gap-1">
                      <FileText className="h-3 w-3" />
                      Rendered
                    </TabsTrigger>
                    <TabsTrigger value="text" className="gap-1">
                      <FileText className="h-3 w-3" />
                      Text
                    </TabsTrigger>
                    <TabsTrigger value="html" className="gap-1">
                      <Code className="h-3 w-3" />
                      HTML
                    </TabsTrigger>
                    <TabsTrigger value="raw" className="gap-1">
                      <Code className="h-3 w-3" />
                      Raw
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value={emailTab} className="mt-4">
                    <div className="border rounded-lg overflow-hidden">
                      {renderEmailContent()}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                <Mail className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p>No source email linked to this transaction</p>
              </CardContent>
            </Card>
          )}

          {/* Re-analyze Section */}
          {email && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" />
                  Re-analyze Email
                </CardTitle>
                <CardDescription>
                  Extract transactions again with a different prompt or model
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Prompt Selection */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    Select Prompt
                  </label>
                  <Select
                    value={selectedPromptId}
                    onValueChange={(value) => {
                      setSelectedPromptId(value);
                      setUseCustomPrompt(false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a prompt" />
                    </SelectTrigger>
                    <SelectContent>
                      {prompts.map(prompt => (
                        <SelectItem key={prompt.id} value={prompt.id}>
                          <div className="flex items-center gap-2">
                            <span>{prompt.name}</span>
                            {prompt.isDefault && (
                              <Badge variant="secondary" className="text-xs">Default</Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom Prompt Toggle */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="useCustomPrompt"
                    checked={useCustomPrompt}
                    onChange={(e) => setUseCustomPrompt(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <label htmlFor="useCustomPrompt" className="text-sm text-gray-700 flex items-center gap-1">
                    <Edit3 className="h-4 w-4" />
                    Customize prompt
                  </label>
                </div>

                {/* Custom Prompt Editor */}
                {useCustomPrompt && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">
                      Custom Prompt Content
                    </label>
                    <Textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      rows={10}
                      className="font-mono text-sm"
                      placeholder="Enter your custom extraction prompt..."
                    />
                    <p className="text-xs text-gray-500">
                      The email content will be appended to this prompt for extraction.
                    </p>
                  </div>
                )}

                {/* Re-analyze Button */}
                <Button
                  onClick={handleReanalyze}
                  disabled={reanalyzing || !selectedPromptId}
                  className="w-full gap-2"
                >
                  {reanalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Re-analyzing...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Re-analyze Email
                    </>
                  )}
                </Button>

                <p className="text-xs text-gray-500 text-center">
                  This will create a new extraction. View all extractions on the{" "}
                  <Link href={`/emails/${email.id}`} className="text-blue-600 hover:underline">
                    email detail page
                  </Link>.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
