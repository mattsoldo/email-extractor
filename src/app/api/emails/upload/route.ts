import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/db";
import { emails, emailSets } from "@/db/schema";
import { parseEmlContent, toDbEmail, classifyEmail } from "@/services/email-parser";
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

interface EmailFile {
  filename: string;
  content: Buffer;
}

// Extract .eml files from a zip archive
async function extractEmlFromZip(zipBuffer: Buffer): Promise<EmailFile[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const emlFiles: EmailFile[] = [];

  for (const [path, zipEntry] of Object.entries(zip.files)) {
    // Skip directories and non-.eml files
    if (zipEntry.dir || !path.toLowerCase().endsWith(".eml")) {
      continue;
    }

    // Get just the filename (not the full path)
    const filename = path.split("/").pop() || path;
    const content = await zipEntry.async("nodebuffer");
    emlFiles.push({ filename, content });
  }

  return emlFiles;
}

// POST /api/emails/upload - Upload .eml or .zip files
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

    // Collect all email files (extract from zips if needed)
    const emailFiles: EmailFile[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (file.name.toLowerCase().endsWith(".zip")) {
        // Extract emails from zip
        console.log(`Extracting emails from zip: ${file.name}`);
        const extracted = await extractEmlFromZip(buffer);
        console.log(`Found ${extracted.length} .eml files in ${file.name}`);
        emailFiles.push(...extracted);
      } else if (file.name.toLowerCase().endsWith(".eml")) {
        emailFiles.push({ filename: file.name, content: buffer });
      }
      // Ignore other file types
    }

    console.log(`Total email files to process: ${emailFiles.length}`);

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

    if (emailFiles.length === 0) {
      return NextResponse.json(
        { error: "No .eml files found (upload .eml files or a .zip containing them)" },
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

    for (const emailFile of emailFiles) {
      try {
        // Compute content hash for deduplication
        const contentHash = computeContentHash(emailFile.content);

        // Check if this email already exists (by content hash)
        const existingEmail = await db
          .select({ id: emails.id, subject: emails.subject })
          .from(emails)
          .where(eq(emails.contentHash, contentHash))
          .limit(1);

        if (existingEmail.length > 0) {
          // Email already exists - skip as duplicate
          results.duplicates++;
          results.details.push({
            filename: emailFile.filename,
            status: "duplicate",
            reason: `Duplicate of existing email (subject: "${existingEmail[0].subject || 'No subject'}")`,
            existingEmailId: existingEmail[0].id,
          });
          continue;
        }

        // Store in Vercel Blob (optional - for backup/reference)
        let blobUrl: string | null = null;
        try {
          const blob = await put(`emails/${emailFile.filename}`, emailFile.content, {
            access: "public",
            contentType: "message/rfc822",
          });
          blobUrl = blob.url;
        } catch (blobError) {
          // Blob storage is optional - continue even if it fails
          // This allows local development without blob storage
          console.warn("Blob storage unavailable, continuing without:", blobError);
        }

        // Parse the email
        const parsed = await parseEmlContent(emailFile.content, emailFile.filename);
        const classification = classifyEmail(parsed);

        // Create database record
        const dbEmail = toDbEmail(parsed);

        if (!classification.shouldProcess) {
          dbEmail.extractionStatus = "skipped";
          dbEmail.skipReason = classification.skipReason;
        }

        // Add blob URL to metadata if available
        if (blobUrl) {
          dbEmail.headers = {
            ...dbEmail.headers,
            _blobUrl: blobUrl,
          };
        }

        // Add content hash and set reference
        (dbEmail as Record<string, unknown>).contentHash = contentHash;
        (dbEmail as Record<string, unknown>).setId = targetSetId;

        await db.insert(emails).values(dbEmail);

        results.uploaded++;
        results.details.push({
          filename: emailFile.filename,
          status: "uploaded",
          emailId: dbEmail.id,
        });
      } catch (fileError) {
        console.error(`Failed to process ${emailFile.filename}:`, fileError);
        results.failed++;
        results.details.push({
          filename: emailFile.filename,
          status: "failed",
          reason: fileError instanceof Error ? fileError.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      message: `Processed ${emailFiles.length} email(s)`,
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
