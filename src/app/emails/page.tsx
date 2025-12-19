"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  Info,
  Upload,
  FileUp,
  Plus,
  FolderOpen,
  Loader2,
} from "lucide-react";

interface Email {
  id: string;
  filename: string;
  subject: string | null;
  sender: string | null;
  date: string | null;
  extractionStatus: string;
  extractionError: string | null;
  skipReason: string | null;
  informationalNotes: string | null;
  rawExtraction: Record<string, unknown> | null;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface UploadResult {
  uploaded: number;
  skipped: number;
  failed: number;
  details: Array<{
    filename: string;
    status: "uploaded" | "skipped" | "failed";
    reason?: string;
  }>;
}

interface EmailSet {
  id: string;
  name: string;
  emailCount: number;
}

// Loading fallback component
function EmailsLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      </main>
    </div>
  );
}

// Main page wrapper with Suspense
export default function EmailsPage() {
  return (
    <Suspense fallback={<EmailsLoading />}>
      <EmailsContent />
    </Suspense>
  );
}

// Actual page content that uses useSearchParams
function EmailsContent() {
  const searchParams = useSearchParams();
  const urlSetId = searchParams.get("setId");

  const [emails, setEmails] = useState<Email[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [setFilter, setSetFilter] = useState<string>(urlSetId || "all");
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [page, setPage] = useState(1);
  const [currentSetName, setCurrentSetName] = useState<string | null>(null);

  // Upload state
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email set state
  const [emailSets, setEmailSets] = useState<EmailSet[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<string>("none");
  const [newSetName, setNewSetName] = useState("");

  // Sync URL param to state
  useEffect(() => {
    if (urlSetId) {
      setSetFilter(urlSetId);
    }
  }, [urlSetId]);

  const fetchEmails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "25",
      });
      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }
      if (setFilter && setFilter !== "all") {
        params.set("setId", setFilter);
      }

      const res = await fetch(`/api/emails?${params}`);
      const data = await res.json();

      setEmails(data.emails || []);
      setPagination(data.pagination);
      setStatusCounts(data.statusCounts || {});
    } catch (error) {
      console.error("Failed to fetch emails:", error);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, setFilter]);

  // Fetch all sets for filter dropdown
  const fetchAllSets = useCallback(async () => {
    try {
      const res = await fetch("/api/email-sets");
      const data = await res.json();
      setEmailSets(data.sets || []);

      // Set current set name if filtering by set
      if (setFilter && setFilter !== "all") {
        const currentSet = (data.sets || []).find((s: EmailSet) => s.id === setFilter);
        setCurrentSetName(currentSet?.name || null);
      } else {
        setCurrentSetName(null);
      }
    } catch (error) {
      console.error("Failed to fetch email sets:", error);
    }
  }, [setFilter]);

  useEffect(() => {
    fetchAllSets();
  }, [fetchAllSets]);

  useEffect(() => {
    fetchEmails();
  }, [fetchEmails]);

  const getStatusBadge = (status: string, skipReason?: string | null) => {
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
      case "processing":
        return (
          <Badge className="gap-1">
            <RefreshCw className="h-3 w-3 animate-spin" /> Processing
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const reprocessEmail = async (emailId: string) => {
    try {
      await fetch(`/api/emails/${emailId}`, { method: "POST" });
      fetchEmails();
    } catch (error) {
      console.error("Failed to reprocess email:", error);
    }
  };

  const handleUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter(
      (f) => f.name.endsWith(".eml") || f.name.endsWith(".zip")
    );
    if (fileArray.length === 0) {
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    // Aggregate results across batches
    const aggregatedResults: UploadResult = {
      uploaded: 0,
      skipped: 0,
      failed: 0,
      details: [],
    };

    // Upload in batches to avoid timeout
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(fileArray.length / BATCH_SIZE);
    let createdSetId: string | null = null;

    try {
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, fileArray.length);
        const batch = fileArray.slice(start, end);

        const formData = new FormData();
        batch.forEach((file) => {
          formData.append("files", file);
        });

        // For first batch, handle set creation
        if (batchIndex === 0) {
          if (selectedSetId === "new" && newSetName.trim()) {
            formData.append("newSetName", newSetName.trim());
          } else if (selectedSetId && selectedSetId !== "none") {
            formData.append("setId", selectedSetId);
          }
        } else if (createdSetId) {
          // Use the set created in first batch
          formData.append("setId", createdSetId);
        }

        const res = await fetch("/api/emails/upload", {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (data.results) {
          aggregatedResults.uploaded += data.results.uploaded;
          aggregatedResults.skipped += data.results.skipped;
          aggregatedResults.failed += data.results.failed;
          // Only keep first 100 details to avoid UI slowdown
          if (aggregatedResults.details.length < 100) {
            aggregatedResults.details.push(
              ...data.results.details.slice(0, 100 - aggregatedResults.details.length)
            );
          }
        }

        // Capture set ID from first batch
        if (batchIndex === 0 && data.set?.id) {
          createdSetId = data.set.id;
        }

        // Update progress
        const progress = Math.round(((batchIndex + 1) / totalBatches) * 100);
        setUploadProgress(progress);
        setUploadResult({ ...aggregatedResults });
      }

      // Refresh sets list if a new set was created
      if (createdSetId) {
        fetchEmailSets();
      }

      // Generate AI summary if there were errors or skips
      if (aggregatedResults.failed > 0 || aggregatedResults.skipped > 0) {
        setSummarizing(true);
        try {
          const summaryRes = await fetch("/api/uploads/summarize-errors", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              errors: aggregatedResults.details.filter(d => d.status !== "uploaded"),
              uploaded: aggregatedResults.uploaded,
              skipped: aggregatedResults.skipped,
              failed: aggregatedResults.failed,
            }),
          });
          const summaryData = await summaryRes.json();
          setUploadSummary(summaryData.summary);
        } catch (summaryError) {
          console.error("Failed to generate summary:", summaryError);
        } finally {
          setSummarizing(false);
        }
      }

      // Refresh email list after upload
      setTimeout(() => {
        fetchEmails();
      }, 500);
    } catch (error) {
      console.error("Upload failed:", error);
      aggregatedResults.failed += fileArray.length - (aggregatedResults.uploaded + aggregatedResults.skipped + aggregatedResults.failed);
      setUploadResult(aggregatedResults);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const fetchEmailSets = async () => {
    try {
      const res = await fetch("/api/email-sets");
      const data = await res.json();
      setEmailSets(data.sets || []);
    } catch (error) {
      console.error("Failed to fetch email sets:", error);
    }
  };

  const openUploadDialog = () => {
    setShowUploadDialog(true);
    setUploadResult(null);
    setUploadSummary(null);
    setUploadProgress(0);
    setSelectedSetId("none");
    setNewSetName("");
    fetchEmailSets();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Emails</h1>
            <p className="text-gray-600 mt-1">
              View and manage imported email notifications
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={openUploadDialog} className="gap-2">
              <Upload className="h-4 w-4" />
              Upload Emails
            </Button>
            <Button onClick={fetchEmails} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Current Set Indicator */}
        {currentSetName && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-blue-50 rounded-lg">
            <FolderOpen className="h-4 w-4 text-blue-600" />
            <span className="text-sm text-blue-800">
              Viewing set: <strong>{currentSetName}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-blue-600"
              onClick={() => {
                setSetFilter("all");
                window.history.pushState({}, "", "/emails");
              }}
            >
              Clear filter
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Set:</span>
            <Select value={setFilter} onValueChange={setSetFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sets</SelectItem>
                {emailSets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name} ({set.emailCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Status:</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  All ({Object.values(statusCounts).reduce((a, b) => a + b, 0)})
                </SelectItem>
                <SelectItem value="pending">
                  Pending ({statusCounts.pending || 0})
                </SelectItem>
                <SelectItem value="completed">
                  Completed ({statusCounts.completed || 0})
                </SelectItem>
                <SelectItem value="informational">
                  Informational ({statusCounts.informational || 0})
                </SelectItem>
                <SelectItem value="failed">
                  Failed ({statusCounts.failed || 0})
                </SelectItem>
                <SelectItem value="skipped">
                  Skipped ({statusCounts.skipped || 0})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Emails Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : emails.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      No emails found
                    </TableCell>
                  </TableRow>
                ) : (
                  emails.map((email) => (
                    <TableRow key={email.id}>
                      <TableCell className="font-medium max-w-[300px] truncate">
                        {email.subject || "(no subject)"}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {email.sender || "(unknown)"}
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {email.date
                          ? format(new Date(email.date), "MMM d, yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(
                          email.extractionStatus,
                          email.skipReason
                        )}
                        {email.skipReason && (
                          <span className="text-xs text-gray-500 block mt-1">
                            {email.skipReason}
                          </span>
                        )}
                        {email.informationalNotes && (
                          <span className="text-xs text-blue-500 block mt-1">
                            {email.informationalNotes}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/emails/${email.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {(email.extractionStatus === "failed" ||
                            email.extractionStatus === "skipped") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => reprocessEmail(email.id)}
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
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
              {pagination.total} emails
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

        {/* Email Detail Dialog */}
        <Dialog
          open={!!selectedEmail}
          onOpenChange={() => setSelectedEmail(null)}
        >
          <DialogContent className="max-w-3xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle>
                {selectedEmail?.subject || "(no subject)"}
              </DialogTitle>
            </DialogHeader>
            <ScrollArea className="h-[60vh]">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Sender:</span>{" "}
                    {selectedEmail?.sender || "-"}
                  </div>
                  <div>
                    <span className="text-gray-500">Date:</span>{" "}
                    {selectedEmail?.date
                      ? format(
                          new Date(selectedEmail.date),
                          "MMM d, yyyy h:mm a"
                        )
                      : "-"}
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>{" "}
                    {selectedEmail?.extractionStatus}
                  </div>
                  <div>
                    <span className="text-gray-500">Filename:</span>{" "}
                    <span className="font-mono text-xs">
                      {selectedEmail?.filename}
                    </span>
                  </div>
                </div>

                {selectedEmail?.extractionError && (
                  <div className="p-3 bg-red-50 rounded-lg text-sm text-red-700">
                    <strong>Error:</strong> {selectedEmail.extractionError}
                  </div>
                )}

                {selectedEmail?.rawExtraction && (
                  <div>
                    <h3 className="font-semibold mb-2">Extracted Data</h3>
                    <pre className="p-3 bg-gray-100 rounded-lg text-xs overflow-auto">
                      {JSON.stringify(selectedEmail.rawExtraction, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Upload Dialog */}
        <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload Email Files</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              {/* Email Set Selector */}
              <div className="space-y-2">
                <Label>Add to Email Set (optional)</Label>
                <Select value={selectedSetId} onValueChange={setSelectedSetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a set or create new" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      <span className="text-gray-500">No set</span>
                    </SelectItem>
                    <SelectItem value="new">
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Create new set
                      </span>
                    </SelectItem>
                    {emailSets.map((set) => (
                      <SelectItem key={set.id} value={set.id}>
                        <span className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4" />
                          {set.name}
                          <span className="text-gray-400 text-xs">
                            ({set.emailCount})
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedSetId === "new" && (
                  <Input
                    placeholder="Enter new set name..."
                    value={newSetName}
                    onChange={(e) => setNewSetName(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>

              {/* Drop Zone */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                  transition-colors
                  ${isDragging
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-300 hover:border-gray-400"
                  }
                  ${uploading ? "pointer-events-none opacity-50" : ""}
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".eml,.zip"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) {
                      handleUpload(e.target.files);
                    }
                  }}
                />
                <FileUp className="h-10 w-10 mx-auto text-gray-400 mb-3" />
                <p className="text-gray-600 mb-1">
                  {isDragging
                    ? "Drop files here"
                    : "Drag & drop .eml or .zip files here"}
                </p>
                <p className="text-sm text-gray-500">
                  or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Zip files will be extracted automatically
                </p>
              </div>

              {/* Upload Progress */}
              {uploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} />
                </div>
              )}

              {/* Upload Results */}
              {uploadResult && (
                <div className="space-y-3">
                  <div className="flex gap-4 text-sm">
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      {uploadResult.uploaded} uploaded
                    </div>
                    <div className="flex items-center gap-1 text-yellow-600">
                      <Ban className="h-4 w-4" />
                      {uploadResult.skipped} skipped
                    </div>
                    <div className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-4 w-4" />
                      {uploadResult.failed} failed
                    </div>
                  </div>

                  {uploadResult.details.length > 0 && (
                    <ScrollArea className="h-[150px] border rounded-lg">
                      <div className="p-2 space-y-1">
                        {uploadResult.details.map((detail, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-gray-50"
                          >
                            <span className="truncate max-w-[200px]">
                              {detail.filename}
                            </span>
                            <div className="flex items-center gap-2">
                              {detail.status === "uploaded" && (
                                <Badge className="bg-green-100 text-green-800">
                                  Uploaded
                                </Badge>
                              )}
                              {detail.status === "skipped" && (
                                <Badge className="bg-yellow-100 text-yellow-800">
                                  {detail.reason || "Skipped"}
                                </Badge>
                              )}
                              {detail.status === "failed" && (
                                <Badge className="bg-red-100 text-red-800">
                                  {detail.reason || "Failed"}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}

                  {/* AI Summary */}
                  {summarizing && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Analyzing upload results...
                    </div>
                  )}
                  {uploadSummary && !summarizing && (
                    <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
                      <div className="flex items-start gap-2">
                        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        <span>{uploadSummary}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowUploadDialog(false)}
                >
                  {uploadResult ? "Close" : "Cancel"}
                </Button>
                {uploadResult && uploadResult.uploaded > 0 && (
                  <Button
                    onClick={() => {
                      setShowUploadDialog(false);
                      // Could navigate to extraction or refresh
                    }}
                  >
                    Done
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
