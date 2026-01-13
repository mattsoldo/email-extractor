import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  qaRuns,
  qaResults,
  extractionRuns,
  transactions,
} from "@/db/schema";
import { eq, and, inArray, max, or } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// POST /api/qa/[id]/synthesize - Create synthesized run from accepted QA changes
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description } = body;

    // Get QA run
    const [qaRun] = await db
      .select()
      .from(qaRuns)
      .where(eq(qaRuns.id, id))
      .limit(1);

    if (!qaRun) {
      return NextResponse.json({ error: "QA run not found" }, { status: 404 });
    }

    if (qaRun.status !== "completed") {
      return NextResponse.json(
        { error: "QA run must be completed before synthesizing" },
        { status: 400 }
      );
    }

    if (qaRun.synthesizedRunId) {
      return NextResponse.json(
        { error: "This QA run has already been synthesized" },
        { status: 400 }
      );
    }

    // Get source run
    const [sourceRun] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.id, qaRun.sourceRunId))
      .limit(1);

    if (!sourceRun) {
      return NextResponse.json(
        { error: "Source run not found" },
        { status: 404 }
      );
    }

    // Get all QA results with accepted or partial status (these have changes to apply)
    const acceptedResults = await db
      .select()
      .from(qaResults)
      .where(
        and(
          eq(qaResults.qaRunId, id),
          or(
            eq(qaResults.status, "accepted"),
            eq(qaResults.status, "partial")
          )
        )
      );

    // Build a map of transaction ID -> changes to apply
    const changesMap = new Map<
      string,
      {
        fieldChanges: Record<string, unknown>;
        merges: Array<{ canonical: string; merged: string[] }>;
      }
    >();

    for (const result of acceptedResults) {
      const fieldChanges: Record<string, unknown> = {};
      const merges: Array<{ canonical: string; merged: string[] }> = [];

      // Apply accepted field issues
      if (result.fieldIssues && result.acceptedFields) {
        const issues = result.fieldIssues as Array<{
          field: string;
          suggestedValue: unknown;
        }>;
        const accepted = result.acceptedFields as Record<string, boolean>;

        for (const issue of issues) {
          if (accepted[issue.field] === true) {
            fieldChanges[issue.field] = issue.suggestedValue;
          }
        }
      }

      // Apply accepted merges
      if (result.duplicateFields && result.acceptedMerges) {
        const acceptedMergesList = result.acceptedMerges as Array<{
          canonical: string;
          merged: string[];
        }>;
        merges.push(...acceptedMergesList);
      }

      if (Object.keys(fieldChanges).length > 0 || merges.length > 0) {
        changesMap.set(result.transactionId, { fieldChanges, merges });
      }
    }

    // Get all transactions from source run
    const sourceTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.extractionRunId, qaRun.sourceRunId));

    // Get next version number
    const [maxVersionResult] = await db
      .select({ maxVersion: max(extractionRuns.version) })
      .from(extractionRuns)
      .where(eq(extractionRuns.setId, qaRun.setId));
    const nextVersion = (maxVersionResult?.maxVersion || 0) + 1;

    // Create the synthesized run
    const synthesizedRunId = uuid();
    const synthesizedRunName =
      name || `QA Corrected v${nextVersion} (from v${sourceRun.version})`;

    await db.insert(extractionRuns).values({
      id: synthesizedRunId,
      setId: qaRun.setId,
      version: nextVersion,
      name: synthesizedRunName,
      description:
        description ||
        `Created from QA run on v${sourceRun.version}. Applied ${changesMap.size} corrections.`,
      modelId: sourceRun.modelId,
      promptId: sourceRun.promptId,
      softwareVersion: sourceRun.softwareVersion,
      emailsProcessed: sourceRun.emailsProcessed,
      transactionsCreated: sourceTransactions.length,
      informationalCount: 0,
      errorCount: 0,
      config: {
        qaRunId: id,
        sourceRunId: qaRun.sourceRunId,
        correctionsApplied: changesMap.size,
      },
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      isSynthesized: true,
      synthesisType: "qa_corrections",
      sourceRunIds: [qaRun.sourceRunId],
    });

    // Helper to apply field changes to a transaction
    const applyChanges = (
      tx: typeof transactions.$inferSelect,
      changes: {
        fieldChanges: Record<string, unknown>;
        merges: Array<{ canonical: string; merged: string[] }>;
      }
    ): typeof transactions.$inferInsert => {
      const newTx: typeof transactions.$inferInsert = {
        ...tx,
        id: uuid(),
        extractionRunId: synthesizedRunId,
        sourceTransactionId: tx.id,
      };

      // Apply field changes
      for (const [field, value] of Object.entries(changes.fieldChanges)) {
        if (field.startsWith("data.")) {
          // Handle data.* fields
          const dataKey = field.substring(5);
          const currentData = (newTx.data || {}) as Record<string, unknown>;
          newTx.data = { ...currentData, [dataKey]: value };
        } else if (field in newTx) {
          // Direct field assignment
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (newTx as any)[field] = value;
        }
      }

      // Apply merges - copy value from data.* to canonical field and remove from data
      for (const merge of changes.merges) {
        const currentData = (newTx.data || {}) as Record<string, unknown>;

        // If canonical field is a standard field and it's empty, copy from data
        if (merge.canonical in newTx) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const canonicalValue = (newTx as any)[merge.canonical];
          if (
            canonicalValue === null ||
            canonicalValue === undefined ||
            canonicalValue === ""
          ) {
            // Find a value from merged fields
            for (const mergedField of merge.merged) {
              if (mergedField.startsWith("data.")) {
                const dataKey = mergedField.substring(5);
                if (currentData[dataKey] !== undefined) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (newTx as any)[merge.canonical] = currentData[dataKey];
                  break;
                }
              }
            }
          }
        }

        // Remove merged fields from data
        const newData = { ...currentData };
        for (const mergedField of merge.merged) {
          if (mergedField.startsWith("data.")) {
            const dataKey = mergedField.substring(5);
            delete newData[dataKey];
          }
        }
        newTx.data = newData;
      }

      return newTx;
    };

    // Create new transactions
    const newTransactions: Array<typeof transactions.$inferInsert> = [];

    for (const tx of sourceTransactions) {
      const changes = changesMap.get(tx.id);

      if (changes) {
        // Apply corrections
        newTransactions.push(applyChanges(tx, changes));
      } else {
        // Copy unchanged
        newTransactions.push({
          ...tx,
          id: uuid(),
          extractionRunId: synthesizedRunId,
          sourceTransactionId: tx.id,
        });
      }
    }

    // Insert transactions in batches
    const BATCH_SIZE = 100;
    for (let i = 0; i < newTransactions.length; i += BATCH_SIZE) {
      const batch = newTransactions.slice(i, i + BATCH_SIZE);
      await db.insert(transactions).values(batch);
    }

    // Update QA run with synthesized run ID
    await db
      .update(qaRuns)
      .set({ synthesizedRunId })
      .where(eq(qaRuns.id, id));

    return NextResponse.json({
      success: true,
      message: "Synthesized run created",
      run: {
        id: synthesizedRunId,
        name: synthesizedRunName,
        version: nextVersion,
        transactionsCreated: newTransactions.length,
        correctionsApplied: changesMap.size,
      },
    });
  } catch (error) {
    console.error("Failed to synthesize from QA:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to synthesize",
      },
      { status: 500 }
    );
  }
}
