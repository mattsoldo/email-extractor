"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useUpload } from "@/contexts/upload-context";
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
  FolderOpen,
  Loader2,
  Trash2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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
    <div>
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

  // Upload state (from global context)
  const {
    uploading,
    uploadProgress,
    uploadTotal,
    uploadStage,
    uploadMessage,
    uploadResult,
    cancelling,
    startUpload,
    cancelUpload,
  } = useUpload();
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email set state
  const [emailSets, setEmailSets] = useState<EmailSet[]>([]);
  const [uploadSetName, setUploadSetName] = useState("");

  // Selection state
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState<"page" | "all" | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      case "non_financial":
        return (
          <Badge variant="outline" className="gap-1 text-gray-500">
            <Ban className="h-3 w-3" /> Non-Financial
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

  // Selection helpers
  const toggleSelectEmail = (emailId: string) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(emailId)) {
        next.delete(emailId);
      } else {
        next.add(emailId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedEmails.size === emails.length && selectAllMode !== null) {
      // If all on page selected (or all mode), deselect everything
      setSelectedEmails(new Set());
      setSelectAllMode(null);
    } else {
      // Select all on current page
      setSelectedEmails(new Set(emails.map((e) => e.id)));
      setSelectAllMode("page");
    }
  };

  const selectAllEmails = () => {
    setSelectAllMode("all");
  };

  const clearSelection = () => {
    setSelectedEmails(new Set());
    setSelectAllMode(null);
  };

  const isAllSelected = emails.length > 0 && selectedEmails.size === emails.length;
  const isSomeSelected = selectedEmails.size > 0 && selectedEmails.size < emails.length;
  const totalEmails = pagination?.total || 0;
  const showSelectAllBanner = selectAllMode === "page" && isAllSelected && totalEmails > emails.length;

  // Clear selection when emails change (e.g., pagination, filters)
  useEffect(() => {
    setSelectedEmails(new Set());
    setSelectAllMode(null);
  }, [page, statusFilter, setFilter]);

  const deleteSelectedEmails = async () => {
    if (selectedEmails.size === 0 && selectAllMode !== "all") return;

    setDeleting(true);
    try {
      let body: Record<string, unknown>;

      if (selectAllMode === "all") {
        // Delete all emails matching current filters
        body = {
          deleteAll: true,
          filters: {
            status: statusFilter !== "all" ? statusFilter : undefined,
            setId: setFilter !== "all" ? setFilter : undefined,
          },
        };
      } else {
        // Delete specific selected emails
        body = { emailIds: Array.from(selectedEmails) };
      }

      const res = await fetch("/api/emails/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        throw new Error("Failed to delete emails");
      }

      setSelectedEmails(new Set());
      setSelectAllMode(null);
      setShowDeleteDialog(false);
      fetchEmails();
    } catch (error) {
      console.error("Failed to delete emails:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload = async (files: FileList | File[]) => {
    await startUpload(files, uploadSetName);
    // Refresh data after upload completes
    fetchEmailSets();
    fetchEmails();
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
    setUploadSetName("");
  };

  return (
    <div>
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
                <SelectItem value="non_financial">
                  Non-Financial ({statusCounts.non_financial || 0})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Selection Actions */}
          {(selectedEmails.size > 0 || selectAllMode === "all") && (
            <div className="flex items-center gap-3 ml-auto">
              <span className="text-sm text-gray-600">
                {selectAllMode === "all" ? totalEmails : selectedEmails.size} selected
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeleteDialog(true)}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          )}
        </div>

        {/* Select All Banner */}
        {(showSelectAllBanner || selectAllMode === "all") && (
          <div className="flex items-center justify-center gap-2 py-2 px-4 mb-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
            {selectAllMode === "page" ? (
              <>
                <span className="text-blue-800">
                  All {emails.length} emails on this page are selected.
                </span>
                <button
                  onClick={selectAllEmails}
                  className="text-blue-600 hover:text-blue-800 font-medium underline"
                >
                  Select all {totalEmails} emails
                </button>
              </>
            ) : (
              <>
                <span className="text-blue-800">
                  All {totalEmails} emails are selected.
                </span>
                <button
                  onClick={clearSelection}
                  className="text-blue-600 hover:text-blue-800 font-medium underline"
                >
                  Clear selection
                </button>
              </>
            )}
          </div>
        )}

        {/* Emails Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="table-fixed w-full min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={isAllSelected}
                      ref={(el) => {
                        if (el) {
                          (el as HTMLButtonElement).dataset.state = isSomeSelected ? "indeterminate" : isAllSelected ? "checked" : "unchecked";
                        }
                      }}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all emails"
                    />
                  </TableHead>
                  <TableHead className="w-[33%]">Subject</TableHead>
                  <TableHead className="w-[18%]">Sender</TableHead>
                  <TableHead className="w-[12%]">Date</TableHead>
                  <TableHead className="w-[22%]">Status</TableHead>
                  <TableHead className="w-[10%]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : emails.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      No emails found
                    </TableCell>
                  </TableRow>
                ) : (
                  emails.map((email) => (
                    <TableRow
                      key={email.id}
                      className={selectedEmails.has(email.id) ? "bg-blue-50" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedEmails.has(email.id)}
                          onCheckedChange={() => toggleSelectEmail(email.id)}
                          aria-label={`Select ${email.subject || "email"}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="block truncate" title={email.subject || "(no subject)"}>
                          {email.subject || "(no subject)"}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-600">
                        <span className="block truncate" title={email.sender || "(unknown)"}>
                          {email.sender || "(unknown)"}
                        </span>
                      </TableCell>
                      <TableCell className="text-gray-600 whitespace-nowrap">
                        {email.date
                          ? format(new Date(email.date), "MMM d, yyyy")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {getStatusBadge(
                            email.extractionStatus,
                            email.skipReason
                          )}
                          {email.skipReason && (
                            <span
                              className="text-xs text-gray-500 truncate block max-w-full"
                              title={email.skipReason}
                            >
                              {email.skipReason}
                            </span>
                          )}
                          {email.informationalNotes && (
                            <span
                              className="text-xs text-blue-500 truncate block max-w-full"
                              title={email.informationalNotes}
                            >
                              {email.informationalNotes}
                            </span>
                          )}
                        </div>
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
              {/* Set Name Input */}
              <div className="space-y-2">
                <Label htmlFor="setName">Set Name (optional)</Label>
                <Input
                  id="setName"
                  placeholder="Auto-generated if empty..."
                  value={uploadSetName}
                  onChange={(e) => setUploadSetName(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  A new set will be created for this upload
                </p>
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
                  accept=".eml,.txt,.zip"
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
                    : "Drag & drop .eml, .txt, or .zip files here"}
                </p>
                <p className="text-sm text-gray-500">
                  or click to browse
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Zip files will be extracted automatically
                </p>
              </div>

              {/* Upload Progress */}
              {(uploading || cancelling) && (
                <div className="space-y-3 p-4 bg-blue-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                      <span className="font-medium text-blue-800">{uploadMessage}</span>
                    </div>
                    {uploading && !cancelling && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancelUpload}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    )}
                  </div>
                  {uploadTotal > 0 && (
                    <>
                      <Progress value={(uploadProgress / uploadTotal) * 100} className="h-2" />
                      <div className="flex items-center justify-between text-xs text-blue-600">
                        <span>
                          {uploadStage === "extracting" && "Reading files..."}
                          {uploadStage === "parsing" && "Parsing emails..."}
                          {uploadStage === "saving" && "Saving to database..."}
                        </span>
                        <span>{uploadProgress} / {uploadTotal}</span>
                      </div>
                    </>
                  )}
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

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                Delete Emails
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-gray-600">
                Are you sure you want to delete{" "}
                <strong>{selectAllMode === "all" ? totalEmails : selectedEmails.size}</strong> email
                {(selectAllMode === "all" ? totalEmails : selectedEmails.size) === 1 ? "" : "s"}? This action cannot be
                undone.
              </p>
              {selectAllMode === "all" && (
                <p className="text-sm text-amber-600 font-medium">
                  This will delete all emails matching your current filters.
                </p>
              )}
              <p className="text-sm text-gray-500">
                All associated transactions and extraction data will also be
                deleted.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteDialog(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={deleteSelectedEmails}
                  disabled={deleting}
                  className="gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      Delete {selectAllMode === "all" ? totalEmails : selectedEmails.size} Email
                      {(selectAllMode === "all" ? totalEmails : selectedEmails.size) === 1 ? "" : "s"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
