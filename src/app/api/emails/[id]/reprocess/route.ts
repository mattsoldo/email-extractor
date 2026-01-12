import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, transactions, emailExtractions, extractionRuns, prompts, discussionSummaries } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { extractTransaction } from "@/services/ai-extractor";
import { normalizeTransaction, detectOrCreateAccount } from "@/services/transaction-normalizer";
import { DEFAULT_MODEL_ID } from "@/services/ai-extractor";
import { SOFTWARE_VERSION } from "@/config/version";

/**
 * POST /api/emails/[id]/reprocess - Re-analyze a single email
 *
 * Request body:
 * - promptId: string (required) - ID of the prompt to use
 * - customPromptContent: string (optional) - Custom prompt content to override
 * - modelId: string (optional) - Model to use, defaults to default model
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: emailId } = await params;

  try {
    const body = await request.json();
    const { promptId, customPromptContent, modelId } = body;

    if (!promptId) {
      return NextResponse.json(
        { error: "promptId is required" },
        { status: 400 }
      );
    }

    // Fetch the email
    const emailResult = await db
      .select()
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);

    if (emailResult.length === 0) {
      return NextResponse.json(
        { error: "Email not found" },
        { status: 404 }
      );
    }

    const email = emailResult[0];

    // Fetch the prompt
    const promptResult = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, promptId))
      .limit(1);

    if (promptResult.length === 0) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    const prompt = promptResult[0];
    const promptContent = customPromptContent || prompt.content;
    const effectiveModelId = modelId || DEFAULT_MODEL_ID;

    // Create a new extraction run for this single email reprocess
    const runId = uuid();
    const effectiveSetId = email.setId || "default";
    const runVersion = await getNextRunVersion(effectiveSetId);

    await db.insert(extractionRuns).values({
      id: runId,
      jobId: null, // No job for single email reprocess
      setId: effectiveSetId,
      modelId: effectiveModelId,
      promptId: promptId,
      version: runVersion,
      softwareVersion: SOFTWARE_VERSION,
      status: "running",
      emailsProcessed: 0,
      transactionsCreated: 0,
      informationalCount: 0,
      errorCount: 0,
      startedAt: new Date(),
      name: `Reprocess: ${email.subject || email.filename}`,
      description: `Single email reprocessed from transaction view`,
    });

    // Prepare email for extraction
    const parsedEmail = {
      id: email.id,
      filename: email.filename,
      subject: email.subject,
      sender: email.sender,
      recipient: email.recipient,
      date: email.date,
      bodyText: email.bodyText,
      bodyHtml: email.bodyHtml,
      rawContent: email.rawContent,
      headers: (email.headers as Record<string, string>) || {},
      senderName: email.senderName,
      recipientName: email.recipientName,
      cc: email.cc,
      replyTo: email.replyTo,
      messageId: email.messageId,
      inReplyTo: email.inReplyTo,
      receivedAt: email.receivedAt,
    };

    const startTime = Date.now();

    // Run extraction
    const extraction = await extractTransaction(
      parsedEmail,
      effectiveModelId,
      promptContent,
      prompt.jsonSchema as Record<string, unknown> | null
    );

    const processingTimeMs = Date.now() - startTime;

    // Process extraction results
    const createdTransactionIds: string[] = [];
    let transactionsCreated = 0;
    let informationalCount = 0;
    let errorCount = 0;
    const discussionSummary = extraction.discussionSummary?.trim() || null;
    const relatedReferenceNumbers = Array.isArray(extraction.relatedReferenceNumbers)
      ? extraction.relatedReferenceNumbers
      : [];
    const isEvidence = extraction.emailType === "evidence";

    if (!isEvidence && extraction.isTransactional && extraction.transactions && extraction.transactions.length > 0) {
      // Process each transaction
      for (const txn of extraction.transactions) {
        try {
          // Detect or create from account
          let fromAccountId: string | null = null;
          if (txn.accountNumber || txn.institution || txn.accountName) {
            const account = await detectOrCreateAccount({
              accountNumber: txn.accountNumber || undefined,
              institution: txn.institution || undefined,
              accountName: txn.accountName || undefined,
            });
            if (account) fromAccountId = account.id;
          }

          // Handle destination account for transfers
          let toAccountId: string | null = null;
          if (txn.toAccountNumber || txn.toInstitution || txn.toAccountName) {
            const toAccount = await detectOrCreateAccount({
              accountNumber: txn.toAccountNumber || undefined,
              institution: txn.toInstitution || undefined,
              accountName: txn.toAccountName || undefined,
              isExternal: true,
            });
            if (toAccount) toAccountId = toAccount.id;
          }

          // Create extraction object for normalizeTransaction
          const extractionForNormalize = {
            ...txn,
            isTransaction: true as const,
            extractionNotes: null,
          };

          const normalized = normalizeTransaction(extractionForNormalize, fromAccountId, toAccountId);

          // Create transaction
          const transactionId = uuid();
          await db.insert(transactions).values({
            ...normalized,
            id: transactionId,
            sourceEmailId: emailId,
            extractionRunId: runId,
            llmModel: effectiveModelId,
          });

          createdTransactionIds.push(transactionId);
          transactionsCreated++;
        } catch (txnError) {
          console.error("Failed to create transaction:", txnError);
          errorCount++;
        }
      }

      // Update email status
      await db
        .update(emails)
        .set({
          extractionStatus: "completed",
          rawExtraction: extraction as unknown as Record<string, unknown>,
          processedAt: new Date(),
        })
        .where(eq(emails.id, emailId));
    } else {
      // Not transactional - mark as informational
      informationalCount = 1;
      const notes = extraction.extractionNotes ||
        `Non-transactional email (type: ${extraction.emailType})`;

      await db
        .update(emails)
        .set({
          extractionStatus: "informational",
          informationalNotes: notes,
          rawExtraction: extraction as unknown as Record<string, unknown>,
          processedAt: new Date(),
        })
        .where(eq(emails.id, emailId));
    }

    if (discussionSummary) {
      await db.insert(discussionSummaries).values({
        id: uuid(),
        emailId,
        runId,
        summary: discussionSummary,
        relatedReferenceNumbers,
      });
    }

    // Create email extraction record with properly typed rawExtraction
    const rawExtractionData = {
      isTransactional: extraction.isTransactional,
      emailType: extraction.emailType,
      transactions: extraction.transactions as unknown as Array<Record<string, unknown>>,
      extractionNotes: extraction.extractionNotes || undefined,
      discussionSummary,
      relatedReferenceNumbers,
    };

    await db.insert(emailExtractions).values({
      id: uuid(),
      emailId: emailId,
      runId: runId,
      status: errorCount > 0 ? "failed" : informationalCount > 0 ? "informational" : "completed",
      rawExtraction: rawExtractionData,
      confidence: extraction.transactions?.[0]?.confidence?.toString() || null,
      processingTimeMs: processingTimeMs,
      transactionIds: createdTransactionIds,
      error: errorCount > 0 ? "Extraction failed" : null,
    });

    // Complete the extraction run
    await db
      .update(extractionRuns)
      .set({
        status: "completed",
        emailsProcessed: 1,
        transactionsCreated: transactionsCreated,
        informationalCount: informationalCount,
        errorCount: errorCount,
        completedAt: new Date(),
      })
      .where(eq(extractionRuns.id, runId));

    return NextResponse.json({
      success: true,
      runId: runId,
      transactionsCreated: transactionsCreated,
      transactionIds: createdTransactionIds,
      isTransactional: extraction.isTransactional,
      emailType: extraction.emailType,
      extractionNotes: extraction.extractionNotes,
      discussionSummary,
      relatedReferenceNumbers,
    });
  } catch (error) {
    console.error("Reprocess error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reprocess email" },
      { status: 500 }
    );
  }
}

async function getNextRunVersion(setId: string): Promise<number> {
  const lastRun = await db
    .select({ version: extractionRuns.version })
    .from(extractionRuns)
    .where(eq(extractionRuns.setId, setId))
    .orderBy(desc(extractionRuns.version))
    .limit(1);

  return (lastRun[0]?.version || 0) + 1;
}
