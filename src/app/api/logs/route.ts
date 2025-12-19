import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { extractionLogs, emails } from "@/db/schema";
import { desc, eq, count } from "drizzle-orm";

// GET /api/logs - List extraction logs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const level = searchParams.get("level"); // error, warning, info
  const errorType = searchParams.get("errorType");
  const jobId = searchParams.get("jobId");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  let query = db
    .select({
      log: extractionLogs,
      email: {
        id: emails.id,
        filename: emails.filename,
        subject: emails.subject,
      },
    })
    .from(extractionLogs)
    .leftJoin(emails, eq(extractionLogs.emailId, emails.id));

  // Apply filters
  const conditions = [];
  if (level) {
    conditions.push(eq(extractionLogs.level, level));
  }
  if (errorType) {
    conditions.push(eq(extractionLogs.errorType, errorType));
  }
  if (jobId) {
    conditions.push(eq(extractionLogs.jobId, jobId));
  }

  if (conditions.length > 0) {
    const { and } = await import("drizzle-orm");
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query
    .orderBy(desc(extractionLogs.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  let countQuery = db.select({ count: count() }).from(extractionLogs);
  if (conditions.length > 0) {
    const { and } = await import("drizzle-orm");
    countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
  }
  const [{ count: total }] = await countQuery;

  // Get error type counts
  const errorTypeCounts = await db
    .select({
      errorType: extractionLogs.errorType,
      count: count(),
    })
    .from(extractionLogs)
    .groupBy(extractionLogs.errorType);

  // Get level counts
  const levelCounts = await db
    .select({
      level: extractionLogs.level,
      count: count(),
    })
    .from(extractionLogs)
    .groupBy(extractionLogs.level);

  return NextResponse.json({
    logs: results.map((r) => ({
      ...r.log,
      email: r.email,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    errorTypeCounts: Object.fromEntries(
      errorTypeCounts.map((e) => [e.errorType || "unknown", e.count])
    ),
    levelCounts: Object.fromEntries(
      levelCounts.map((l) => [l.level, l.count])
    ),
  });
}
