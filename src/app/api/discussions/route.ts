import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { discussionSummaries, emails, extractionRuns } from "@/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";

// GET /api/discussions - List all discussion summaries
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const runId = searchParams.get("runId");
  const limit = parseInt(searchParams.get("limit") || "100");
  const offset = parseInt(searchParams.get("offset") || "0");

  // Build where clause
  const whereClause = runId ? eq(discussionSummaries.runId, runId) : undefined;

  // Get discussions with email and run info
  const discussions = await db
    .select({
      id: discussionSummaries.id,
      emailId: discussionSummaries.emailId,
      runId: discussionSummaries.runId,
      summary: discussionSummaries.summary,
      relatedReferenceNumbers: discussionSummaries.relatedReferenceNumbers,
      createdAt: discussionSummaries.createdAt,
      // Email info
      emailSubject: emails.subject,
      emailSender: emails.sender,
      emailDate: emails.date,
      emailFilename: emails.filename,
      // Run info
      runVersion: extractionRuns.version,
    })
    .from(discussionSummaries)
    .leftJoin(emails, eq(discussionSummaries.emailId, emails.id))
    .leftJoin(extractionRuns, eq(discussionSummaries.runId, extractionRuns.id))
    .where(whereClause)
    .orderBy(desc(discussionSummaries.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(discussionSummaries)
    .where(whereClause);

  return NextResponse.json({
    discussions,
    total: countResult?.count || 0,
    limit,
    offset,
  });
}
