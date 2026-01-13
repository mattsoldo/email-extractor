"use client";

import { useEffect, useState, useCallback, use } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Sparkles,
  ArrowLeft,
  Mail,
  Eye,
  Check,
  X,
  Merge,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import Link from "next/link";

interface FieldIssue {
  field: string;
  currentValue: unknown;
  suggestedValue: unknown;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface DuplicateField {
  fields: string[];
  suggestedCanonical: string;
  reason: string;
}

interface QaResult {
  id: string;
  qaRunId: string;
  transactionId: string;
  sourceEmailId: string;
  hasIssues: boolean;
  fieldIssues: FieldIssue[];
  duplicateFields: DuplicateField[];
  overallAssessment: string | null;
  status: "pending_review" | "accepted" | "rejected" | "partial";
  acceptedFields: Record<string, boolean> | null;
  acceptedMerges: Array<{ canonical: string; merged: string[] }> | null;
  reviewedAt: string | null;
  transaction: {
    id: string;
    type: string;
    amount: string | null;
    symbol: string | null;
    date: string;
    description: string | null;
  } | null;
  email: {
    id: string;
    subject: string | null;
    sender: string | null;
    date: string | null;
  } | null;
}

interface QaRun {
  id: string;
  setId: string;
  sourceRunId: string;
  modelId: string;
  status: string;
  transactionsTotal: number;
  transactionsChecked: number;
  issuesFound: number;
  synthesizedRunId: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface Stats {
  total: number;
  withIssues: number;
  accepted: number;
  rejected: number;
  partial: number;
  pending: number;
}

export default function QAReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [qaRun, setQaRun] = useState<QaRun | null>(null);
  const [results, setResults] = useState<QaResult[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [onlyIssues, setOnlyIssues] = useState(true);

  // Expanded states
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  // Local state for tracking field acceptance
  const [localAcceptedFields, setLocalAcceptedFields] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [localAcceptedMerges, setLocalAcceptedMerges] = useState<
    Record<string, Array<{ canonical: string; merged: string[] }>>
  >({});

  // Synthesize dialog
  const [synthesizeDialogOpen, setSynthesizeDialogOpen] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);

  // Email preview
  const [previewingEmail, setPreviewingEmail] = useState<string | null>(null);
  const [emailContent, setEmailContent] = useState<string | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "50",
        onlyIssues: String(onlyIssues),
      });

      const res = await fetch(`/api/qa/${id}?${params}`);
      const data = await res.json();

      setQaRun(data.qaRun);
      setResults(data.results || []);
      setStats(data.stats);
      setTotalPages(data.pagination?.totalPages || 1);

      // Initialize local acceptance state from existing data
      const acceptedFields: Record<string, Record<string, boolean>> = {};
      const acceptedMerges: Record<
        string,
        Array<{ canonical: string; merged: string[] }>
      > = {};

      for (const result of data.results || []) {
        if (result.acceptedFields) {
          acceptedFields[result.id] = result.acceptedFields;
        }
        if (result.acceptedMerges) {
          acceptedMerges[result.id] = result.acceptedMerges;
        }
      }

      setLocalAcceptedFields(acceptedFields);
      setLocalAcceptedMerges(acceptedMerges);
    } catch (error) {
      console.error("Failed to fetch QA results:", error);
      toast.error("Failed to load QA results");
    } finally {
      setLoading(false);
    }
  }, [id, page, onlyIssues]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const toggleExpanded = (resultId: string) => {
    const newExpanded = new Set(expandedResults);
    if (newExpanded.has(resultId)) {
      newExpanded.delete(resultId);
    } else {
      newExpanded.add(resultId);
    }
    setExpandedResults(newExpanded);
  };

  const toggleFieldAcceptance = (resultId: string, field: string) => {
    setLocalAcceptedFields((prev) => {
      const current = prev[resultId] || {};
      return {
        ...prev,
        [resultId]: {
          ...current,
          [field]: !current[field],
        },
      };
    });
  };

  const toggleMergeAcceptance = (
    resultId: string,
    merge: { canonical: string; merged: string[] }
  ) => {
    setLocalAcceptedMerges((prev) => {
      const current = prev[resultId] || [];
      const exists = current.some(
        (m) =>
          m.canonical === merge.canonical &&
          m.merged.join(",") === merge.merged.join(",")
      );

      if (exists) {
        return {
          ...prev,
          [resultId]: current.filter(
            (m) =>
              !(
                m.canonical === merge.canonical &&
                m.merged.join(",") === merge.merged.join(",")
              )
          ),
        };
      } else {
        return {
          ...prev,
          [resultId]: [...current, merge],
        };
      }
    });
  };

  const saveResultReview = async (resultId: string) => {
    const acceptedFields = localAcceptedFields[resultId] || {};
    const acceptedMerges = localAcceptedMerges[resultId] || [];

    // Determine status based on selections
    const result = results.find((r) => r.id === resultId);
    if (!result) return;

    const totalFields = result.fieldIssues.length;
    const acceptedCount = Object.values(acceptedFields).filter(Boolean).length;
    const totalMerges = result.duplicateFields.length;
    const mergesAcceptedCount = acceptedMerges.length;

    let status: "accepted" | "rejected" | "partial" = "rejected";
    if (acceptedCount === totalFields && mergesAcceptedCount === totalMerges) {
      status = "accepted";
    } else if (acceptedCount > 0 || mergesAcceptedCount > 0) {
      status = "partial";
    }

    try {
      const res = await fetch(`/api/qa/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resultId,
          status,
          acceptedFields,
          acceptedMerges,
        }),
      });

      if (res.ok) {
        toast.success("Review saved");
        fetchResults();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to save review");
      }
    } catch (error) {
      toast.error("Failed to save review");
    }
  };

  const acceptAll = async (resultId: string) => {
    const result = results.find((r) => r.id === resultId);
    if (!result) return;

    // Accept all field issues
    const allFields: Record<string, boolean> = {};
    for (const issue of result.fieldIssues) {
      allFields[issue.field] = true;
    }
    setLocalAcceptedFields((prev) => ({ ...prev, [resultId]: allFields }));

    // Accept all merges
    const allMerges = result.duplicateFields.map((d) => ({
      canonical: d.suggestedCanonical,
      merged: d.fields.filter((f) => f !== d.suggestedCanonical),
    }));
    setLocalAcceptedMerges((prev) => ({ ...prev, [resultId]: allMerges }));

    // Save
    try {
      const res = await fetch(`/api/qa/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resultId,
          status: "accepted",
          acceptedFields: allFields,
          acceptedMerges: allMerges,
        }),
      });

      if (res.ok) {
        toast.success("All changes accepted");
        fetchResults();
      }
    } catch (error) {
      toast.error("Failed to save");
    }
  };

  const rejectAll = async (resultId: string) => {
    setLocalAcceptedFields((prev) => ({ ...prev, [resultId]: {} }));
    setLocalAcceptedMerges((prev) => ({ ...prev, [resultId]: [] }));

    try {
      const res = await fetch(`/api/qa/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resultId,
          status: "rejected",
          acceptedFields: {},
          acceptedMerges: [],
        }),
      });

      if (res.ok) {
        toast.success("All changes rejected");
        fetchResults();
      }
    } catch (error) {
      toast.error("Failed to save");
    }
  };

  const createSynthesizedRun = async () => {
    setSynthesizing(true);
    try {
      const res = await fetch(`/api/qa/${id}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.ok) {
        const data = await res.json();
        toast.success(`Created synthesized run v${data.run.version}`);
        setSynthesizeDialogOpen(false);
        fetchResults();
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

  const previewEmail = async (emailId: string) => {
    setPreviewingEmail(emailId);
    setLoadingEmail(true);
    try {
      const res = await fetch(`/api/emails/${emailId}`);
      const data = await res.json();
      setEmailContent(data.bodyText || data.bodyHtml || "No content");
    } catch (error) {
      setEmailContent("Failed to load email");
    } finally {
      setLoadingEmail(false);
    }
  };

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case "high":
        return <Badge className="bg-green-100 text-green-800">High</Badge>;
      case "medium":
        return <Badge className="bg-yellow-100 text-yellow-800">Medium</Badge>;
      case "low":
        return <Badge className="bg-red-100 text-red-800">Low</Badge>;
      default:
        return <Badge variant="outline">{confidence}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "accepted":
        return (
          <Badge className="bg-green-100 text-green-800">
            <Check className="h-3 w-3 mr-1" />
            Accepted
          </Badge>
        );
      case "rejected":
        return (
          <Badge className="bg-red-100 text-red-800">
            <X className="h-3 w-3 mr-1" />
            Rejected
          </Badge>
        );
      case "partial":
        return (
          <Badge className="bg-yellow-100 text-yellow-800">
            Partial
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            Pending Review
          </Badge>
        );
    }
  };

  if (loading && !qaRun) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="lg:pl-64 pt-16 lg:pt-0 transition-all duration-300 body-sidebar-offset">
          <div className="flex items-center justify-center h-[60vh]">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </main>
      </div>
    );
  }

  const acceptedCount = stats?.accepted || 0;
  const partialCount = stats?.partial || 0;
  const reviewedCount = acceptedCount + partialCount + (stats?.rejected || 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="lg:pl-64 pt-16 lg:pt-0 transition-all duration-300 body-sidebar-offset">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <Link href="/qa">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Back
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  QA Review
                </h1>
                <p className="text-gray-500">
                  Review and approve suggested corrections
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {qaRun?.status === "completed" && !qaRun?.synthesizedRunId && (
                <Button
                  onClick={() => setSynthesizeDialogOpen(true)}
                  disabled={acceptedCount + partialCount === 0}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create Corrected Run
                </Button>
              )}
              {qaRun?.synthesizedRunId && (
                <Link href={`/runs?highlight=${qaRun.synthesizedRunId}`}>
                  <Button variant="outline">
                    <Sparkles className="h-4 w-4 mr-2" />
                    View Corrected Run
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Transactions Checked
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {qaRun?.transactionsChecked || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Issues Found
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600">
                  {qaRun?.issuesFound || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Reviewed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {reviewedCount} / {stats?.withIssues || 0}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Accepted
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {acceptedCount + partialCount}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-gray-500">
                  Pending
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-600">
                  {stats?.pending || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={onlyIssues}
                onCheckedChange={(checked) => {
                  setOnlyIssues(!!checked);
                  setPage(1);
                }}
              />
              Show only transactions with issues
            </label>
          </div>

          {/* Results List */}
          <div className="space-y-4">
            {results.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="h-12 w-12 text-green-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">
                    {onlyIssues ? "No issues found" : "No results"}
                  </h3>
                  <p className="text-gray-500">
                    {onlyIssues
                      ? "All transactions appear to be accurate"
                      : "No QA results available"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              results.map((result) => {
                const isExpanded = expandedResults.has(result.id);
                const accepted = localAcceptedFields[result.id] || {};
                const merges = localAcceptedMerges[result.id] || [];

                return (
                  <Card key={result.id}>
                    <Collapsible open={isExpanded}>
                      <CollapsibleTrigger
                        className="w-full"
                        onClick={() => toggleExpanded(result.id)}
                      >
                        <CardHeader className="cursor-pointer hover:bg-gray-50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              {isExpanded ? (
                                <ChevronUp className="h-5 w-5 text-gray-400" />
                              ) : (
                                <ChevronDown className="h-5 w-5 text-gray-400" />
                              )}
                              <div className="text-left">
                                <div className="font-medium">
                                  {result.transaction?.type || "Unknown"} -{" "}
                                  {result.transaction?.symbol || "N/A"}
                                </div>
                                <div className="text-sm text-gray-500">
                                  {result.email?.subject || "No subject"}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right text-sm">
                                <div className="text-gray-600">
                                  {result.fieldIssues.length} field issues
                                </div>
                                <div className="text-gray-600">
                                  {result.duplicateFields.length} duplicates
                                </div>
                              </div>
                              {getStatusBadge(result.status)}
                            </div>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <CardContent className="border-t">
                          {/* Quick Actions */}
                          <div className="flex gap-2 mb-4">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                acceptAll(result.id);
                              }}
                            >
                              <Check className="h-4 w-4 mr-1" />
                              Accept All
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                rejectAll(result.id);
                              }}
                            >
                              <X className="h-4 w-4 mr-1" />
                              Reject All
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                previewEmail(result.sourceEmailId);
                              }}
                            >
                              <Mail className="h-4 w-4 mr-1" />
                              View Email
                            </Button>
                          </div>

                          {/* Field Issues */}
                          {result.fieldIssues.length > 0 && (
                            <div className="mb-6">
                              <h4 className="font-medium mb-3 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-amber-500" />
                                Field Issues
                              </h4>
                              <div className="space-y-2">
                                {result.fieldIssues.map((issue, idx) => (
                                  <div
                                    key={idx}
                                    className={`p-3 rounded-lg border ${
                                      accepted[issue.field]
                                        ? "bg-green-50 border-green-200"
                                        : "bg-gray-50 border-gray-200"
                                    }`}
                                  >
                                    <div className="flex items-start justify-between">
                                      <div className="flex items-start gap-3">
                                        <Checkbox
                                          checked={!!accepted[issue.field]}
                                          onCheckedChange={() =>
                                            toggleFieldAcceptance(
                                              result.id,
                                              issue.field
                                            )
                                          }
                                        />
                                        <div>
                                          <div className="font-medium text-sm">
                                            {issue.field}
                                          </div>
                                          <div className="text-sm text-gray-600 mt-1">
                                            <span className="text-red-600 line-through">
                                              {formatValue(issue.currentValue)}
                                            </span>
                                            {" → "}
                                            <span className="text-green-600 font-medium">
                                              {formatValue(issue.suggestedValue)}
                                            </span>
                                          </div>
                                          <div className="text-xs text-gray-500 mt-1">
                                            {issue.reason}
                                          </div>
                                        </div>
                                      </div>
                                      {getConfidenceBadge(issue.confidence)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Duplicate Fields */}
                          {result.duplicateFields.length > 0 && (
                            <div className="mb-6">
                              <h4 className="font-medium mb-3 flex items-center gap-2">
                                <Merge className="h-4 w-4 text-blue-500" />
                                Duplicate Fields
                              </h4>
                              <div className="space-y-2">
                                {result.duplicateFields.map((dup, idx) => {
                                  const mergeKey = {
                                    canonical: dup.suggestedCanonical,
                                    merged: dup.fields.filter(
                                      (f) => f !== dup.suggestedCanonical
                                    ),
                                  };
                                  const isAccepted = merges.some(
                                    (m) =>
                                      m.canonical === mergeKey.canonical &&
                                      m.merged.join(",") ===
                                        mergeKey.merged.join(",")
                                  );

                                  return (
                                    <div
                                      key={idx}
                                      className={`p-3 rounded-lg border ${
                                        isAccepted
                                          ? "bg-blue-50 border-blue-200"
                                          : "bg-gray-50 border-gray-200"
                                      }`}
                                    >
                                      <div className="flex items-start gap-3">
                                        <Checkbox
                                          checked={isAccepted}
                                          onCheckedChange={() =>
                                            toggleMergeAcceptance(
                                              result.id,
                                              mergeKey
                                            )
                                          }
                                        />
                                        <div>
                                          <div className="font-medium text-sm">
                                            Merge to: {dup.suggestedCanonical}
                                          </div>
                                          <div className="text-sm text-gray-600 mt-1">
                                            Fields: {dup.fields.join(", ")}
                                          </div>
                                          <div className="text-xs text-gray-500 mt-1">
                                            {dup.reason}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Overall Assessment */}
                          {result.overallAssessment && (
                            <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                              <strong>Assessment:</strong>{" "}
                              {result.overallAssessment}
                            </div>
                          )}

                          {/* Save Button */}
                          <div className="mt-4 flex justify-end">
                            <Button
                              onClick={() => saveResultReview(result.id)}
                              size="sm"
                            >
                              Save Review
                            </Button>
                          </div>
                        </CardContent>
                      </CollapsibleContent>
                    </Collapsible>
                  </Card>
                );
              })
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Synthesize Dialog */}
      <Dialog open={synthesizeDialogOpen} onOpenChange={setSynthesizeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Corrected Run</DialogTitle>
            <DialogDescription>
              Create a new extraction run with your accepted corrections applied.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-gray-600">
              This will create a new synthesized run with{" "}
              <strong>{acceptedCount + partialCount}</strong> corrections applied.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSynthesizeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={createSynthesizedRun} disabled={synthesizing}>
              {synthesizing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Create Run
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Preview Dialog */}
      <Dialog
        open={!!previewingEmail}
        onOpenChange={() => setPreviewingEmail(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Preview</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {loadingEmail ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap text-sm font-mono bg-gray-50 p-4 rounded-lg">
                {emailContent}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
