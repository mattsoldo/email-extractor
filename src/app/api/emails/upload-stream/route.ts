import { NextRequest } from "next/server";
import { db } from "@/db";
import { emails, emailSets, NewEmail } from "@/db/schema";
import { parseEmlContent, parseTxtContent, classifyEmail } from "@/services/email-parser";
import { eq, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import JSZip from "jszip";
import { createHash } from "crypto";

// Configure for file uploads
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Note: Vercel Hobby plan has 4.5MB payload limit, Pro has 10MB
// Hobby plan also has 10s timeout, Pro+ needed for longer durations
export const maxDuration = 300; // 5 minutes for large uploads (requires Pro+ plan)

interface DocumentFile {
  filename: string;
  content: Buffer;
  type: "eml" | "txt";
}

interface ProgressEvent {
  stage: "extracting" | "parsing" | "saving" | "complete" | "error";
  message: string;
  current: number;
  total: number;
  setId?: string;
  details?: {
    uploaded: number;
    skipped: number;
    duplicates: number;
    failed: number;
  };
}

function computeContentHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

// Extract documents from zip - optimized to stream results
async function extractDocumentsFromZip(zipBuffer: Buffer): Promise<DocumentFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: DocumentFile[] = [];

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    const lowerPath = path.toLowerCase();
    const filename = path.split("/").pop() || path;

    if (lowerPath.endsWith(".eml") || lowerPath.endsWith(".txt")) {
      const content = await zipEntry.async("nodebuffer");
      files.push({
        filename,
        content,
        type: lowerPath.endsWith(".txt") ? "txt" : "eml",
      });
    }
  }

  return files;
}

// Parse emails in parallel with concurrency limit
async function parseEmailsBatch(
  files: DocumentFile[],
  concurrency: number = 20
): Promise<Array<{ file: DocumentFile; parsed: Awaited<ReturnType<typeof parseEmlContent>>; classification: ReturnType<typeof classifyEmail> }>> {
  const results: Array<{ file: DocumentFile; parsed: Awaited<ReturnType<typeof parseEmlContent>>; classification: ReturnType<typeof classifyEmail> }> = [];

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (file) => {
        const parsed = file.type === "txt"
          ? parseTxtContent(file.content, file.filename)
          : await parseEmlContent(file.content, file.filename);
        const classification = classifyEmail(parsed);
        return { file, parsed, classification };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

// POST /api/emails/upload-stream - Upload with streaming progress
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // Parse form data
        let formData: FormData;
        try {
          formData = await request.formData();
        } catch (formError: unknown) {
          // Check if it's a payload size error
          if (formError instanceof Error &&
              (formError.message.includes("payload") ||
               formError.message.includes("size") ||
               formError.message.includes("too large"))) {
            sendProgress({
              stage: "error",
              message: "File size exceeds limit. Vercel Hobby plan supports up to 4.5MB. Please upgrade to Pro for 10MB+ uploads.",
              current: 0,
              total: 0,
            });
            controller.close();
            return;
          }
          throw formError;
        }
        const files = formData.getAll("files") as File[];
        const setName = formData.get("setName") as string | null;
        const existingSetId = formData.get("setId") as string | null;

        sendProgress({
          stage: "extracting",
          message: "Reading uploaded files...",
          current: 0,
          total: files.length,
        });

        // Collect all document files
        const documentFiles: DocumentFile[] = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const lowerName = file.name.toLowerCase();

          if (lowerName.endsWith(".zip")) {
            sendProgress({
              stage: "extracting",
              message: `Extracting ${file.name}...`,
              current: i + 1,
              total: files.length,
            });
            const extracted = await extractDocumentsFromZip(buffer);
            documentFiles.push(...extracted);
          } else if (lowerName.endsWith(".eml")) {
            documentFiles.push({ filename: file.name, content: buffer, type: "eml" });
          } else if (lowerName.endsWith(".txt")) {
            documentFiles.push({ filename: file.name, content: buffer, type: "txt" });
          }
        }

        if (documentFiles.length === 0) {
          sendProgress({
            stage: "error",
            message: "No supported files found (.eml, .txt, or .zip)",
            current: 0,
            total: 0,
          });
          controller.close();
          return;
        }

        sendProgress({
          stage: "extracting",
          message: `Found ${documentFiles.length} emails to process`,
          current: files.length,
          total: files.length,
        });

        // Create or use email set
        let targetSetId: string;
        let createdSet: { id: string; name: string } | null = null;

        if (existingSetId) {
          targetSetId = existingSetId;
        } else {
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          const newSet = {
            id: uuid(),
            name: setName?.trim() || `Upload ${timestamp}`,
          };
          await db.insert(emailSets).values(newSet);
          targetSetId = newSet.id;
          createdSet = newSet;
        }

        // Send setId early so frontend can track for cancellation
        sendProgress({
          stage: "extracting",
          message: `Created set, processing ${documentFiles.length} emails...`,
          current: files.length,
          total: files.length,
          setId: targetSetId,
        });

        // Parse emails in parallel
        sendProgress({
          stage: "parsing",
          message: "Parsing email content...",
          current: 0,
          total: documentFiles.length,
        });

        const parsedEmails = await parseEmailsBatch(documentFiles, 50);

        sendProgress({
          stage: "parsing",
          message: `Parsed ${parsedEmails.length} emails`,
          current: documentFiles.length,
          total: documentFiles.length,
        });

        // Compute hashes and check for duplicates
        sendProgress({
          stage: "saving",
          message: "Checking for duplicates...",
          current: 0,
          total: parsedEmails.length,
        });

        const emailsWithHashes = parsedEmails.map(({ file, parsed, classification }) => ({
          file,
          parsed,
          classification,
          contentHash: computeContentHash(file.content),
        }));

        // Get all existing hashes in one query
        const allHashes = emailsWithHashes.map(e => e.contentHash);
        let existingHashSet = new Set<string>();

        if (allHashes.length > 0) {
          try {
            const existingHashes = await db
              .select({ contentHash: emails.contentHash })
              .from(emails)
              .where(inArray(emails.contentHash, allHashes));
            existingHashSet = new Set(
              existingHashes
                .map(e => e.contentHash)
                .filter((hash): hash is string => hash !== null)
            );
          } catch (hashError) {
            console.error("Error checking for duplicates:", hashError);
            // Continue without deduplication if check fails
          }
        }

        // Prepare batch insert
        const results = {
          uploaded: 0,
          skipped: 0,
          duplicates: 0,
          failed: 0,
        };

        const emailsToInsert: NewEmail[] = [];

        for (const { file, parsed, classification, contentHash } of emailsWithHashes) {
          if (existingHashSet.has(contentHash)) {
            results.duplicates++;
            continue;
          }

          const dbEmail: NewEmail = {
            id: parsed.id,
            filename: parsed.filename,
            subject: parsed.subject,
            sender: parsed.sender,
            recipient: parsed.recipient,
            date: parsed.date,
            bodyText: parsed.bodyText,
            bodyHtml: parsed.bodyHtml,
            rawContent: parsed.rawContent,
            headers: parsed.headers,
            extractionStatus: classification.shouldProcess ? "pending" : "non_financial",
            skipReason: classification.skipReason || null,
            contentHash,
            setId: targetSetId,
            senderName: parsed.senderName || null,
            recipientName: parsed.recipientName || null,
            cc: parsed.cc || null,
            replyTo: parsed.replyTo || null,
            messageId: parsed.messageId || null,
            inReplyTo: parsed.inReplyTo || null,
            receivedAt: parsed.receivedAt || null,
          };

          emailsToInsert.push(dbEmail);
        }

        // Batch insert emails (in chunks of 100)
        const BATCH_SIZE = 100;
        const totalBatches = Math.ceil(emailsToInsert.length / BATCH_SIZE);

        for (let i = 0; i < emailsToInsert.length; i += BATCH_SIZE) {
          const batch = emailsToInsert.slice(i, i + BATCH_SIZE);
          const batchNum = Math.floor(i / BATCH_SIZE) + 1;

          sendProgress({
            stage: "saving",
            message: `Saving emails (batch ${batchNum}/${totalBatches})...`,
            current: Math.min(i + BATCH_SIZE, emailsToInsert.length),
            total: emailsToInsert.length,
            details: results,
          });

          try {
            await db.insert(emails).values(batch);
            results.uploaded += batch.length;
          } catch (insertError) {
            console.error("Batch insert failed:", insertError);
            // Fall back to individual inserts
            for (const email of batch) {
              try {
                await db.insert(emails).values(email);
                results.uploaded++;
              } catch {
                results.failed++;
              }
            }
          }
        }

        // Update email set count
        await db
          .update(emailSets)
          .set({
            emailCount: results.uploaded,
            updatedAt: new Date(),
          })
          .where(eq(emailSets.id, targetSetId));

        // Send final progress
        sendProgress({
          stage: "complete",
          message: `Upload complete! ${results.uploaded} saved, ${results.duplicates} duplicates, ${results.failed} failed`,
          current: emailsToInsert.length,
          total: emailsToInsert.length,
          details: results,
        });

        controller.close();
      } catch (error) {
        console.error("Upload error:", error);
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({
            stage: "error",
            message: `Upload failed: ${errorMessage}`,
            current: 0,
            total: 0,
          })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
