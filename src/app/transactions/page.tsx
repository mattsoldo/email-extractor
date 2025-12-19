"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, Eye, RefreshCw, Download, FolderOpen, History, FileSpreadsheet, FileText, Mail } from "lucide-react";

interface EmailSet {
  id: string;
  name: string;
  emailCount: number;
}

interface ExtractionRun {
  id: string;
  name: string | null;
  version: number;
  transactionsCreated: number;
  completedAt: string | null;
  modelId: string | null;
}

interface Transaction {
  id: string;
  type: string;
  date: string;
  amount: string | null;
  currency: string;
  symbol: string | null;
  quantity: string | null;
  price: string | null;
  fees: string | null;
  data: Record<string, unknown>;
  sourceEmailId: string | null;
  account: {
    id: string;
    displayName: string;
    institution: string | null;
  } | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const transactionTypes = [
  "all",
  "dividend",
  "interest",
  "stock_trade",
  "option_trade",
  "wire_transfer_in",
  "wire_transfer_out",
  "funds_transfer",
  "deposit",
  "withdrawal",
  "rsu_vest",
  "rsu_release",
  "account_transfer",
  "fee",
  "other",
];

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [setFilter, setSetFilter] = useState<string>("all");
  const [runFilter, setRunFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] =
    useState<Transaction | null>(null);
  const [page, setPage] = useState(1);

  // Filter options
  const [emailSets, setEmailSets] = useState<EmailSet[]>([]);
  const [extractionRuns, setExtractionRuns] = useState<ExtractionRun[]>([]);

  // Fetch filter options
  useEffect(() => {
    async function fetchFilterOptions() {
      try {
        const [setsRes, runsRes] = await Promise.all([
          fetch("/api/email-sets"),
          fetch("/api/runs"),
        ]);
        const setsData = await setsRes.json();
        const runsData = await runsRes.json();
        setEmailSets(setsData.sets || []);
        setExtractionRuns(runsData.runs || []);
      } catch (error) {
        console.error("Failed to fetch filter options:", error);
      }
    }
    fetchFilterOptions();
  }, []);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
      });
      if (typeFilter !== "all") {
        params.set("type", typeFilter);
      }
      if (setFilter !== "all") {
        params.set("setId", setFilter);
      }
      if (runFilter !== "all") {
        params.set("runId", runFilter);
      }

      const res = await fetch(`/api/transactions?${params}`);
      const data = await res.json();

      setTransactions(data.transactions || []);
      setPagination(data.pagination);
      setTypeCounts(data.typeCounts || {});
    } catch (error) {
      console.error("Failed to fetch transactions:", error);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, setFilter, runFilter]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const formatAmount = (amount: string | null, currency: string) => {
    if (!amount) return "-";
    const num = parseFloat(amount);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(num);
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case "dividend":
      case "interest":
        return "bg-green-100 text-green-800";
      case "stock_trade":
      case "option_trade":
        return "bg-blue-100 text-blue-800";
      case "wire_transfer_in":
      case "deposit":
        return "bg-emerald-100 text-emerald-800";
      case "wire_transfer_out":
      case "withdrawal":
        return "bg-orange-100 text-orange-800";
      case "rsu_vest":
      case "rsu_release":
        return "bg-purple-100 text-purple-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const exportTransactions = async (fileFormat: "csv" | "excel") => {
    // Build export URL with current filters
    const params = new URLSearchParams({ format: fileFormat });
    if (setFilter !== "all") {
      params.set("setId", setFilter);
    }
    if (runFilter !== "all") {
      params.set("runId", runFilter);
    }

    // Trigger download
    window.location.href = `/api/transactions/export?${params}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Transactions</h1>
            <p className="text-gray-600 mt-1">
              View extracted financial transactions
            </p>
          </div>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  Export All
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportTransactions("csv")}>
                  <FileText className="h-4 w-4 mr-2" />
                  Export as CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportTransactions("excel")}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export for Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={fetchTransactions}
              variant="outline"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600">Set:</span>
            <Select value={setFilter} onValueChange={(v) => { setSetFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sets</SelectItem>
                {emailSets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600">Run:</span>
            <Select value={runFilter} onValueChange={(v) => { setRunFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All runs</SelectItem>
                {extractionRuns.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    <div className="flex items-center gap-2">
                      <span>{run.name || `Run v${run.version}`}</span>
                      <span className="text-gray-400">({run.transactionsCreated})</span>
                      {run.modelId && (
                        <span className="text-xs text-blue-600">
                          {run.modelId.includes("claude") ? "Claude" : run.modelId.includes("gpt") ? "GPT" : run.modelId}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Type:</span>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {transactionTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type === "all"
                      ? `All (${Object.values(typeCounts).reduce((a, b) => a + b, 0)})`
                      : `${type.replace(/_/g, " ")} (${typeCounts[type] || 0})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(setFilter !== "all" || runFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSetFilter("all");
                setRunFilter("all");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Transactions Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : transactions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      No transactions found
                    </TableCell>
                  </TableRow>
                ) : (
                  transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-gray-600">
                        {tx.date
                          ? format(new Date(tx.date), "MMM d, yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={getTypeBadgeColor(tx.type)}
                        >
                          {tx.type.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {tx.account?.displayName || "-"}
                        {tx.account?.institution && (
                          <span className="text-xs text-gray-500 block">
                            {tx.account.institution}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono">
                        {tx.symbol || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {tx.quantity || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {tx.price ? formatAmount(tx.price, tx.currency) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatAmount(tx.amount, tx.currency)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedTransaction(tx)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {tx.sourceEmailId && (
                            <Link href={`/emails/${tx.sourceEmailId}`}>
                              <Button variant="ghost" size="sm" title="View source email">
                                <Mail className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                        </div>
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
              {pagination.total} transactions
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

        {/* Transaction Detail Dialog */}
        <Dialog
          open={!!selectedTransaction}
          onOpenChange={() => setSelectedTransaction(null)}
        >
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="capitalize">
                {selectedTransaction?.type.replace(/_/g, " ")} Transaction
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Date:</span>{" "}
                    {selectedTransaction?.date
                      ? format(
                          new Date(selectedTransaction.date),
                          "MMM d, yyyy h:mm a"
                        )
                      : "-"}
                  </div>
                  <div>
                    <span className="text-gray-500">Amount:</span>{" "}
                    {formatAmount(
                      selectedTransaction?.amount || null,
                      selectedTransaction?.currency || "USD"
                    )}
                  </div>
                  <div>
                    <span className="text-gray-500">Account:</span>{" "}
                    {selectedTransaction?.account?.displayName || "-"}
                  </div>
                  <div>
                    <span className="text-gray-500">Symbol:</span>{" "}
                    {selectedTransaction?.symbol || "-"}
                  </div>
                  {selectedTransaction?.quantity && (
                    <div>
                      <span className="text-gray-500">Quantity:</span>{" "}
                      {selectedTransaction.quantity}
                    </div>
                  )}
                  {selectedTransaction?.price && (
                    <div>
                      <span className="text-gray-500">Price:</span>{" "}
                      {formatAmount(
                        selectedTransaction.price,
                        selectedTransaction.currency
                      )}
                    </div>
                  )}
                  {selectedTransaction?.fees && (
                    <div>
                      <span className="text-gray-500">Fees:</span>{" "}
                      {formatAmount(
                        selectedTransaction.fees,
                        selectedTransaction.currency
                      )}
                    </div>
                  )}
                </div>

                {selectedTransaction?.data &&
                  Object.keys(selectedTransaction.data).length > 0 && (
                    <div>
                      <h3 className="font-semibold mb-2">Additional Details</h3>
                      <pre className="p-3 bg-gray-100 rounded-lg text-xs overflow-auto">
                        {JSON.stringify(selectedTransaction.data, null, 2)}
                      </pre>
                    </div>
                  )}

                {/* Source Email Link */}
                {selectedTransaction?.sourceEmailId && (
                  <div className="pt-4 border-t">
                    <Link href={`/emails/${selectedTransaction.sourceEmailId}`}>
                      <Button variant="outline" className="gap-2 w-full">
                        <Mail className="h-4 w-4" />
                        View Source Email
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
