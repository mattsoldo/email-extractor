import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails } from "@/db/schema";
import { desc, eq, and, count } from "drizzle-orm";

// GET /api/emails - List emails with filtering
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status"); // pending, completed, failed, skipped, informational
  const setId = searchParams.get("setId"); // filter by email set
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];
  if (status) {
    conditions.push(eq(emails.extractionStatus, status as typeof emails.extractionStatus.enumValues[number]));
  }
  if (setId) {
    conditions.push(eq(emails.setId, setId));
  }

  const whereClause = conditions.length > 0
    ? conditions.length === 1 ? conditions[0] : and(...conditions)
    : undefined;

  const results = await db
    .select()
    .from(emails)
    .where(whereClause)
    .orderBy(desc(emails.date))
    .limit(limit)
    .offset(offset);

  // Get total count with same filters
  const [{ count: total }] = await db
    .select({ count: count() })
    .from(emails)
    .where(whereClause);

  // Get status counts (filtered by set if applicable)
  const statusCountsQuery = setId
    ? db
        .select({
          status: emails.extractionStatus,
          count: count(),
        })
        .from(emails)
        .where(eq(emails.setId, setId))
        .groupBy(emails.extractionStatus)
    : db
        .select({
          status: emails.extractionStatus,
          count: count(),
        })
        .from(emails)
        .groupBy(emails.extractionStatus);

  const statusCounts = await statusCountsQuery;

  return NextResponse.json({
    emails: results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    statusCounts: Object.fromEntries(
      statusCounts.map((s) => [s.status, s.count])
    ),
  });
}
