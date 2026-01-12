"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  MessageCircle,
  Mail,
  Hash,
  Calendar,
  User,
  ExternalLink,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

interface DiscussionSummary {
  id: string;
  emailId: string;
  runId: string;
  summary: string;
  relatedReferenceNumbers: string[] | null;
  createdAt: string;
  emailSubject: string | null;
  emailSender: string | null;
  emailDate: string | null;
  emailFilename: string;
  runVersion: number | null;
}

function DiscussionsContent() {
  const searchParams = useSearchParams();
  const runIdFilter = searchParams.get("runId");

  const [discussions, setDiscussions] = useState<DiscussionSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => {
    const fetchDiscussions = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(page * limit),
        });
        if (runIdFilter) {
          params.set("runId", runIdFilter);
        }
        const res = await fetch(`/api/discussions?${params}`);
        const data = await res.json();
        setDiscussions(data.discussions || []);
        setTotal(data.total || 0);
      } catch (error) {
        console.error("Failed to fetch discussions:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDiscussions();
  }, [page, runIdFilter]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-8 w-8 text-purple-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Discussion Summaries
              </h1>
              <p className="text-gray-500 text-sm">
                Evidence and discussion context extracted from emails
              </p>
            </div>
          </div>
          {runIdFilter && (
            <Link href="/discussions">
              <Button variant="outline" size="sm">
                Clear filter
              </Button>
            </Link>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Total Discussions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Showing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {discussions.length > 0
                  ? `${page * limit + 1}-${Math.min((page + 1) * limit, total)}`
                  : "0"}
              </div>
            </CardContent>
          </Card>
          {runIdFilter && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-500 font-normal">
                  Filtered by Run
                </CardTitle>
              </CardHeader>
              <CardContent>
                <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                  {runIdFilter.slice(0, 8)}...
                </code>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        ) : discussions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No discussion summaries found</p>
              <p className="text-sm mt-2">
                Discussion summaries are created when evidence emails are processed
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Discussion Cards */}
            <div className="space-y-4">
              {discussions.map((discussion) => (
                <Card key={discussion.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Email info header */}
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className="gap-1 text-purple-700 border-purple-300 bg-purple-50"
                          >
                            <MessageCircle className="h-3 w-3" />
                            Evidence
                          </Badge>
                          {discussion.runVersion && (
                            <Badge variant="secondary" className="text-xs">
                              v{discussion.runVersion}
                            </Badge>
                          )}
                          <span className="text-xs text-gray-400">
                            {format(new Date(discussion.createdAt), "MMM d, yyyy 'at' h:mm a")}
                          </span>
                        </div>

                        {/* Email subject/filename */}
                        <Link
                          href={`/emails/${discussion.emailId}`}
                          className="text-lg font-medium text-gray-900 hover:text-purple-600 block truncate"
                        >
                          {discussion.emailSubject || discussion.emailFilename}
                        </Link>

                        {/* Email metadata */}
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                          {discussion.emailSender && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {discussion.emailSender}
                            </span>
                          )}
                          {discussion.emailDate && (
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(discussion.emailDate), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>

                        {/* Summary */}
                        <p className="mt-3 text-gray-700 leading-relaxed">
                          {discussion.summary}
                        </p>

                        {/* Reference numbers */}
                        {discussion.relatedReferenceNumbers &&
                          discussion.relatedReferenceNumbers.length > 0 && (
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-gray-500 flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                References:
                              </span>
                              {discussion.relatedReferenceNumbers.map((ref, i) => (
                                <Badge
                                  key={i}
                                  variant="secondary"
                                  className="text-xs font-mono bg-purple-50 text-purple-700"
                                >
                                  {ref}
                                </Badge>
                              ))}
                            </div>
                          )}
                      </div>

                      {/* Action button */}
                      <Link href={`/emails/${discussion.emailId}`}>
                        <Button variant="ghost" size="sm" className="shrink-0">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-6">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-gray-500">
                  Page {page + 1} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function DiscussionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50">
          <Navigation />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
          </main>
        </div>
      }
    >
      <DiscussionsContent />
    </Suspense>
  );
}
