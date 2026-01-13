import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { qaRuns, qaResults, extractionRuns, prompts, emailSets } from "@/db/schema";
import { desc, eq, count, sql } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { v4 as uuid } from "uuid";

// GET /api/qa - List QA runs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  // Get QA runs with source run info
  const runs = await db
    .select({
      qaRun: qaRuns,
      sourceRun: {
        id: extractionRuns.id,
        version: extractionRuns.version,
        name: extractionRuns.name,
        transactionsCreated: extractionRuns.transactionsCreated,
      },
      set: {
        id: emailSets.id,
        name: emailSets.name,
      },
    })
    .from(qaRuns)
    .leftJoin(extractionRuns, eq(qaRuns.sourceRunId, extractionRuns.id))
    .leftJoin(emailSets, eq(qaRuns.setId, emailSets.id))
    .orderBy(desc(qaRuns.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [{ count: total }] = await db.select({ count: count() }).from(qaRuns);

  return NextResponse.json({
    runs: runs.map((r) => ({
      ...r.qaRun,
      sourceRun: r.sourceRun,
      set: r.set,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

// POST /api/qa - Create a new QA run
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceRunId, modelId, promptId, filters } = body;

    if (!sourceRunId) {
      return NextResponse.json(
        { error: "sourceRunId is required" },
        { status: 400 }
      );
    }
    if (!modelId) {
      return NextResponse.json(
        { error: "modelId is required" },
        { status: 400 }
      );
    }
    if (!promptId) {
      return NextResponse.json(
        { error: "promptId is required" },
        { status: 400 }
      );
    }

    // Validate source run exists
    const [sourceRun] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.id, sourceRunId))
      .limit(1);

    if (!sourceRun) {
      return NextResponse.json(
        { error: "Source run not found" },
        { status: 404 }
      );
    }

    // Validate prompt exists
    const [prompt] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId))
      .limit(1);

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    // Create the QA run record
    const qaRunId = uuid();
    await db.insert(qaRuns).values({
      id: qaRunId,
      setId: sourceRun.setId,
      sourceRunId,
      modelId,
      promptId,
      status: "pending",
      config: filters ? { filters } : null,
    });

    // Send event to Inngest to start QA processing
    await inngest.send({
      name: "qa/started",
      data: {
        qaRunId,
        sourceRunId,
        modelId,
        promptId,
        filters,
      },
    });

    return NextResponse.json({
      success: true,
      message: "QA run started",
      qaRunId,
    });
  } catch (error) {
    console.error("Failed to create QA run:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create QA run" },
      { status: 500 }
    );
  }
}
