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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

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
  description: string | null;
  symbol: string | null;
  category: string | null;
  quantity: string | null;
  quantityExecuted: string | null;
  quantityRemaining: string | null;
  price: string | null;
  executionPrice: string | null;
  priceType: string | null;
  limitPrice: string | null;
  fees: string | null;
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
  dataKeyDifferences: string[];
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
  const router = useRouter();
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

  // Synthesis dialog state
  const [synthesizeDialogOpen, setSynthesizeDialogOpen] = useState(false);
  const [synthesizePrimaryRun, setSynthesizePrimaryRun] = useState<"a" | "b">("a");
  const [synthesizeName, setSynthesizeName] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);

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

  // Helper to get difference pattern key (which DATA keys are only in A vs only in B)
  // We only group by data key presence, NOT by which standard fields differ
  const getDifferencePattern = (item: TransactionComparison): string => {
    const dataA = (item.runATransaction?.data || {}) as Record<string, unknown>;
    const dataB = (item.runBTransaction?.data || {}) as Record<string, unknown>;

    // Flatten data to get actual keys
    const flattenData = (data: Record<string, unknown>): Set<string> => {
      const keys = new Set<string>();
      for (const [k, v] of Object.entries(data)) {
        if (/^\d+$/.test(k) && v && typeof v === "object" && "key" in v && "value" in v) {
          keys.add((v as { key: string }).key);
        } else if (!/^\d+$/.test(k)) {
          keys.add(k);
        }
      }
      return keys;
    };

    const keysA = flattenData(dataA);
    const keysB = flattenData(dataB);

    // Find keys only in A or only in B (this is what we group by)
    const onlyInA = [...keysA].filter((k) => !keysB.has(k)).sort();
    const onlyInB = [...keysB].filter((k) => !keysA.has(k)).sort();

    // Only group by data key differences, not standard field differences
    // This way transactions with same extra data keys get grouped together
    return `onlyA:${onlyInA.join(",")}|onlyB:${onlyInB.join(",")}`;
  };

  // Interface for grouped differences
  interface DifferenceGroup {
    pattern: string;
    fieldsOnlyInA: string[];
    fieldsOnlyInB: string[];
    commonDifferences: string[];
    items: TransactionComparison[];
  }

  // Compute grouped comparisons
  const { exclusiveItems, differentByType, differenceGroups } = useMemo(() => {
    if (!comparison) {
      return {
        exclusiveItems: [],
        differentByType: new Map<string, TransactionComparison[]>(),
        differenceGroups: new Map<string, Map<string, DifferenceGroup>>(),
      };
    }

    const exclusive = comparison.comparisons.filter(
      (c) => c.status === "only_a" || c.status === "only_b"
    );
    const different = comparison.comparisons.filter((c) => c.status === "different");

    // Group different by transaction type
    const byType = new Map<string, TransactionComparison[]>();
    // Also group by pattern within each type
    const byTypeAndPattern = new Map<string, Map<string, DifferenceGroup>>();

    for (const item of different) {
      const type = item.runATransaction?.type || item.runBTransaction?.type || "unknown";
      const pattern = getDifferencePattern(item);

      if (!byType.has(type)) {
        byType.set(type, []);
        byTypeAndPattern.set(type, new Map());
      }
      byType.get(type)!.push(item);

      const patternMap = byTypeAndPattern.get(type)!;
      if (!patternMap.has(pattern)) {
        // Parse the pattern to extract readable info
        // Format: "onlyA:field1,field2|onlyB:field3,field4"
        const parts = pattern.split("|");
        const onlyA = parts[0]?.replace("onlyA:", "").split(",").filter(Boolean) || [];
        const onlyB = parts[1]?.replace("onlyB:", "").split(",").filter(Boolean) || [];

        patternMap.set(pattern, {
          pattern,
          fieldsOnlyInA: onlyA,
          fieldsOnlyInB: onlyB,
          commonDifferences: [], // We no longer track standard field diffs in pattern
          items: [],
        });
      }
      patternMap.get(pattern)!.items.push(item);
    }

    return { exclusiveItems: exclusive, differentByType: byType, differenceGroups: byTypeAndPattern };
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

  const createSynthesizedRun = async () => {
    if (!comparison) return;

    setSynthesizing(true);
    try {
      const res = await fetch("/api/runs/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "comparison_winners",
          runAId,
          runBId,
          primaryRunId: synthesizePrimaryRun === "a" ? runAId : runBId,
          name: synthesizeName || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Created synthesized run: ${data.run.name}`);
        setSynthesizeDialogOpen(false);
        setSynthesizeName("");
        // Navigate to the new run
        router.push(`/runs/${data.run.id}`);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to create synthesized run");
      }
    } catch (error) {
      toast.error("Failed to create synthesized run");
    } finally {
      setSynthesizing(false);
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
                <div className="text-blue-700 flex items-center gap-2">
                  {runALabel}
                  {item.runATransaction && (
                    <Link
                      href={`/transactions/${item.runATransaction.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-500 hover:text-blue-700"
                      title="View transaction details"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
                <div className="text-purple-700 flex items-center gap-2">
                  {runBLabel}
                  {item.runBTransaction && (
                    <Link
                      href={`/transactions/${item.runBTransaction.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-purple-500 hover:text-purple-700"
                      title="View transaction details"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>

              {/* Core fields */}
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
                "Description",
                item.runATransaction?.description,
                item.runBTransaction?.description,
                item.differences.includes("description")
              )}
              {renderTransactionDetail(
                "Symbol",
                item.runATransaction?.symbol,
                item.runBTransaction?.symbol,
                item.differences.includes("symbol")
              )}
              {renderTransactionDetail(
                "Category",
                item.runATransaction?.category,
                item.runBTransaction?.category,
                item.differences.includes("category")
              )}
              {renderTransactionDetail(
                "Date",
                item.runATransaction?.date,
                item.runBTransaction?.date,
                item.differences.includes("date")
              )}

              {/* Quantity fields */}
              {renderTransactionDetail(
                "Quantity",
                item.runATransaction?.quantity,
                item.runBTransaction?.quantity,
                item.differences.includes("quantity")
              )}
              {renderTransactionDetail(
                "Qty Executed",
                item.runATransaction?.quantityExecuted,
                item.runBTransaction?.quantityExecuted,
                item.differences.includes("quantityExecuted")
              )}
              {renderTransactionDetail(
                "Qty Remaining",
                item.runATransaction?.quantityRemaining,
                item.runBTransaction?.quantityRemaining,
                item.differences.includes("quantityRemaining")
              )}

              {/* Price fields */}
              {renderTransactionDetail(
                "Price",
                item.runATransaction?.price,
                item.runBTransaction?.price,
                item.differences.includes("price")
              )}
              {renderTransactionDetail(
                "Execution Price",
                item.runATransaction?.executionPrice,
                item.runBTransaction?.executionPrice,
                item.differences.includes("executionPrice")
              )}
              {renderTransactionDetail(
                "Price Type",
                item.runATransaction?.priceType,
                item.runBTransaction?.priceType,
                item.differences.includes("priceType")
              )}
              {renderTransactionDetail(
                "Limit Price",
                item.runATransaction?.limitPrice,
                item.runBTransaction?.limitPrice,
                item.differences.includes("limitPrice")
              )}
              {renderTransactionDetail(
                "Fees",
                item.runATransaction?.fees,
                item.runBTransaction?.fees,
                item.differences.includes("fees")
              )}

              {/* Options fields */}
              {renderTransactionDetail(
                "Contract Size",
                item.runATransaction?.contractSize,
                item.runBTransaction?.contractSize,
                item.differences.includes("contractSize")
              )}

              {/* Order tracking fields */}
              {renderTransactionDetail(
                "Order ID",
                item.runATransaction?.orderId,
                item.runBTransaction?.orderId,
                item.differences.includes("orderId")
              )}
              {renderTransactionDetail(
                "Order Type",
                item.runATransaction?.orderType,
                item.runBTransaction?.orderType,
                item.differences.includes("orderType")
              )}
              {renderTransactionDetail(
                "Order Quantity",
                item.runATransaction?.orderQuantity,
                item.runBTransaction?.orderQuantity,
                item.differences.includes("orderQuantity")
              )}
              {renderTransactionDetail(
                "Order Price",
                item.runATransaction?.orderPrice,
                item.runBTransaction?.orderPrice,
                item.differences.includes("orderPrice")
              )}
              {renderTransactionDetail(
                "Order Status",
                item.runATransaction?.orderStatus,
                item.runBTransaction?.orderStatus,
                item.differences.includes("orderStatus")
              )}
              {renderTransactionDetail(
                "Time in Force",
                item.runATransaction?.timeInForce,
                item.runBTransaction?.timeInForce,
                item.differences.includes("timeInForce")
              )}
              {renderTransactionDetail(
                "Reference #",
                item.runATransaction?.referenceNumber,
                item.runBTransaction?.referenceNumber,
                item.differences.includes("referenceNumber")
              )}
              {renderTransactionDetail(
                "Partially Executed",
                item.runATransaction?.partiallyExecuted ? "Yes" : item.runATransaction?.partiallyExecuted === false ? "No" : null,
                item.runBTransaction?.partiallyExecuted ? "Yes" : item.runBTransaction?.partiallyExecuted === false ? "No" : null,
                item.differences.includes("partiallyExecuted")
              )}
              {renderTransactionDetail(
                "Execution Time",
                item.runATransaction?.executionTime,
                item.runBTransaction?.executionTime,
                item.differences.includes("executionTime")
              )}

              {/* Confidence - never flagged as different */}
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

              {/* Additional Data fields (from the data JSON) */}
              {(() => {
                const dataA = (item.runATransaction?.data || {}) as Record<string, unknown>;
                const dataB = (item.runBTransaction?.data || {}) as Record<string, unknown>;

                // Helper to flatten data - handles numeric keys with {key, value} objects
                const flattenData = (data: Record<string, unknown>): Record<string, unknown> => {
                  const result: Record<string, unknown> = {};
                  for (const [k, v] of Object.entries(data)) {
                    // Skip numeric keys that contain {key, value} objects - flatten them instead
                    if (/^\d+$/.test(k) && v && typeof v === "object" && "key" in v && "value" in v) {
                      const obj = v as { key: string; value: unknown };
                      result[obj.key] = obj.value;
                    } else if (/^\d+$/.test(k) && v && typeof v === "object") {
                      // Skip other numeric indexed objects (arrays serialized as objects)
                      continue;
                    } else {
                      result[k] = v;
                    }
                  }
                  return result;
                };

                const flatA = flattenData(dataA);
                const flatB = flattenData(dataB);
                const allKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);

                if (allKeys.size === 0) return null;

                return (
                  <>
                    <div className="py-2 px-3 bg-gray-50 border-t border-b text-sm font-medium text-gray-600">
                      Additional Data
                    </div>
                    {Array.from(allKeys).sort().map((key) =>
                      renderTransactionDetail(
                        key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim(),
                        flatA[key],
                        flatB[key],
                        item.dataKeyDifferences?.includes(key) || false
                      )
                    )}
                  </>
                );
              })()}
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
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-orange-600" />
                      <span className="font-medium text-orange-800">
                        Winners Designated: {comparison.summary.winnersDesignated} /{" "}
                        {comparison.summary.different + comparison.summary.onlyA + comparison.summary.onlyB}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-orange-600">
                        Use bulk actions or individual buttons to mark correct extractions
                      </span>
                      <Button
                        onClick={() => setSynthesizeDialogOpen(true)}
                        className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                      >
                        <Sparkles className="h-4 w-4" />
                        Create Synthesized Run
                      </Button>
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
                              {/* Show sub-groups by difference pattern if there are multiple patterns */}
                              {(() => {
                                const patterns = differenceGroups.get(type);
                                if (!patterns || patterns.size <= 1) {
                                  // Single pattern or no pattern grouping - show items directly
                                  return items.map((item) => renderComparisonItem(item));
                                }

                                // Multiple patterns - show as sub-groups
                                return Array.from(patterns.values()).map((group, groupIdx) => {
                                  const groupKey = `${type}-pattern-${groupIdx}`;
                                  const groupResolved = group.items.filter((i) => i.winnerTransactionId).length;
                                  const hasFieldDiffs = group.fieldsOnlyInA.length > 0 || group.fieldsOnlyInB.length > 0;

                                  return (
                                    <div key={groupKey} className="border rounded-lg bg-yellow-50/50 p-3 space-y-3">
                                      {/* Pattern description */}
                                      <div className="flex items-center justify-between flex-wrap gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <Badge variant="outline" className="bg-white">
                                            {group.items.length} items
                                          </Badge>
                                          <Badge
                                            variant="secondary"
                                            className={
                                              groupResolved === group.items.length
                                                ? "bg-green-100 text-green-800"
                                                : "bg-gray-100 text-gray-600"
                                            }
                                          >
                                            {groupResolved}/{group.items.length} resolved
                                          </Badge>
                                          {group.fieldsOnlyInA.length > 0 && (
                                            <span className="text-xs text-blue-700">
                                              Only in {runALabel}: {group.fieldsOnlyInA.join(", ")}
                                            </span>
                                          )}
                                          {group.fieldsOnlyInB.length > 0 && (
                                            <span className="text-xs text-purple-700">
                                              Only in {runBLabel}: {group.fieldsOnlyInB.join(", ")}
                                            </span>
                                          )}
                                          {group.commonDifferences.length > 0 && !hasFieldDiffs && (
                                            <span className="text-xs text-gray-600">
                                              Differs: {group.commonDifferences.join(", ")}
                                            </span>
                                          )}
                                        </div>
                                        {/* Bulk actions for this pattern group */}
                                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                          <span className="text-xs text-gray-500 mr-1">Set group:</span>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs px-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                                            onClick={() => bulkDesignateWinner(group.items, "a")}
                                            disabled={bulkLoading.has(groupKey)}
                                          >
                                            {bulkLoading.has(groupKey) ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <>{runALabel}</>
                                            )}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs px-2 border-purple-300 text-purple-700 hover:bg-purple-50"
                                            onClick={() => bulkDesignateWinner(group.items, "b")}
                                            disabled={bulkLoading.has(groupKey)}
                                          >
                                            {bulkLoading.has(groupKey) ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <>{runBLabel}</>
                                            )}
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 text-xs px-2 border-gray-300 text-gray-700 hover:bg-gray-50"
                                            onClick={() => bulkDesignateWinner(group.items, "tie")}
                                            disabled={bulkLoading.has(groupKey)}
                                          >
                                            Tie
                                          </Button>
                                        </div>
                                      </div>
                                      {/* Items in this pattern group */}
                                      <div className="space-y-2">
                                        {group.items.map((item) => renderComparisonItem(item))}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
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

        {/* Synthesize Dialog */}
        <Dialog open={synthesizeDialogOpen} onOpenChange={setSynthesizeDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" />
                Create Synthesized Run
              </DialogTitle>
              <DialogDescription>
                Create a new extraction run from the designated winners. For ties and
                unresolved comparisons, the primary run will be used as fallback.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Primary Run (fallback for ties/unresolved)</Label>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant={synthesizePrimaryRun === "a" ? "default" : "outline"}
                    className={`justify-start ${
                      synthesizePrimaryRun === "a"
                        ? "bg-blue-600 hover:bg-blue-700"
                        : "border-blue-300 text-blue-700 hover:bg-blue-50"
                    }`}
                    onClick={() => setSynthesizePrimaryRun("a")}
                  >
                    <CheckCircle2 className={`h-4 w-4 mr-2 ${synthesizePrimaryRun === "a" ? "opacity-100" : "opacity-0"}`} />
                    <span>{runALabel}</span>
                    <span className="ml-2 text-xs opacity-75">
                      ({comparison?.runA.transactionsCreated} transactions)
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant={synthesizePrimaryRun === "b" ? "default" : "outline"}
                    className={`justify-start ${
                      synthesizePrimaryRun === "b"
                        ? "bg-purple-600 hover:bg-purple-700"
                        : "border-purple-300 text-purple-700 hover:bg-purple-50"
                    }`}
                    onClick={() => setSynthesizePrimaryRun("b")}
                  >
                    <CheckCircle2 className={`h-4 w-4 mr-2 ${synthesizePrimaryRun === "b" ? "opacity-100" : "opacity-0"}`} />
                    <span>{runBLabel}</span>
                    <span className="ml-2 text-xs opacity-75">
                      ({comparison?.runB.transactionsCreated} transactions)
                    </span>
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="synth-name">Run Name (optional)</Label>
                <Input
                  id="synth-name"
                  placeholder="e.g., Best of Claude vs GPT"
                  value={synthesizeName}
                  onChange={(e) => setSynthesizeName(e.target.value)}
                />
              </div>

              {comparison && (
                <div className="rounded-lg border p-3 bg-gray-50 text-sm space-y-1">
                  <p className="font-medium text-gray-700">Summary:</p>
                  <p className="text-gray-600">
                    {comparison.summary.winnersDesignated} winners designated,{" "}
                    {comparison.summary.different + comparison.summary.onlyA + comparison.summary.onlyB - comparison.summary.winnersDesignated} using fallback
                  </p>
                  <p className="text-gray-600">
                    {comparison.summary.matches} matching transactions will be included
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSynthesizeDialogOpen(false)}
                disabled={synthesizing}
              >
                Cancel
              </Button>
              <Button
                onClick={createSynthesizedRun}
                disabled={synthesizing}
                className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                {synthesizing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Create Run
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
