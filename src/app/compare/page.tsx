"use client";

import { useEffect, useState, useCallback, Suspense, useMemo, useRef } from "react";
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
  Pencil,
  Check,
  X,
  Ban,
  MessageSquare,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

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
  fieldOverrides: Record<string, unknown> | null;
  // Multi-transaction tracking (always false for items in comparisons array now)
  runATransactionCount: number;
  runBTransactionCount: number;
  hasMultipleTransactions: boolean;
}

// For emails with multiple transactions - shows all transactions from both runs
interface MultiTransactionEmail {
  emailId: string;
  emailSubject: string | null;
  winnerTransactionIds: string[]; // Array of selected transaction IDs
  fieldOverrides: Record<string, unknown> | null;
  runATransactions: Transaction[];
  runBTransactions: Transaction[];
}

interface ComparisonSummary {
  total: number;
  matches: number;
  different: number;
  onlyA: number;
  onlyB: number;
  winnersDesignated: number;
  excluded: number;
  discussions: number;
  multiTransactionCount: number;
  multiTransactionResolved: number;
  agreementRate: number;
}

interface ComparisonResult {
  runA: ExtractionRun;
  runB: ExtractionRun;
  summary: ComparisonSummary;
  comparisons: TransactionComparison[];
  multiTransactionEmails: MultiTransactionEmail[];
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
  const [expandedPatternGroups, setExpandedPatternGroups] = useState<Set<string>>(new Set());

  // Synthesis dialog state
  const [synthesizeDialogOpen, setSynthesizeDialogOpen] = useState(false);
  const [synthesizePrimaryRun, setSynthesizePrimaryRun] = useState<"a" | "b">("a");
  const [synthesizeName, setSynthesizeName] = useState("");
  const [synthesizing, setSynthesizing] = useState(false);

  // Field editing state
  // Key format: `${emailId}:${fieldName}` for tracking which field is being edited
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [savingOverride, setSavingOverride] = useState(false);

  // Track which comparison we've auto-assigned exclusive winners for
  const autoAssignedForRef = useRef<string | null>(null);

  // Filter state: "all" | "run_a" | "run_b" | "tie" | "exclude" | "discussion" | "pending"
  const [winnerFilter, setWinnerFilter] = useState<string>("all");

  // Helper to detect likely discussions by email subject
  const isLikelyDiscussion = (subject: string | null): boolean => {
    if (!subject) return false;
    const lower = subject.toLowerCase().trim();
    return lower.startsWith("re:") || lower.startsWith("fw:") || lower.startsWith("fwd:");
  };

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

  // Numeric fields that are important to highlight
  const NUMERIC_FIELDS = new Set([
    "amount", "quantity", "quantityExecuted", "quantityRemaining",
    "price", "executionPrice", "limitPrice", "fees",
    "orderQuantity", "orderPrice", "contractSize"
  ]);

  // Helper to check if a value is empty (null, undefined, or empty string)
  const isEmptyValue = (val: unknown): boolean => {
    return val === null || val === undefined || val === "";
  };

  // Helper to check if an item has a "real" numeric difference (both values exist)
  const hasRealNumericDiff = (item: TransactionComparison, fieldName: string): boolean => {
    if (!item.differences.includes(fieldName)) return false;
    if (!NUMERIC_FIELDS.has(fieldName)) return false;

    const valA = item.runATransaction?.[fieldName as keyof Transaction];
    const valB = item.runBTransaction?.[fieldName as keyof Transaction];

    // Only count as a numeric difference if both sides have a value
    return !isEmptyValue(valA) && !isEmptyValue(valB);
  };

  // Get all real numeric differences for an item
  const getRealNumericDiffs = (item: TransactionComparison): string[] => {
    return item.differences.filter(d => hasRealNumericDiff(item, d));
  };

  // Interface for grouped differences
  interface DifferenceGroup {
    pattern: string;
    fieldsOnlyInA: string[];
    fieldsOnlyInB: string[];
    commonDifferences: string[];
    items: TransactionComparison[];
    hasNumericDifferences: boolean;
    numericDiffFields: string[];
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
          commonDifferences: [],
          items: [],
          hasNumericDifferences: false,
          numericDiffFields: [],
        });
      }

      // Check if this item has real numeric field differences (both values exist)
      const numericDiffs = getRealNumericDiffs(item);
      if (numericDiffs.length > 0) {
        const group = patternMap.get(pattern)!;
        group.hasNumericDifferences = true;
        // Add any new numeric diff fields we haven't seen yet
        for (const field of numericDiffs) {
          if (!group.numericDiffFields.includes(field)) {
            group.numericDiffFields.push(field);
          }
        }
      }

      patternMap.get(pattern)!.items.push(item);
    }

    return { exclusiveItems: exclusive, differentByType: byType, differenceGroups: byTypeAndPattern };
  }, [comparison]);

  // Helper to check if two transactions match (for multi-transaction pairing)
  const transactionsMatch = (a: Transaction | null, b: Transaction | null): boolean => {
    if (!a || !b) return false;
    // Core fields that must match
    if (a.type !== b.type) return false;
    if (a.amount !== b.amount) return false;
    if (a.symbol !== b.symbol) return false;
    // Date should match (compare date portion only)
    const dateA = a.date ? new Date(a.date).toISOString().split("T")[0] : null;
    const dateB = b.date ? new Date(b.date).toISOString().split("T")[0] : null;
    if (dateA !== dateB) return false;
    return true;
  };

  // Analyze multi-transaction emails for matches
  const multiTxnAnalysis = useMemo(() => {
    if (!comparison?.multiTransactionEmails) {
      return { withMatches: [], withoutMatches: [] };
    }

    const withMatches: Array<MultiTransactionEmail & { matchedPairs: Array<{ a: Transaction; b: Transaction }> }> = [];
    const withoutMatches: MultiTransactionEmail[] = [];

    for (const email of comparison.multiTransactionEmails) {
      const matchedPairs: Array<{ a: Transaction; b: Transaction }> = [];
      const usedA = new Set<string>();
      const usedB = new Set<string>();

      // Try to find matching pairs
      for (const txnA of email.runATransactions) {
        for (const txnB of email.runBTransactions) {
          if (usedA.has(txnA.id) || usedB.has(txnB.id)) continue;
          if (transactionsMatch(txnA, txnB)) {
            matchedPairs.push({ a: txnA, b: txnB });
            usedA.add(txnA.id);
            usedB.add(txnB.id);
          }
        }
      }

      if (matchedPairs.length > 0) {
        withMatches.push({ ...email, matchedPairs });
      } else {
        withoutMatches.push(email);
      }
    }

    return { withMatches, withoutMatches };
  }, [comparison?.multiTransactionEmails]);

  // Calculate winner stats by run
  const winnerStats = useMemo(() => {
    if (!comparison) {
      return {
        runAWins: 0,
        runBWins: 0,
        ties: 0,
        excluded: 0,
        discussions: 0,
        pending: 0,
        likelyDiscussions: 0,
        multiTransaction: 0,
        multiTxnWithMatches: 0,
        multiTxnWithoutMatches: 0,
        total: 0,
      };
    }

    // Only count non-matching comparisons (those that need decisions)
    const needsDecision = comparison.comparisons.filter((c) => c.status !== "match");

    let runAWins = 0;
    let runBWins = 0;
    let ties = 0;
    let excluded = 0;
    let discussions = 0;
    let pending = 0;
    let likelyDiscussions = 0;

    for (const item of needsDecision) {
      // Count likely discussions
      if (isLikelyDiscussion(item.emailSubject)) {
        likelyDiscussions++;
      }

      if (!item.winnerTransactionId) {
        pending++;
      } else if (item.winnerTransactionId === "tie") {
        ties++;
      } else if (item.winnerTransactionId === "exclude") {
        excluded++;
      } else if (item.winnerTransactionId === "discussion") {
        discussions++;
      } else if (item.winnerTransactionId === item.runATransaction?.id) {
        runAWins++;
      } else if (item.winnerTransactionId === item.runBTransaction?.id) {
        runBWins++;
      }
    }

    return {
      runAWins,
      runBWins,
      ties,
      excluded,
      discussions,
      pending,
      likelyDiscussions,
      multiTransaction: comparison.summary.multiTransactionCount || 0,
      multiTxnWithMatches: multiTxnAnalysis.withMatches.length,
      multiTxnWithoutMatches: multiTxnAnalysis.withoutMatches.length,
      total: needsDecision.length,
    };
  }, [comparison, multiTxnAnalysis]);

  // Filter comparisons based on winner filter
  const filteredComparisons = useMemo(() => {
    if (!comparison) return [];
    if (winnerFilter === "all") return comparison.comparisons;

    return comparison.comparisons.filter((item) => {
      // Always exclude matches from filtering (they're not shown anyway)
      if (item.status === "match") return true;

      switch (winnerFilter) {
        case "run_a":
          return item.winnerTransactionId === item.runATransaction?.id;
        case "run_b":
          return item.winnerTransactionId === item.runBTransaction?.id;
        case "tie":
          return item.winnerTransactionId === "tie";
        case "exclude":
          return item.winnerTransactionId === "exclude";
        case "discussion":
          return item.winnerTransactionId === "discussion";
        case "likely_discussion":
          return isLikelyDiscussion(item.emailSubject) && item.winnerTransactionId !== "discussion";
        case "pending":
          return !item.winnerTransactionId;
        default:
          return true;
      }
    });
  }, [comparison, winnerFilter]);

  // Recompute grouped comparisons with filter applied
  const { filteredExclusiveItems, filteredDifferentByType, filteredDifferenceGroups } = useMemo(() => {
    if (!comparison) {
      return {
        filteredExclusiveItems: [],
        filteredDifferentByType: new Map<string, TransactionComparison[]>(),
        filteredDifferenceGroups: new Map<string, Map<string, DifferenceGroup>>(),
      };
    }

    const exclusive = filteredComparisons.filter(
      (c) => c.status === "only_a" || c.status === "only_b"
    );
    const different = filteredComparisons.filter((c) => c.status === "different");

    // Group different by transaction type
    const byType = new Map<string, TransactionComparison[]>();
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
        const parts = pattern.split("|");
        const onlyA = parts[0]?.replace("onlyA:", "").split(",").filter(Boolean) || [];
        const onlyB = parts[1]?.replace("onlyB:", "").split(",").filter(Boolean) || [];

        patternMap.set(pattern, {
          pattern,
          fieldsOnlyInA: onlyA,
          fieldsOnlyInB: onlyB,
          commonDifferences: [],
          items: [],
          hasNumericDifferences: false,
          numericDiffFields: [],
        });
      }

      const numericDiffs = getRealNumericDiffs(item);
      if (numericDiffs.length > 0) {
        const group = patternMap.get(pattern)!;
        group.hasNumericDifferences = true;
        for (const field of numericDiffs) {
          if (!group.numericDiffFields.includes(field)) {
            group.numericDiffFields.push(field);
          }
        }
      }

      patternMap.get(pattern)!.items.push(item);
    }

    return {
      filteredExclusiveItems: exclusive,
      filteredDifferentByType: byType,
      filteredDifferenceGroups: byTypeAndPattern,
    };
  }, [filteredComparisons, comparison]);

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

  // Auto-assign winners for exclusive transactions when comparison loads
  useEffect(() => {
    if (!comparison || !runAId || !runBId) return;

    // Create a unique key for this comparison
    const comparisonKey = `${runAId}-${runBId}`;

    // Skip if we've already auto-assigned for this comparison
    if (autoAssignedForRef.current === comparisonKey) return;

    // Find exclusive items without winners
    const exclusiveWithoutWinners = comparison.comparisons.filter(
      (c) =>
        (c.status === "only_a" || c.status === "only_b") &&
        !c.winnerTransactionId
    );

    if (exclusiveWithoutWinners.length === 0) {
      // Mark as processed even if nothing to do
      autoAssignedForRef.current = comparisonKey;
      return;
    }

    // Mark as processed before making the API call
    autoAssignedForRef.current = comparisonKey;

    // Build updates to auto-assign winners
    const updates = exclusiveWithoutWinners.map((item) => ({
      emailId: item.emailId,
      winnerTransactionId: item.runATransaction?.id || item.runBTransaction?.id || null,
    }));

    // Batch update
    fetch("/api/compare", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    })
      .then((res) => {
        if (res.ok) {
          // Silently refresh to show updated winners
          fetch(`/api/compare?runA=${runAId}&runB=${runBId}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.comparisons) {
                setComparison(data);
              }
            });
        }
      })
      .catch((err) => {
        console.error("Failed to auto-assign exclusive winners:", err);
      });
  }, [comparison, runAId, runBId]);

  const fetchComparison = async (preserveExpandedState = false) => {
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
        // Only reset expanded state when doing a fresh comparison, not on refresh
        if (!preserveExpandedState) {
          setExpandedTypes(new Set());
          setExpandedPatternGroups(new Set());
        }
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
        fetchComparison(true); // Preserve expanded state
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to set winner");
      }
    } catch (error) {
      toast.error("Failed to set winner");
    }
  };

  // Toggle a transaction as winner for multi-transaction emails (can select multiple)
  const toggleMultiWinner = async (
    emailId: string,
    transactionId: string
  ) => {
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId,
          winnerTransactionId: transactionId,
          toggleWinner: true,
        }),
      });

      if (res.ok) {
        fetchComparison(true); // Preserve expanded state
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to toggle winner");
      }
    } catch (error) {
      toast.error("Failed to toggle winner");
    }
  };

  // Set special value (exclude/discussion) for multi-transaction emails
  const setMultiSpecialValue = async (
    emailId: string,
    value: "exclude" | "discussion" | null
  ) => {
    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId,
          winnerTransactionId: value,
          toggleWinner: true,
        }),
      });

      if (res.ok) {
        const message = !value
          ? "Cleared"
          : value === "exclude"
            ? "Marked as excluded"
            : "Marked as discussion";
        toast.success(message);
        fetchComparison(true);
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update");
      }
    } catch (error) {
      toast.error("Failed to update");
    }
  };

  const bulkDesignateWinner = async (
    items: TransactionComparison[],
    winnerType: "a" | "b" | "tie" | "exclude" | "discussion"
  ) => {
    const typeKey = items[0]?.runATransaction?.type || items[0]?.runBTransaction?.type || "unknown";
    setBulkLoading((prev) => new Set(prev).add(typeKey));

    try {
      const updates = items.map((item) => ({
        emailId: item.emailId,
        winnerTransactionId:
          winnerType === "tie"
            ? "tie"
            : winnerType === "exclude"
              ? "exclude"
              : winnerType === "discussion"
                ? "discussion"
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
        fetchComparison(true); // Preserve expanded state
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

  const saveFieldOverride = async (emailId: string, fieldName: string, value: string) => {
    setSavingOverride(true);
    try {
      // Convert value to appropriate type
      let parsedValue: unknown = value;
      // Try to parse as number if it looks like one
      if (/^-?\d*\.?\d+$/.test(value.trim())) {
        parsedValue = value.trim();
      }
      // Empty string means clear the override
      if (value.trim() === "") {
        parsedValue = null;
      }

      const res = await fetch("/api/compare", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId,
          fieldOverrides: { [fieldName]: parsedValue },
        }),
      });

      if (res.ok) {
        toast.success("Field override saved");
        setEditingField(null);
        fetchComparison(true); // Preserve expanded state
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to save override");
      }
    } catch (error) {
      toast.error("Failed to save override");
    } finally {
      setSavingOverride(false);
    }
  };

  const startEditingField = (emailId: string, fieldName: string, currentValue: unknown) => {
    setEditingField(`${emailId}:${fieldName}`);
    setEditingValue(currentValue === null || currentValue === undefined ? "" : String(currentValue));
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditingValue("");
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

  const togglePatternGroupExpanded = (groupKey: string) => {
    setExpandedPatternGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
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

    if (item.winnerTransactionId === "discussion") {
      return (
        <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 gap-1">
          <MessageSquare className="h-3 w-3" />
          Discussion
        </Badge>
      );
    }

    if (item.winnerTransactionId === "exclude") {
      return (
        <Badge variant="secondary" className="bg-red-100 text-red-800 gap-1">
          <Ban className="h-3 w-3" />
          Excluded
        </Badge>
      );
    }

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
    isDifferent: boolean,
    editOptions?: {
      emailId: string;
      fieldName: string;
      fieldOverrides: Record<string, unknown> | null;
    }
  ) => {
    const formattedA = formatValue(valueA);
    const formattedB = formatValue(valueB);

    // Check if this field has an override
    const hasOverride = editOptions?.fieldOverrides && editOptions.fieldName in editOptions.fieldOverrides;
    const overrideValue = hasOverride ? editOptions!.fieldOverrides![editOptions!.fieldName] : null;

    // Check if we're currently editing this field
    const isEditing = editOptions && editingField === `${editOptions.emailId}:${editOptions.fieldName}`;

    return (
      <div
        className={`grid grid-cols-3 gap-4 py-2 px-3 rounded group ${
          isDifferent ? "bg-yellow-50 border border-yellow-200" : ""
        } ${hasOverride ? "bg-green-50 border border-green-200" : ""}`}
      >
        <div className="text-sm font-medium text-gray-600 flex items-center gap-1">
          {label}
          {hasOverride && (
            <Badge variant="secondary" className="bg-green-100 text-green-800 text-xs px-1 py-0">
              edited
            </Badge>
          )}
        </div>
        <div className={`text-sm ${isDifferent ? "font-semibold text-blue-700" : "text-gray-900"}`}>
          {formattedA}
        </div>
        <div className={`text-sm ${isDifferent ? "font-semibold text-purple-700" : "text-gray-900"} flex items-center gap-2`}>
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                className="h-7 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    saveFieldOverride(editOptions!.emailId, editOptions!.fieldName, editingValue);
                  } else if (e.key === "Escape") {
                    cancelEditing();
                  }
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
                onClick={() => saveFieldOverride(editOptions!.emailId, editOptions!.fieldName, editingValue)}
                disabled={savingOverride}
              >
                {savingOverride ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                onClick={cancelEditing}
                disabled={savingOverride}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <>
              <span className="flex-1">
                {hasOverride ? (
                  <span className="text-green-700 font-semibold" title={`Override: ${formatValue(overrideValue)}`}>
                    {formatValue(overrideValue)}
                    <span className="text-gray-400 font-normal line-through ml-2 text-xs">
                      {formattedB}
                    </span>
                  </span>
                ) : (
                  formattedB
                )}
              </span>
              {editOptions && isDifferent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Start editing with the value we want to override (or override value if exists)
                    const startValue = hasOverride ? overrideValue : valueB;
                    startEditingField(editOptions.emailId, editOptions.fieldName, startValue);
                  }}
                  title="Edit value for synthesis"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
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
      className={cn(
        item.winnerTransactionId
          ? item.winnerTransactionId === "discussion"
            ? "border-indigo-300 bg-indigo-50/30 opacity-60"
            : item.winnerTransactionId === "exclude"
              ? "border-red-300 bg-red-50/30 opacity-60"
              : item.winnerTransactionId === "tie"
                ? "border-gray-300 bg-gray-50/50"
                : "border-green-300 bg-green-50/50"
          : "",
        // Highlight likely discussions that haven't been marked yet
        !item.winnerTransactionId && isLikelyDiscussion(item.emailSubject) && "ring-2 ring-indigo-300 ring-offset-1"
      )}
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
                item.differences.includes("type"),
                { emailId: item.emailId, fieldName: "type", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Amount",
                item.runATransaction?.amount,
                item.runBTransaction?.amount,
                item.differences.includes("amount"),
                { emailId: item.emailId, fieldName: "amount", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Currency",
                item.runATransaction?.currency,
                item.runBTransaction?.currency,
                item.differences.includes("currency"),
                { emailId: item.emailId, fieldName: "currency", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Description",
                item.runATransaction?.description,
                item.runBTransaction?.description,
                item.differences.includes("description"),
                { emailId: item.emailId, fieldName: "description", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Symbol",
                item.runATransaction?.symbol,
                item.runBTransaction?.symbol,
                item.differences.includes("symbol"),
                { emailId: item.emailId, fieldName: "symbol", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Category",
                item.runATransaction?.category,
                item.runBTransaction?.category,
                item.differences.includes("category"),
                { emailId: item.emailId, fieldName: "category", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Date",
                item.runATransaction?.date,
                item.runBTransaction?.date,
                item.differences.includes("date"),
                { emailId: item.emailId, fieldName: "date", fieldOverrides: item.fieldOverrides }
              )}

              {/* Quantity fields */}
              {renderTransactionDetail(
                "Quantity",
                item.runATransaction?.quantity,
                item.runBTransaction?.quantity,
                item.differences.includes("quantity"),
                { emailId: item.emailId, fieldName: "quantity", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Qty Executed",
                item.runATransaction?.quantityExecuted,
                item.runBTransaction?.quantityExecuted,
                item.differences.includes("quantityExecuted"),
                { emailId: item.emailId, fieldName: "quantityExecuted", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Qty Remaining",
                item.runATransaction?.quantityRemaining,
                item.runBTransaction?.quantityRemaining,
                item.differences.includes("quantityRemaining"),
                { emailId: item.emailId, fieldName: "quantityRemaining", fieldOverrides: item.fieldOverrides }
              )}

              {/* Price fields */}
              {renderTransactionDetail(
                "Price",
                item.runATransaction?.price,
                item.runBTransaction?.price,
                item.differences.includes("price"),
                { emailId: item.emailId, fieldName: "price", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Execution Price",
                item.runATransaction?.executionPrice,
                item.runBTransaction?.executionPrice,
                item.differences.includes("executionPrice"),
                { emailId: item.emailId, fieldName: "executionPrice", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Price Type",
                item.runATransaction?.priceType,
                item.runBTransaction?.priceType,
                item.differences.includes("priceType"),
                { emailId: item.emailId, fieldName: "priceType", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Limit Price",
                item.runATransaction?.limitPrice,
                item.runBTransaction?.limitPrice,
                item.differences.includes("limitPrice"),
                { emailId: item.emailId, fieldName: "limitPrice", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Fees",
                item.runATransaction?.fees,
                item.runBTransaction?.fees,
                item.differences.includes("fees"),
                { emailId: item.emailId, fieldName: "fees", fieldOverrides: item.fieldOverrides }
              )}

              {/* Options fields */}
              {renderTransactionDetail(
                "Contract Size",
                item.runATransaction?.contractSize,
                item.runBTransaction?.contractSize,
                item.differences.includes("contractSize"),
                { emailId: item.emailId, fieldName: "contractSize", fieldOverrides: item.fieldOverrides }
              )}

              {/* Order tracking fields */}
              {renderTransactionDetail(
                "Order ID",
                item.runATransaction?.orderId,
                item.runBTransaction?.orderId,
                item.differences.includes("orderId"),
                { emailId: item.emailId, fieldName: "orderId", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Order Type",
                item.runATransaction?.orderType,
                item.runBTransaction?.orderType,
                item.differences.includes("orderType"),
                { emailId: item.emailId, fieldName: "orderType", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Order Quantity",
                item.runATransaction?.orderQuantity,
                item.runBTransaction?.orderQuantity,
                item.differences.includes("orderQuantity"),
                { emailId: item.emailId, fieldName: "orderQuantity", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Order Price",
                item.runATransaction?.orderPrice,
                item.runBTransaction?.orderPrice,
                item.differences.includes("orderPrice"),
                { emailId: item.emailId, fieldName: "orderPrice", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Order Status",
                item.runATransaction?.orderStatus,
                item.runBTransaction?.orderStatus,
                item.differences.includes("orderStatus"),
                { emailId: item.emailId, fieldName: "orderStatus", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Time in Force",
                item.runATransaction?.timeInForce,
                item.runBTransaction?.timeInForce,
                item.differences.includes("timeInForce"),
                { emailId: item.emailId, fieldName: "timeInForce", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Reference #",
                item.runATransaction?.referenceNumber,
                item.runBTransaction?.referenceNumber,
                item.differences.includes("referenceNumber"),
                { emailId: item.emailId, fieldName: "referenceNumber", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Partially Executed",
                item.runATransaction?.partiallyExecuted ? "Yes" : item.runATransaction?.partiallyExecuted === false ? "No" : null,
                item.runBTransaction?.partiallyExecuted ? "Yes" : item.runBTransaction?.partiallyExecuted === false ? "No" : null,
                item.differences.includes("partiallyExecuted"),
                { emailId: item.emailId, fieldName: "partiallyExecuted", fieldOverrides: item.fieldOverrides }
              )}
              {renderTransactionDetail(
                "Execution Time",
                item.runATransaction?.executionTime,
                item.runBTransaction?.executionTime,
                item.differences.includes("executionTime"),
                { emailId: item.emailId, fieldName: "executionTime", fieldOverrides: item.fieldOverrides }
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
                        item.dataKeyDifferences?.includes(key) || false,
                        { emailId: item.emailId, fieldName: `data.${key}`, fieldOverrides: item.fieldOverrides }
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
                <Button
                  size="sm"
                  variant={item.winnerTransactionId === "discussion" ? "default" : "outline"}
                  className={`gap-1 ${
                    item.winnerTransactionId === "discussion"
                      ? "bg-indigo-600 hover:bg-indigo-700"
                      : "border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  }`}
                  onClick={() => designateWinner(item.emailId, "discussion")}
                >
                  <MessageSquare className="h-3 w-3" />
                  Discussion
                </Button>
                <Button
                  size="sm"
                  variant={item.winnerTransactionId === "exclude" ? "default" : "outline"}
                  className={`gap-1 ${
                    item.winnerTransactionId === "exclude"
                      ? "bg-red-600 hover:bg-red-700"
                      : "border-red-300 text-red-700 hover:bg-red-50"
                  }`}
                  onClick={() => designateWinner(item.emailId, "exclude")}
                >
                  <Ban className="h-3 w-3" />
                  Exclude
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

              <Button onClick={() => fetchComparison()} disabled={loading || !runAId || !runBId} className="gap-2">
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

            {/* Winner Overview & Filters */}
            {(comparison.summary.different > 0 || comparison.summary.onlyA > 0 || comparison.summary.onlyB > 0) && (
              <Card className="mb-8">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-yellow-600" />
                      Winner Overview
                    </CardTitle>
                    <Button
                      onClick={() => setSynthesizeDialogOpen(true)}
                      className="gap-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                    >
                      <Sparkles className="h-4 w-4" />
                      Create Synthesized Run
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Winner Distribution */}
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "run_a" ? "all" : "run_a")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "run_a"
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-blue-600">{winnerStats.runAWins}</div>
                      <p className="text-xs text-gray-600">{runALabel} wins</p>
                    </button>
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "run_b" ? "all" : "run_b")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "run_b"
                          ? "border-purple-500 bg-purple-50"
                          : "border-gray-200 hover:border-purple-300 hover:bg-purple-50/50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-purple-600">{winnerStats.runBWins}</div>
                      <p className="text-xs text-gray-600">{runBLabel} wins</p>
                    </button>
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "tie" ? "all" : "tie")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "tie"
                          ? "border-gray-500 bg-gray-100"
                          : "border-gray-200 hover:border-gray-400 hover:bg-gray-50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-gray-600">{winnerStats.ties}</div>
                      <p className="text-xs text-gray-600">Ties</p>
                    </button>
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "discussion" ? "all" : "discussion")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "discussion"
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-indigo-600">{winnerStats.discussions}</div>
                      <p className="text-xs text-gray-600">Discussions</p>
                    </button>
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "exclude" ? "all" : "exclude")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "exclude"
                          ? "border-red-500 bg-red-50"
                          : "border-gray-200 hover:border-red-300 hover:bg-red-50/50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-red-600">{winnerStats.excluded}</div>
                      <p className="text-xs text-gray-600">Excluded</p>
                    </button>
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "pending" ? "all" : "pending")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "pending"
                          ? "border-orange-500 bg-orange-50"
                          : "border-gray-200 hover:border-orange-300 hover:bg-orange-50/50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-orange-600">{winnerStats.pending}</div>
                      <p className="text-xs text-gray-600">Pending</p>
                    </button>
                    <button
                      onClick={() => setWinnerFilter("all")}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        winnerFilter === "all"
                          ? "border-green-500 bg-green-50"
                          : "border-gray-200 hover:border-green-300 hover:bg-green-50/50"
                      }`}
                    >
                      <div className="text-2xl font-bold text-green-600">{winnerStats.total}</div>
                      <p className="text-xs text-gray-600">Total</p>
                    </button>
                  </div>

                  {/* Multi-transaction info */}
                  {winnerStats.multiTransaction > 0 && (
                    <div className="p-3 rounded-lg border border-orange-200 bg-orange-50/50">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="h-4 w-4 text-orange-600" />
                        <span className="text-sm font-medium text-orange-800">
                          {winnerStats.multiTransaction} emails have multiple transactions
                        </span>
                      </div>
                      <div className="flex gap-4 text-xs text-orange-700">
                        <span className="flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3 text-green-600" />
                          {winnerStats.multiTxnWithMatches} with matching transactions
                        </span>
                        <span className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-yellow-600" />
                          {winnerStats.multiTxnWithoutMatches} need manual review
                        </span>
                      </div>
                      <p className="text-xs text-orange-600 mt-1">
                        See &quot;Multi-Transaction Emails&quot; section below
                      </p>
                    </div>
                  )}

                  {/* Likely discussions hint */}
                  {winnerStats.likelyDiscussions > 0 && (
                    <button
                      onClick={() => setWinnerFilter(winnerFilter === "likely_discussion" ? "all" : "likely_discussion")}
                      className={`w-full p-2 rounded-lg border transition-all flex items-center justify-between ${
                        winnerFilter === "likely_discussion"
                          ? "border-indigo-400 bg-indigo-50"
                          : "border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50"
                      }`}
                    >
                      <span className="text-sm text-indigo-700 flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        {winnerStats.likelyDiscussions} emails with subjects starting with re:, fw:, or fwd: may be discussions
                      </span>
                      <span className="text-xs text-indigo-600">Click to filter</span>
                    </button>
                  )}

                  {/* Filter indicator */}
                  {winnerFilter !== "all" && (
                    <div className="flex items-center gap-2 p-2 bg-gray-100 rounded-lg mt-4">
                      <span className="text-sm text-gray-600">
                        Showing only:{" "}
                        <span className="font-medium">
                          {winnerFilter === "run_a" && `${runALabel} wins`}
                          {winnerFilter === "run_b" && `${runBLabel} wins`}
                          {winnerFilter === "tie" && "Ties"}
                          {winnerFilter === "discussion" && "Discussions"}
                          {winnerFilter === "exclude" && "Excluded"}
                          {winnerFilter === "likely_discussion" && "Likely discussions (unmarked)"}
                          {winnerFilter === "pending" && "Pending decisions"}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setWinnerFilter("all")}
                      >
                        Clear filter
                      </Button>
                    </div>
                  )}
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
            {filteredDifferentByType.size > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Layers className="h-5 w-5 text-yellow-600" />
                  Different Transactions ({winnerFilter === "all" ? comparison.summary.different : filteredDifferentByType.size > 0 ? Array.from(filteredDifferentByType.values()).reduce((sum, items) => sum + items.length, 0) : 0})
                </h2>
                <p className="text-sm text-gray-600 mb-4">
                  These transactions exist in both runs but have different values. Grouped by transaction type.
                </p>

                <div className="space-y-4">
                  {Array.from(filteredDifferentByType.entries()).map(([type, items]) => {
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
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                                    onClick={() => bulkDesignateWinner(items, "exclude")}
                                    disabled={bulkLoading.has(typeKey)}
                                  >
                                    {bulkLoading.has(typeKey) ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <>
                                        <Ban className="h-3 w-3 mr-1" />
                                        Exclude
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
                                const patterns = filteredDifferenceGroups.get(type);
                                if (!patterns || patterns.size <= 1) {
                                  // Single pattern or no pattern grouping - show items directly
                                  return items.map((item) => renderComparisonItem(item));
                                }

                                // Split groups into numeric vs non-numeric differences
                                const splitGroups: DifferenceGroup[] = [];

                                for (const group of patterns.values()) {
                                  // Separate items with real numeric differences (both values exist) from those without
                                  const itemsWithNumeric = group.items.filter(item =>
                                    getRealNumericDiffs(item).length > 0
                                  );
                                  const itemsWithoutNumeric = group.items.filter(item =>
                                    getRealNumericDiffs(item).length === 0
                                  );

                                  // Create group for items with numeric differences
                                  if (itemsWithNumeric.length > 0) {
                                    // Collect all real numeric diff fields from these items
                                    const numericFields = new Set<string>();
                                    for (const item of itemsWithNumeric) {
                                      for (const d of getRealNumericDiffs(item)) {
                                        numericFields.add(d);
                                      }
                                    }
                                    splitGroups.push({
                                      ...group,
                                      items: itemsWithNumeric,
                                      hasNumericDifferences: true,
                                      numericDiffFields: Array.from(numericFields),
                                    });
                                  }

                                  // Create group for items without numeric differences
                                  if (itemsWithoutNumeric.length > 0) {
                                    splitGroups.push({
                                      ...group,
                                      items: itemsWithoutNumeric,
                                      hasNumericDifferences: false,
                                      numericDiffFields: [],
                                    });
                                  }
                                }

                                // Sort groups: numeric differences first, then by item count
                                const sortedGroups = splitGroups.sort((a, b) => {
                                  // Numeric differences first
                                  if (a.hasNumericDifferences && !b.hasNumericDifferences) return -1;
                                  if (!a.hasNumericDifferences && b.hasNumericDifferences) return 1;
                                  // Then by item count (larger groups first)
                                  return b.items.length - a.items.length;
                                });

                                return sortedGroups.map((group, groupIdx) => {
                                  const groupKey = `${type}-pattern-${groupIdx}`;
                                  const groupResolved = group.items.filter((i) => i.winnerTransactionId).length;
                                  const hasFieldDiffs = group.fieldsOnlyInA.length > 0 || group.fieldsOnlyInB.length > 0;
                                  const isGroupExpanded = expandedPatternGroups.has(groupKey);

                                  // Single-item groups: render directly without collapsible wrapper
                                  if (group.items.length === 1) {
                                    return (
                                      <div key={groupKey}>
                                        {group.hasNumericDifferences && (
                                          <div className="flex items-center gap-2 mb-2 px-1">
                                            <Badge className="bg-red-100 text-red-800 border-red-200">
                                              ⚠️ {group.numericDiffFields.join(", ")} differs
                                            </Badge>
                                          </div>
                                        )}
                                        {renderComparisonItem(group.items[0])}
                                      </div>
                                    );
                                  }

                                  // Multi-item groups: render with collapsible wrapper
                                  return (
                                    <Collapsible
                                      key={groupKey}
                                      open={isGroupExpanded}
                                      onOpenChange={() => togglePatternGroupExpanded(groupKey)}
                                    >
                                      <div className={`border rounded-lg overflow-hidden ${
                                        group.hasNumericDifferences
                                          ? "bg-red-50/50 border-red-200"
                                          : "bg-yellow-50/50"
                                      }`}>
                                        {/* Pattern description - clickable header */}
                                        <CollapsibleTrigger asChild>
                                          <div className={`flex items-center justify-between flex-wrap gap-2 p-3 cursor-pointer transition-colors ${
                                            group.hasNumericDifferences
                                              ? "hover:bg-red-100/50"
                                              : "hover:bg-yellow-100/50"
                                          }`}>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <ChevronDown
                                                className={`h-4 w-4 text-gray-400 transition-transform ${
                                                  isGroupExpanded ? "rotate-180" : ""
                                                }`}
                                              />
                                              {group.hasNumericDifferences && (
                                                <Badge className="bg-red-100 text-red-800 border-red-200">
                                                  ⚠️ {group.numericDiffFields.join(", ")} differs
                                                </Badge>
                                              )}
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
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="h-6 text-xs px-2 border-red-300 text-red-700 hover:bg-red-50"
                                                onClick={() => bulkDesignateWinner(group.items, "exclude")}
                                                disabled={bulkLoading.has(groupKey)}
                                              >
                                                <Ban className="h-3 w-3 mr-1" />
                                                Exclude
                                              </Button>
                                            </div>
                                          </div>
                                        </CollapsibleTrigger>
                                        {/* Items in this pattern group - collapsible content */}
                                        <CollapsibleContent>
                                          <div className="space-y-2 p-3 pt-0">
                                            {group.items.map((item) => renderComparisonItem(item))}
                                          </div>
                                        </CollapsibleContent>
                                      </div>
                                    </Collapsible>
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

            {/* SECTION: Multi-Transaction Emails */}
            {comparison.multiTransactionEmails && comparison.multiTransactionEmails.length > 0 && (
              <div className="mb-8">
                <Card className="border-orange-200 mb-4">
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-orange-600" />
                        <CardTitle className="text-lg">Multi-Transaction Emails ({comparison.multiTransactionEmails.length})</CardTitle>
                        <Badge variant="secondary" className="bg-green-100 text-green-800">
                          {multiTxnAnalysis.withMatches.length} with matches
                        </Badge>
                        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                          {multiTxnAnalysis.withoutMatches.length} need review
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                <p className="text-sm text-gray-600 mb-4">
                  These emails have multiple transactions in one or both runs. Review all transactions to determine the correct extraction.
                </p>

                {/* Emails with matching transactions */}
                {multiTxnAnalysis.withMatches.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-md font-medium text-green-800 mb-3 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      With Matching Transactions ({multiTxnAnalysis.withMatches.length})
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      These emails have transactions that match between runs - likely correct but verify.
                    </p>
                    <div className="space-y-4">
                      {multiTxnAnalysis.withMatches.map((email) => (
                        <Card key={email.emailId} className="border-green-200 bg-green-50/30">
                          <CardHeader className="py-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate max-w-md">
                                  {email.emailSubject || "No subject"}
                                </span>
                                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                  {email.runATransactions.length} in {runALabel}
                                </Badge>
                                <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                                  {email.runBTransactions.length} in {runBLabel}
                                </Badge>
                                <Badge variant="secondary" className="bg-green-100 text-green-800">
                                  {email.matchedPairs.length} matched
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                {email.winnerTransactionIds.length > 0 && !email.winnerTransactionIds.includes("exclude") && !email.winnerTransactionIds.includes("discussion") && (
                                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 gap-1">
                                    <Trophy className="h-3 w-3" />
                                    {email.winnerTransactionIds.length} Selected
                                  </Badge>
                                )}
                                {email.winnerTransactionIds.includes("exclude") && (
                                  <Badge variant="secondary" className="bg-red-100 text-red-800 gap-1">
                                    <Ban className="h-3 w-3" />
                                    Excluded
                                  </Badge>
                                )}
                                {email.winnerTransactionIds.includes("discussion") && (
                                  <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 gap-1">
                                    <MessageSquare className="h-3 w-3" />
                                    Discussion
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0 pb-3">
                            <p className="text-xs text-gray-500 mb-2">Click transactions to toggle selection. Multiple can be selected.</p>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs font-medium text-blue-700 mb-2">{runALabel} Transactions</div>
                                {email.runATransactions.map((txn) => {
                                  const isSelected = email.winnerTransactionIds.includes(txn.id);
                                  return (
                                    <div
                                      key={txn.id}
                                      className={cn(
                                        "text-xs p-2 rounded mb-1 cursor-pointer transition-all",
                                        isSelected
                                          ? "bg-blue-200 border-2 border-blue-500 ring-2 ring-blue-300"
                                          : "bg-blue-50 hover:bg-blue-100 border border-transparent"
                                      )}
                                      onClick={() => toggleMultiWinner(email.emailId, txn.id)}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <span className="font-medium">{txn.type}</span>
                                          {txn.amount && <span className="ml-2">{txn.amount} {txn.currency}</span>}
                                          {txn.symbol && <span className="ml-2 text-gray-500">{txn.symbol}</span>}
                                        </div>
                                        {isSelected && <CheckCircle2 className="h-3 w-3 text-blue-700" />}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div>
                                <div className="text-xs font-medium text-purple-700 mb-2">{runBLabel} Transactions</div>
                                {email.runBTransactions.map((txn) => {
                                  const isSelected = email.winnerTransactionIds.includes(txn.id);
                                  return (
                                    <div
                                      key={txn.id}
                                      className={cn(
                                        "text-xs p-2 rounded mb-1 cursor-pointer transition-all",
                                        isSelected
                                          ? "bg-purple-200 border-2 border-purple-500 ring-2 ring-purple-300"
                                          : "bg-purple-50 hover:bg-purple-100 border border-transparent"
                                      )}
                                      onClick={() => toggleMultiWinner(email.emailId, txn.id)}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <span className="font-medium">{txn.type}</span>
                                          {txn.amount && <span className="ml-2">{txn.amount} {txn.currency}</span>}
                                          {txn.symbol && <span className="ml-2 text-gray-500">{txn.symbol}</span>}
                                        </div>
                                        {isSelected && <CheckCircle2 className="h-3 w-3 text-purple-700" />}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* View Email button and preview */}
                            <div className="mt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 mb-3"
                                onClick={() => toggleEmailPreview(email.emailId)}
                              >
                                {loadingEmails.has(email.emailId) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Mail className="h-4 w-4" />
                                )}
                                {expandedEmailPreviews.has(email.emailId) ? "Hide" : "View"} Original Email
                                {expandedEmailPreviews.has(email.emailId) ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>

                              {expandedEmailPreviews.has(email.emailId) && (
                                <div className="mb-4 border rounded-lg overflow-hidden bg-white">
                                  <div className="px-3 py-2 bg-gray-100 border-b text-sm font-medium text-gray-700">
                                    Original Email Content
                                  </div>
                                  {loadingEmails.has(email.emailId) ? (
                                    <div className="flex items-center justify-center py-12">
                                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                                      <span className="ml-2 text-gray-500">Loading email...</span>
                                    </div>
                                  ) : emailContents.has(email.emailId) ? (
                                    <div className="max-h-96 overflow-auto">
                                      {emailContents.get(email.emailId)?.bodyHtml ? (
                                        <iframe
                                          srcDoc={emailContents.get(email.emailId)?.bodyHtml || ""}
                                          sandbox="allow-same-origin"
                                          className="w-full min-h-[300px] border-0"
                                          style={{ height: "400px" }}
                                          title="Email content"
                                        />
                                      ) : emailContents.get(email.emailId)?.bodyText ? (
                                        <pre className="p-4 text-sm whitespace-pre-wrap font-mono text-gray-700">
                                          {emailContents.get(email.emailId)?.bodyText}
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

                            <div className="flex items-center gap-2 pt-3 border-t">
                              <span className="text-xs text-gray-500">Actions:</span>
                              <Button
                                size="sm"
                                variant={email.winnerTransactionIds.includes("discussion") ? "default" : "outline"}
                                className={`h-6 text-xs ${
                                  email.winnerTransactionIds.includes("discussion")
                                    ? "bg-indigo-600 hover:bg-indigo-700"
                                    : "border-indigo-300 text-indigo-700"
                                }`}
                                onClick={() => setMultiSpecialValue(email.emailId, "discussion")}
                              >
                                Discussion
                              </Button>
                              <Button
                                size="sm"
                                variant={email.winnerTransactionIds.includes("exclude") ? "default" : "outline"}
                                className={`h-6 text-xs ${
                                  email.winnerTransactionIds.includes("exclude")
                                    ? "bg-red-600 hover:bg-red-700"
                                    : "border-red-300 text-red-700"
                                }`}
                                onClick={() => setMultiSpecialValue(email.emailId, "exclude")}
                              >
                                Exclude
                              </Button>
                              {email.winnerTransactionIds.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs text-gray-500"
                                  onClick={() => setMultiSpecialValue(email.emailId, null)}
                                >
                                  Clear
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* Emails without matching transactions */}
                {multiTxnAnalysis.withoutMatches.length > 0 && (
                  <div>
                    <h3 className="text-md font-medium text-yellow-800 mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Needs Manual Review ({multiTxnAnalysis.withoutMatches.length})
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      These emails have different transactions between runs - requires careful review.
                    </p>
                    <div className="space-y-4">
                      {multiTxnAnalysis.withoutMatches.map((email) => (
                        <Card key={email.emailId} className="border-yellow-200 bg-yellow-50/30">
                          <CardHeader className="py-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate max-w-md">
                                  {email.emailSubject || "No subject"}
                                </span>
                                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                  {email.runATransactions.length} in {runALabel}
                                </Badge>
                                <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                                  {email.runBTransactions.length} in {runBLabel}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2">
                                {email.winnerTransactionIds.length > 0 && !email.winnerTransactionIds.includes("exclude") && !email.winnerTransactionIds.includes("discussion") && (
                                  <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 gap-1">
                                    <Trophy className="h-3 w-3" />
                                    {email.winnerTransactionIds.length} Selected
                                  </Badge>
                                )}
                                {email.winnerTransactionIds.includes("exclude") && (
                                  <Badge variant="secondary" className="bg-red-100 text-red-800 gap-1">
                                    <Ban className="h-3 w-3" />
                                    Excluded
                                  </Badge>
                                )}
                                {email.winnerTransactionIds.includes("discussion") && (
                                  <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 gap-1">
                                    <MessageSquare className="h-3 w-3" />
                                    Discussion
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0 pb-3">
                            <p className="text-xs text-gray-500 mb-2">Click transactions to toggle selection. Multiple can be selected.</p>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs font-medium text-blue-700 mb-2">{runALabel} Transactions</div>
                                {email.runATransactions.length === 0 ? (
                                  <div className="text-xs text-gray-400 italic">No transactions</div>
                                ) : (
                                  email.runATransactions.map((txn) => {
                                    const isSelected = email.winnerTransactionIds.includes(txn.id);
                                    return (
                                      <div
                                        key={txn.id}
                                        className={cn(
                                          "text-xs p-2 rounded mb-1 cursor-pointer transition-all",
                                          isSelected
                                            ? "bg-blue-200 border-2 border-blue-500 ring-2 ring-blue-300"
                                            : "bg-blue-50 hover:bg-blue-100 border border-transparent"
                                        )}
                                        onClick={() => toggleMultiWinner(email.emailId, txn.id)}
                                      >
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <span className="font-medium">{txn.type}</span>
                                            {txn.amount && <span className="ml-2">{txn.amount} {txn.currency}</span>}
                                            {txn.symbol && <span className="ml-2 text-gray-500">{txn.symbol}</span>}
                                          </div>
                                          {isSelected && <CheckCircle2 className="h-3 w-3 text-blue-700" />}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              <div>
                                <div className="text-xs font-medium text-purple-700 mb-2">{runBLabel} Transactions</div>
                                {email.runBTransactions.length === 0 ? (
                                  <div className="text-xs text-gray-400 italic">No transactions</div>
                                ) : (
                                  email.runBTransactions.map((txn) => {
                                    const isSelected = email.winnerTransactionIds.includes(txn.id);
                                    return (
                                      <div
                                        key={txn.id}
                                        className={cn(
                                          "text-xs p-2 rounded mb-1 cursor-pointer transition-all",
                                          isSelected
                                            ? "bg-purple-200 border-2 border-purple-500 ring-2 ring-purple-300"
                                            : "bg-purple-50 hover:bg-purple-100 border border-transparent"
                                        )}
                                        onClick={() => toggleMultiWinner(email.emailId, txn.id)}
                                      >
                                        <div className="flex items-center justify-between">
                                          <div>
                                            <span className="font-medium">{txn.type}</span>
                                            {txn.amount && <span className="ml-2">{txn.amount} {txn.currency}</span>}
                                            {txn.symbol && <span className="ml-2 text-gray-500">{txn.symbol}</span>}
                                          </div>
                                          {isSelected && <CheckCircle2 className="h-3 w-3 text-purple-700" />}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>

                            {/* View Email button and preview */}
                            <div className="mt-4">
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 mb-3"
                                onClick={() => toggleEmailPreview(email.emailId)}
                              >
                                {loadingEmails.has(email.emailId) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Mail className="h-4 w-4" />
                                )}
                                {expandedEmailPreviews.has(email.emailId) ? "Hide" : "View"} Original Email
                                {expandedEmailPreviews.has(email.emailId) ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </Button>

                              {expandedEmailPreviews.has(email.emailId) && (
                                <div className="mb-4 border rounded-lg overflow-hidden bg-white">
                                  <div className="px-3 py-2 bg-gray-100 border-b text-sm font-medium text-gray-700">
                                    Original Email Content
                                  </div>
                                  {loadingEmails.has(email.emailId) ? (
                                    <div className="flex items-center justify-center py-12">
                                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                                      <span className="ml-2 text-gray-500">Loading email...</span>
                                    </div>
                                  ) : emailContents.has(email.emailId) ? (
                                    <div className="max-h-96 overflow-auto">
                                      {emailContents.get(email.emailId)?.bodyHtml ? (
                                        <iframe
                                          srcDoc={emailContents.get(email.emailId)?.bodyHtml || ""}
                                          sandbox="allow-same-origin"
                                          className="w-full min-h-[300px] border-0"
                                          style={{ height: "400px" }}
                                          title="Email content"
                                        />
                                      ) : emailContents.get(email.emailId)?.bodyText ? (
                                        <pre className="p-4 text-sm whitespace-pre-wrap font-mono text-gray-700">
                                          {emailContents.get(email.emailId)?.bodyText}
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

                            <div className="flex items-center gap-2 pt-3 border-t">
                              <span className="text-xs text-gray-500">Actions:</span>
                              <Button
                                size="sm"
                                variant={email.winnerTransactionIds.includes("discussion") ? "default" : "outline"}
                                className={`h-6 text-xs ${
                                  email.winnerTransactionIds.includes("discussion")
                                    ? "bg-indigo-600 hover:bg-indigo-700"
                                    : "border-indigo-300 text-indigo-700"
                                }`}
                                onClick={() => setMultiSpecialValue(email.emailId, "discussion")}
                              >
                                Discussion
                              </Button>
                              <Button
                                size="sm"
                                variant={email.winnerTransactionIds.includes("exclude") ? "default" : "outline"}
                                className={`h-6 text-xs ${
                                  email.winnerTransactionIds.includes("exclude")
                                    ? "bg-red-600 hover:bg-red-700"
                                    : "border-red-300 text-red-700"
                                }`}
                                onClick={() => setMultiSpecialValue(email.emailId, "exclude")}
                              >
                                Exclude
                              </Button>
                              {email.winnerTransactionIds.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 text-xs text-gray-500"
                                  onClick={() => setMultiSpecialValue(email.emailId, null)}
                                >
                                  Clear
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* SECTION: Exclusive Transactions */}
            {filteredExclusiveItems.length > 0 && (
              <div className="mb-8">
                <Card className="border-blue-200 mb-4">
                  <CardHeader className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <ArrowLeftRight className="h-5 w-5 text-blue-600" />
                        <CardTitle className="text-lg">Exclusive Transactions ({filteredExclusiveItems.length})</CardTitle>
                        <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                          {filteredExclusiveItems.filter((i) => i.status === "only_a").length} only in {runALabel}
                        </Badge>
                        <Badge variant="secondary" className="bg-purple-100 text-purple-800">
                          {filteredExclusiveItems.filter((i) => i.status === "only_b").length} only in {runBLabel}
                        </Badge>
                        <Badge
                          variant="secondary"
                          className={
                            filteredExclusiveItems.filter((i) => i.winnerTransactionId).length === filteredExclusiveItems.length
                              ? "bg-green-100 text-green-800"
                              : "bg-gray-100 text-gray-600"
                          }
                        >
                          {filteredExclusiveItems.filter((i) => i.winnerTransactionId).length}/{filteredExclusiveItems.length} resolved
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-gray-500 mr-2">Bulk:</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-green-300 text-green-700 hover:bg-green-50"
                          onClick={() => {
                            // Auto-assign: set winner to whichever transaction exists
                            const updates = filteredExclusiveItems
                              .filter((item) => !item.winnerTransactionId)
                              .map((item) => ({
                                emailId: item.emailId,
                                winnerTransactionId: item.runATransaction?.id || item.runBTransaction?.id || null,
                              }));
                            if (updates.length > 0) {
                              setBulkLoading((prev) => new Set(prev).add("exclusive"));
                              fetch("/api/compare", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ updates }),
                              })
                                .then((res) => {
                                  if (res.ok) {
                                    toast.success(`Auto-assigned ${updates.length} winners`);
                                    fetchComparison(true);
                                  }
                                })
                                .finally(() => {
                                  setBulkLoading((prev) => {
                                    const next = new Set(prev);
                                    next.delete("exclusive");
                                    return next;
                                  });
                                });
                            } else {
                              toast.info("All exclusive transactions already have winners");
                            }
                          }}
                          disabled={bulkLoading.has("exclusive")}
                        >
                          {bulkLoading.has("exclusive") ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <Trophy className="h-3 w-3 mr-1" />
                              Auto-assign Winners
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                          onClick={() => bulkDesignateWinner(filteredExclusiveItems, "exclude")}
                          disabled={bulkLoading.has("exclusive")}
                        >
                          {bulkLoading.has("exclusive") ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <>
                              <Ban className="h-3 w-3 mr-1" />
                              Exclude All
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
                <p className="text-sm text-gray-600 mb-4">
                  These transactions exist in only one run. Use &quot;Auto-assign Winners&quot; to accept all, or review individually.
                </p>

                <div className="space-y-3">
                  {filteredExclusiveItems.map((item) => renderComparisonItem(item, true))}
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
                    {comparison.summary.different + comparison.summary.onlyA + comparison.summary.onlyB - comparison.summary.winnersDesignated - comparison.summary.excluded} using fallback
                  </p>
                  <p className="text-gray-600">
                    {comparison.summary.matches} matching transactions will be included
                  </p>
                  {comparison.summary.excluded > 0 && (
                    <p className="text-red-600">
                      {comparison.summary.excluded} transactions will be excluded (not copied)
                    </p>
                  )}
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
