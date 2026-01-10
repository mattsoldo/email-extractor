import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/db";
import { emails, emailSets, NewEmail } from "@/db/schema";
import { parseEmlContent, parseTxtContent, toDbEmail, classifyEmail } from "@/services/email-parser";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import JSZip from "jszip";
import { createHash } from "crypto";

// Compute SHA-256 hash of email content for deduplication
function computeContentHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

// Configure for file uploads - increase body size limit
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Increase max body size to 100MB for large zip files
export const maxDuration = 60; // 60 seconds timeout for processing

interface DocumentFile {
  filename: string;
  content: Buffer;
  type: "eml" | "txt";
}

// Extract .eml and .txt files from a zip archive
async function extractDocumentsFromZip(zipBuffer: Buffer): Promise<DocumentFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: DocumentFile[] = [];

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    // Skip directories
    if (zipEntry.dir) continue;

    const lowerPath = path.toLowerCase();
    const filename = path.split("/").pop() || path;
    const content = await zipEntry.async("nodebuffer");

    if (lowerPath.endsWith(".eml")) {
      files.push({ filename, content, type: "eml" });
    } else if (lowerPath.endsWith(".txt")) {
      files.push({ filename, content, type: "txt" });
    }
  }

  return files;
}

// POST /api/emails/upload - Upload .eml, .txt, or .zip files
export async function POST(request: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (formError) {
      console.error("FormData parsing error:", formError);
      return NextResponse.json(
        { error: "Failed to parse form data" },
        { status: 400 }
      );
    }

    const files = formData.getAll("files") as File[];
    const setName = formData.get("setName") as string | null;
    const existingSetId = formData.get("setId") as string | null;

    console.log(`Received ${files.length} files for upload, setName: ${setName}, setId: ${existingSetId}`);

    // Collect all document files (extract from zips if needed)
    const documentFiles: DocumentFile[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith(".zip")) {
        // Extract documents from zip
        console.log(`Extracting documents from zip: ${file.name}`);
        const extracted = await extractDocumentsFromZip(buffer);
        console.log(`Found ${extracted.length} files (.eml/.txt) in ${file.name}`);
        documentFiles.push(...extracted);
      } else if (lowerName.endsWith(".eml")) {
        documentFiles.push({ filename: file.name, content: buffer, type: "eml" });
      } else if (lowerName.endsWith(".txt")) {
        documentFiles.push({ filename: file.name, content: buffer, type: "txt" });
      }
      // Ignore other file types
    }

    console.log(`Total document files to process: ${documentFiles.length}`);

    // Use existing set (for batch uploads) or create a new one
    let targetSetId: string;
    let createdSet: { id: string; name: string } | null = null;

    if (existingSetId) {
      // Use existing set (typically for subsequent batches in multi-batch upload)
      targetSetId = existingSetId;
    } else {
      // Create a new set for this upload
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const newSet = {
        id: uuid(),
        name: setName?.trim() || `Upload ${timestamp}`,
      };
      await db.insert(emailSets).values(newSet);
      targetSetId = newSet.id;
      createdSet = newSet;
    }

    if (documentFiles.length === 0) {
      return NextResponse.json(
        { error: "No supported files found (upload .eml, .txt files or a .zip containing them)" },
        { status: 400 }
      );
    }

    const results = {
      uploaded: 0,
      skipped: 0,
      duplicates: 0,
      failed: 0,
      details: [] as Array<{
        filename: string;
        status: "uploaded" | "skipped" | "duplicate" | "failed";
        reason?: string;
        emailId?: string;
        existingEmailId?: string;
      }>,
    };

    for (const docFile of documentFiles) {
      try {
        // Compute content hash for deduplication
        const contentHash = computeContentHash(docFile.content);

        // Check if this document already exists (by content hash)
        let existingDoc: { id: string; subject: string | null }[] = [];
        try {
          existingDoc = await db
            .select({ id: emails.id, subject: emails.subject })
            .from(emails)
            .where(eq(emails.contentHash, contentHash))
            .limit(1);
        } catch (dbError) {
          // If contentHash column doesn't exist, skip dedup check
          console.warn("Dedup check failed (contentHash column may not exist):", dbError);
        }

        if (existingDoc.length > 0) {
          // Document already exists - skip as duplicate
          results.duplicates++;
          results.details.push({
            filename: docFile.filename,
            status: "duplicate",
            reason: `Duplicate of existing document (subject: "${existingDoc[0].subject || 'No subject'}")`,
            existingEmailId: existingDoc[0].id,
          });
          continue;
        }

        // Store in Vercel Blob (optional - for backup/reference)
        let blobUrl: string | null = null;
        const contentType = docFile.type === "txt" ? "text/plain" : "message/rfc822";
        try {
          const blob = await put(`emails/${docFile.filename}`, docFile.content, {
            access: "public",
            contentType,
          });
          blobUrl = blob.url;
        } catch (blobError) {
          // Blob storage is optional - continue even if it fails
          // This allows local development without blob storage
          console.warn("Blob storage unavailable, continuing without:", blobError);
        }

        // Parse the document based on type
        const parsed = docFile.type === "txt"
          ? parseTxtContent(docFile.content, docFile.filename)
          : await parseEmlContent(docFile.content, docFile.filename);
        const classification = classifyEmail(parsed);

        // Create database record with all fields
        const dbEmailCore: NewEmail = {
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
          // Structured header fields from mailparser
          senderName: parsed.senderName || null,
          recipientName: parsed.recipientName || null,
          cc: parsed.cc || null,
          replyTo: parsed.replyTo || null,
          messageId: parsed.messageId || null,
          inReplyTo: parsed.inReplyTo || null,
          receivedAt: parsed.receivedAt || null,
        };

        // Add blob URL to metadata if available
        if (blobUrl) {
          dbEmailCore.headers = {
            ...(dbEmailCore.headers as Record<string, string>),
            _blobUrl: blobUrl,
          };
        }

        try {
          await db.insert(emails).values(dbEmailCore);
        } catch (insertError) {
          // If insert fails (possibly due to new columns), try with minimal fields
          console.warn("Full insert failed, trying minimal insert:", insertError);
          const minimalEmail = {
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
            extractionStatus: classification.shouldProcess ? "pending" as const : "non_financial" as const,
            skipReason: classification.skipReason || null,
          };
          await db.insert(emails).values(minimalEmail);
        }

        results.uploaded++;
        results.details.push({
          filename: docFile.filename,
          status: "uploaded",
          emailId: parsed.id,
        });
      } catch (fileError) {
        console.error(`Failed to process ${docFile.filename}:`, fileError);
        results.failed++;
        results.details.push({
          filename: docFile.filename,
          status: "failed",
          reason: fileError instanceof Error ? fileError.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      message: `Processed ${documentFiles.length} document(s)`,
      results,
      set: createdSet || (targetSetId ? { id: targetSetId } : null),
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Failed to process upload" },
      { status: 500 }
    );
  }
}
