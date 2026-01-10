"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { format } from "date-fns";
import {
  ArrowLeft,
  Mail,
  ChevronDown,
  ChevronRight,
  FileText,
  Code,
  Loader2,
  Layers,
  History,
} from "lucide-react";
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
  orderType: string | null;
  orderQuantity: string | null;
  orderPrice: string | null;
  orderStatus: string | null;
  timeInForce: string | null;
  referenceNumber: string | null;
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
}

interface RelatedTransaction {
  transaction: Transaction;
  runVersion: number | null;
  modelName: string | null;
  promptName: string | null;
  completedAt: string | null;
}

// All extractable fields with labels
const ALL_FIELDS: Array<{ key: string; label: string }> = [
  { key: "type", label: "Type" },
  { key: "date", label: "Date" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "description", label: "Description" },
  { key: "fees", label: "Fees" },
  { key: "symbol", label: "Symbol" },
  { key: "category", label: "Category" },
  { key: "quantity", label: "Quantity" },
  { key: "quantityExecuted", label: "Quantity Executed" },
  { key: "quantityRemaining", label: "Quantity Remaining" },
  { key: "price", label: "Price" },
  { key: "executionPrice", label: "Execution Price" },
  { key: "priceType", label: "Price Type" },
  { key: "limitPrice", label: "Limit Price" },
  { key: "contractSize", label: "Contract Size" },
  { key: "orderId", label: "Order ID" },
  { key: "orderType", label: "Order Type" },
  { key: "orderQuantity", label: "Order Quantity" },
  { key: "orderPrice", label: "Order Price" },
  { key: "orderStatus", label: "Order Status" },
  { key: "timeInForce", label: "Time In Force" },
  { key: "referenceNumber", label: "Reference Number" },
  { key: "partiallyExecuted", label: "Partially Executed" },
  { key: "executionTime", label: "Execution Time" },
  { key: "confidence", label: "Confidence" },
  { key: "llmModel", label: "AI Model" },
];

export default function TransactionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const transactionId = params.id as string;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [email, setEmail] = useState<Email | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [toAccount, setToAccount] = useState<Account | null>(null);
  const [sameRunTransactions, setSameRunTransactions] = useState<Transaction[]>([]);
  const [otherRunTransactions, setOtherRunTransactions] = useState<RelatedTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [emptyFieldsOpen, setEmptyFieldsOpen] = useState(false);
  const [emailTab, setEmailTab] = useState("rendered");

  const fetchTransaction = async () => {
    try {
      const res = await fetch(`/api/transactions/${transactionId}`);
      if (!res.ok) {
        router.push("/transactions");
        return;
      }
      const data = await res.json();
      setTransaction(data.transaction);
      setEmail(data.email);
      setAccount(data.account);
      setToAccount(data.toAccount);
      setSameRunTransactions(data.sameRunTransactions || []);
      setOtherRunTransactions(data.otherRunTransactions || []);
    } catch (error) {
      console.error("Failed to fetch transaction:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransaction();
  }, [transactionId]);

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "";

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

    if (key === "type") {
      return String(value).replace(/_/g, " ");
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

  const populatedFields = ALL_FIELDS.filter(f => !isFieldEmpty(f.key));
  const emptyFields = ALL_FIELDS.filter(f => isFieldEmpty(f.key));

  const renderEmailContent = () => {
    if (!email) return null;

    if (emailTab === "rendered" && email.bodyHtml) {
      return (
        <iframe
          ref={iframeRef}
          srcDoc={email.bodyHtml}
          className="w-full min-h-[500px] border-0 bg-white"
          sandbox="allow-same-origin"
          title="Email content"
          onLoad={() => {
            if (iframeRef.current) {
              const doc = iframeRef.current.contentDocument;
              if (doc) {
                const height = doc.body.scrollHeight;
                iframeRef.current.style.height = `${Math.max(500, height + 50)}px`;
              }
            }
          }}
        />
      );
    }

    if (emailTab === "text" || (!email.bodyHtml && emailTab === "rendered")) {
      return (
        <pre className="whitespace-pre-wrap font-mono text-sm p-4 bg-gray-50 rounded-lg overflow-auto max-h-[600px]">
          {email.bodyText || "No text content available"}
        </pre>
      );
    }

    if (emailTab === "html") {
      return (
        <pre className="whitespace-pre-wrap font-mono text-xs p-4 bg-gray-900 text-green-400 rounded-lg overflow-auto max-h-[600px]">
          {email.bodyHtml || "No HTML content available"}
        </pre>
      );
    }

    if (emailTab === "raw") {
      return (
        <pre className="whitespace-pre-wrap font-mono text-xs p-4 bg-gray-900 text-gray-300 rounded-lg overflow-auto max-h-[600px]">
          {email.rawContent || "No raw content available"}
        </pre>
      );
    }

    return null;
  };

  const formatTransactionAmount = (tx: Transaction) => {
    if (!tx.amount) return "-";
    const num = parseFloat(tx.amount);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: tx.currency || "USD",
    }).format(num);
  };

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </main>
    );
  }

  if (!transaction) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-12">
          <p className="text-gray-500">Transaction not found</p>
          <Button onClick={() => router.push("/transactions")} className="mt-4">
            Back to Transactions
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            <h1 className="text-2xl font-bold text-gray-900 capitalize">
              {transaction.type.replace(/_/g, " ")}
            </h1>
            <p className="text-gray-500 font-mono text-sm mt-1">{transaction.id}</p>
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

      <div className="space-y-6">
        {/* Section 1: Extracted Values */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Extracted Values</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Populated Fields */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {populatedFields.map(({ key, label }) => (
                <div key={key} className="space-y-1">
                  <dt className="text-sm text-gray-500">{label}</dt>
                  <dd className="text-sm font-medium text-gray-900 capitalize">
                    {formatValue(key, getFieldValue(key))}
                  </dd>
                </div>
              ))}
            </div>

            {/* Account Info */}
            {(account || toAccount) && (
              <div className="pt-4 border-t grid grid-cols-1 md:grid-cols-2 gap-4">
                {account && (
                  <div className="space-y-1">
                    <dt className="text-sm text-gray-500">Account</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {account.accountName || account.accountNumber || "Unknown"}
                      {account.institution && (
                        <span className="text-gray-500 font-normal"> ({account.institution})</span>
                      )}
                    </dd>
                  </div>
                )}
                {toAccount && (
                  <div className="space-y-1">
                    <dt className="text-sm text-gray-500">To Account</dt>
                    <dd className="text-sm font-medium text-gray-900">
                      {toAccount.accountName || toAccount.accountNumber || "Unknown"}
                      {toAccount.institution && (
                        <span className="text-gray-500 font-normal"> ({toAccount.institution})</span>
                      )}
                    </dd>
                  </div>
                )}
              </div>
            )}

            {/* Additional Data */}
            {transaction.data && Object.keys(transaction.data).length > 0 && (
              <div className="pt-4 border-t">
                <h4 className="text-sm text-gray-500 mb-2">Additional Data</h4>
                <pre className="text-xs bg-gray-50 p-3 rounded-lg overflow-auto max-h-32">
                  {JSON.stringify(transaction.data, null, 2)}
                </pre>
              </div>
            )}

            {/* Empty Fields (Collapsible) */}
            {emptyFields.length > 0 && (
              <Collapsible open={emptyFieldsOpen} onOpenChange={setEmptyFieldsOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 pt-4 border-t w-full">
                  {emptyFieldsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span>Empty Fields ({emptyFields.length})</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="flex flex-wrap gap-2">
                    {emptyFields.map(({ key, label }) => (
                      <Badge key={key} variant="outline" className="text-gray-400 font-normal">
                        {label}
                      </Badge>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>

        {/* Section 2: Original Email */}
        {email ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Original Email
                </CardTitle>
                <Link href={`/emails/${email.id}`}>
                  <Button variant="ghost" size="sm">
                    View Full Email
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Email Metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="text-gray-500">Subject:</span>{" "}
                  <span className="font-medium">{email.subject || "No subject"}</span>
                </div>
                <div>
                  <span className="text-gray-500">From:</span>{" "}
                  <span className="font-medium">{email.senderName || email.sender || "Unknown"}</span>
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

        {/* Section 3: Other Transactions from Same Email (Same Run) */}
        {sameRunTransactions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Layers className="h-5 w-5" />
                Other Transactions from This Email
                <Badge variant="secondary">{sameRunTransactions.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {sameRunTransactions.map((tx) => (
                  <Link
                    key={tx.id}
                    href={`/transactions/${tx.id}`}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="capitalize">
                        {tx.type.replace(/_/g, " ")}
                      </Badge>
                      {tx.symbol && (
                        <span className="font-mono text-sm">{tx.symbol}</span>
                      )}
                      {tx.date && (
                        <span className="text-sm text-gray-500">
                          {format(new Date(tx.date), "MMM d, yyyy")}
                        </span>
                      )}
                    </div>
                    <span className="font-medium">
                      {formatTransactionAmount(tx)}
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 4: Transactions from Different Runs */}
        {otherRunTransactions.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                Transactions from Other Extraction Runs
                <Badge variant="secondary">{otherRunTransactions.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {otherRunTransactions.map(({ transaction: tx, runVersion, modelName, promptName }) => (
                  <Link
                    key={tx.id}
                    href={`/transactions/${tx.id}`}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="capitalize">
                        {tx.type.replace(/_/g, " ")}
                      </Badge>
                      {tx.symbol && (
                        <span className="font-mono text-sm">{tx.symbol}</span>
                      )}
                      <span className="text-xs text-gray-500">
                        Run v{runVersion} • {modelName || "Unknown model"}
                      </span>
                    </div>
                    <span className="font-medium">
                      {formatTransactionAmount(tx)}
                    </span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
