import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { extractionRuns } from "@/db/schema";
import { desc } from "drizzle-orm";

// GET /api/extraction-runs - List all extraction runs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = parseInt(searchParams.get("limit") || "50");

  try {
    const runs = await db
      .select()
      .from(extractionRuns)
      .orderBy(desc(extractionRuns.createdAt))
      .limit(limit);

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("Failed to fetch extraction runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch extraction runs" },
      { status: 500 }
    );
  }
}
