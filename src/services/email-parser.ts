import { simpleParser, ParsedMail } from "mailparser";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { v4 as uuid } from "uuid";
import type { NewEmail } from "@/db/schema";

export interface ParsedEmail {
  id: string;
  filename: string;

  // Structured header fields
  subject: string | null;
  sender: string | null; // Email address
  senderName: string | null; // Display name
  recipient: string | null; // Email address
  recipientName: string | null; // Display name
  cc: string | null; // Comma-separated CC addresses
  replyTo: string | null;
  messageId: string | null;
  inReplyTo: string | null;

  // Date fields
  date: Date | null; // Date header
  receivedAt: Date | null; // First Received header timestamp

  // Body content
  bodyText: string | null;
  bodyHtml: string | null;
  rawContent: string | null; // Original .eml file content

  // Additional headers (for anything not in structured fields)
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
    senderName: extractDisplayName(parsed.from),
    recipient: extractEmailAddress(parsed.to),
    recipientName: extractDisplayName(parsed.to),
    cc: extractAllAddresses(parsed.cc),
    replyTo: extractEmailAddress(parsed.replyTo),
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    date: parsed.date || null,
    receivedAt: extractReceivedDate(parsed),
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
    senderName: extractDisplayName(parsed.from),
    recipient: extractEmailAddress(parsed.to),
    recipientName: extractDisplayName(parsed.to),
    cc: extractAllAddresses(parsed.cc),
    replyTo: extractEmailAddress(parsed.replyTo),
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    date: parsed.date || null,
    receivedAt: extractReceivedDate(parsed),
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
  addressField: ParsedMail["from"] | ParsedMail["to"] | ParsedMail["replyTo"]
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
 * Extract display name from parsed address object
 */
function extractDisplayName(
  addressField: ParsedMail["from"] | ParsedMail["to"]
): string | null {
  if (!addressField) return null;

  if (Array.isArray(addressField)) {
    const first = addressField[0];
    if (first && "value" in first && Array.isArray(first.value)) {
      return first.value[0]?.name || null;
    }
  }

  if ("value" in addressField && Array.isArray(addressField.value)) {
    return addressField.value[0]?.name || null;
  }

  return null;
}

/**
 * Extract all email addresses from an address field (for CC, etc.)
 * Returns comma-separated string of addresses
 */
function extractAllAddresses(
  addressField: ParsedMail["cc"]
): string | null {
  if (!addressField) return null;

  const addresses: string[] = [];

  if (Array.isArray(addressField)) {
    for (const addr of addressField) {
      if (addr && "value" in addr && Array.isArray(addr.value)) {
        for (const v of addr.value) {
          if (v.address) addresses.push(v.address);
        }
      }
    }
  } else if ("value" in addressField && Array.isArray(addressField.value)) {
    for (const v of addressField.value) {
      if (v.address) addresses.push(v.address);
    }
  }

  return addresses.length > 0 ? addresses.join(", ") : null;
}

/**
 * Extract the received date from the first Received header
 * This represents when the email was actually received by the server
 */
function extractReceivedDate(parsed: ParsedMail): Date | null {
  if (!parsed.headers) return null;

  // Get the first Received header (most recent)
  const received = parsed.headers.get("received");
  if (!received) return null;

  // Received header format typically ends with a date like:
  // "from ... by ... ; Mon, 15 Jan 2024 10:30:00 -0500"
  const receivedStr = typeof received === "string" ? received : String(received);

  // Try to find and parse the date portion after the semicolon
  const semicolonIndex = receivedStr.lastIndexOf(";");
  if (semicolonIndex !== -1) {
    const dateStr = receivedStr.substring(semicolonIndex + 1).trim();
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
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

    // Structured header fields
    subject: parsed.subject,
    sender: parsed.sender,
    senderName: parsed.senderName,
    recipient: parsed.recipient,
    recipientName: parsed.recipientName,
    cc: parsed.cc,
    replyTo: parsed.replyTo,
    messageId: parsed.messageId,
    inReplyTo: parsed.inReplyTo,

    // Date fields
    date: parsed.date,
    receivedAt: parsed.receivedAt,

    // Body content
    bodyText: parsed.bodyText,
    bodyHtml: parsed.bodyHtml,
    rawContent: parsed.rawContent,

    // Additional headers
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
