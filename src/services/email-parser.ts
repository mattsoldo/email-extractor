import { simpleParser, ParsedMail } from "mailparser";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";
import type { NewEmail } from "@/db/schema";

export interface ParsedEmail {
  id: string;
  filename: string;
  subject: string | null;
  sender: string | null;
  recipient: string | null;
  date: Date | null;
  bodyText: string | null;
  bodyHtml: string | null;
  rawContent: string | null; // Original .eml file content
  headers: Record<string, string>;
}

/**
 * Parse a single .eml file into structured data
 */
export async function parseEmlFile(filePath: string): Promise<ParsedEmail> {
  const content = await readFile(filePath);
  const parsed = await simpleParser(content);

  const filename = filePath.split("/").pop() || filePath;

  return {
    id: uuid(),
    filename,
    subject: parsed.subject || null,
    sender: extractEmailAddress(parsed.from),
    recipient: extractEmailAddress(parsed.to),
    date: parsed.date || null,
    bodyText: parsed.text || null,
    bodyHtml: parsed.html || null,
    rawContent: content.toString("utf-8"),
    headers: extractHeaders(parsed),
  };
}

/**
 * Parse email from buffer or string content (for file uploads)
 */
export async function parseEmlContent(
  content: Buffer | string,
  filename: string
): Promise<ParsedEmail> {
  const parsed = await simpleParser(content);

  // Store raw content as string
  const rawContent = Buffer.isBuffer(content) ? content.toString("utf-8") : content;

  return {
    id: uuid(),
    filename,
    subject: parsed.subject || null,
    sender: extractEmailAddress(parsed.from),
    recipient: extractEmailAddress(parsed.to),
    date: parsed.date || null,
    bodyText: parsed.text || null,
    bodyHtml: parsed.html || null,
    rawContent,
    headers: extractHeaders(parsed),
  };
}

/**
 * Extract email address from parsed address object
 */
function extractEmailAddress(
  addressField: ParsedMail["from"] | ParsedMail["to"]
): string | null {
  if (!addressField) return null;

  if (Array.isArray(addressField)) {
    const first = addressField[0];
    if (first && "value" in first && Array.isArray(first.value)) {
      return first.value[0]?.address || null;
    }
  }

  if ("value" in addressField && Array.isArray(addressField.value)) {
    return addressField.value[0]?.address || null;
  }

  return null;
}

/**
 * Extract relevant headers as a flat object
 */
function extractHeaders(parsed: ParsedMail): Record<string, string> {
  const headers: Record<string, string> = {};

  if (parsed.headers) {
    for (const [key, value] of parsed.headers) {
      if (typeof value === "string") {
        headers[key] = value;
      } else if (value && typeof value === "object" && "value" in value) {
        headers[key] = String(value.value);
      }
    }
  }

  return headers;
}

/**
 * Scan a directory for .eml files
 */
export async function scanEmailDirectory(
  dirPath: string
): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  const emlFiles: string[] = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".eml")) {
      emlFiles.push(join(dirPath, entry.name));
    }
  }

  return emlFiles;
}

/**
 * Convert parsed email to database insert format
 */
export function toDbEmail(parsed: ParsedEmail): NewEmail {
  return {
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
    extractionStatus: "pending",
  };
}

/**
 * Classify if an email is likely transactional vs marketing/noise
 * Returns true if it should be processed, false if it should be skipped
 */
export function classifyEmail(parsed: ParsedEmail): {
  shouldProcess: boolean;
  skipReason?: string;
} {
  const subject = (parsed.subject || "").toLowerCase();
  const sender = (parsed.sender || "").toLowerCase();

  // Marketing keywords to skip
  const marketingKeywords = [
    "important information about",
    "have officially joined forces",
    "covid-19",
    "charitable donations",
    "jump start your savings",
    "boost your savings",
    "message from e*trade",
    "competitive rate",
    "apy",
    "annual percentage yield",
    "help boost",
    "earn more on your cash",
    "earn up to",
  ];

  // Skip obvious marketing emails
  for (const keyword of marketingKeywords) {
    if (subject.includes(keyword)) {
      return { shouldProcess: false, skipReason: `marketing: ${keyword}` };
    }
  }

  // Transactional keywords that indicate we should process
  const transactionalKeywords = [
    "executed",
    "dividend",
    "interest paid",
    "wire transfer",
    "funds transfer",
    "deposit received",
    "deposit complete",
    "withdrawal",
    "restricted stock",
    "vesting",
    "released",
    "assigned",
    "expired",
    "account transfer",
    "order",
    "settled",
    "confirmation",
    "1099",
  ];

  for (const keyword of transactionalKeywords) {
    if (subject.includes(keyword)) {
      return { shouldProcess: true };
    }
  }

  // Check sender patterns
  const transactionalSenders = [
    "smartalerts-donotreply@etrade.com",
    "e-tradealerts-donotreply@etrade.com",
  ];

  for (const sender_pattern of transactionalSenders) {
    if (sender.includes(sender_pattern)) {
      // These senders send both transactional and noise, so check more carefully
      // If it doesn't match marketing keywords, process it
      return { shouldProcess: true };
    }
  }

  // Default: process unknown emails (better to have false positives than miss transactions)
  return { shouldProcess: true };
}
