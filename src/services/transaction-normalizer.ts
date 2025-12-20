import { v4 as uuid } from "uuid";
import { db } from "@/db";
import {
  accounts,
  transactions,
  corpusSuggestions,
  type NewTransaction,
  type Account,
} from "@/db/schema";
import { eq, or, and, like, sql } from "drizzle-orm";
import type { SingleTransaction } from "./ai-extractor";

// Type alias for backwards compatibility
type TransactionExtraction = SingleTransaction & {
  isTransaction?: boolean;
  extractionNotes?: string | null;
};

/**
 * Account detection/creation input
 */
export interface AccountInput {
  accountNumber?: string | null;
  accountName?: string | null;
  institution?: string | null;
  isExternal?: boolean;
}

/**
 * Normalize an account number to a consistent format for matching
 */
export function normalizeAccountNumber(accountNumber: string): string {
  // Remove spaces, dashes, and convert to uppercase
  return accountNumber.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Extract the last 4 digits from an account number
 */
export function extractLast4(accountNumber: string): string | null {
  const normalized = normalizeAccountNumber(accountNumber);
  // Match pattern like XXXX1234 or just 1234 at the end
  const match = normalized.match(/(\d{4})$/);
  return match ? match[1] : null;
}

/**
 * Check if two account numbers likely refer to the same account
 */
export function accountNumbersMatch(a: string, b: string): boolean {
  const normA = normalizeAccountNumber(a);
  const normB = normalizeAccountNumber(b);

  // Exact match
  if (normA === normB) return true;

  // Both have last 4 digits that match
  const last4A = extractLast4(normA);
  const last4B = extractLast4(normB);

  if (last4A && last4B && last4A === last4B) {
    // Check if one is masked version of the other
    const isMaskedA = normA.includes("X");
    const isMaskedB = normB.includes("X");

    // If one is masked and they share last 4, likely same account
    if (isMaskedA !== isMaskedB) return true;

    // If both masked with same pattern, likely same
    if (isMaskedA && isMaskedB) return true;
  }

  return false;
}

/**
 * Detect an existing account or create a new one
 */
export async function detectOrCreateAccount(
  input: AccountInput
): Promise<Account | null> {
  if (!input.accountNumber && !input.accountName) {
    return null;
  }

  // Try to find existing account
  const existingAccount = await findMatchingAccount(input);
  if (existingAccount) {
    // Update with any new information
    await updateAccountIfNeeded(existingAccount, input);
    return existingAccount;
  }

  // Create new account
  const newAccount: Account = {
    id: uuid(),
    displayName: input.accountName || input.accountNumber || "Unknown Account",
    institution: input.institution || null,
    accountNumber: input.accountNumber?.includes("X")
      ? null
      : input.accountNumber || null,
    maskedNumber: input.accountNumber || null,
    accountType: null,
    corpusId: null,
    isExternal: input.isExternal || false,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(accounts).values(newAccount);

  // Check for potential corpus suggestions with other accounts
  await generateCorpusSuggestions(newAccount);

  return newAccount;
}

/**
 * Find an existing account that matches the input
 */
async function findMatchingAccount(input: AccountInput): Promise<Account | null> {
  const allAccounts = await db.select().from(accounts);

  for (const account of allAccounts) {
    // Check account number match
    if (input.accountNumber && account.maskedNumber) {
      if (accountNumbersMatch(input.accountNumber, account.maskedNumber)) {
        return account;
      }
    }
    if (input.accountNumber && account.accountNumber) {
      if (accountNumbersMatch(input.accountNumber, account.accountNumber)) {
        return account;
      }
    }

    // Check account name match (for named accounts like "MAS Irrevocable Trust-6981")
    if (input.accountName && account.displayName) {
      const inputNameNorm = input.accountName.toLowerCase().trim();
      const accountNameNorm = account.displayName.toLowerCase().trim();

      if (inputNameNorm === accountNameNorm) {
        return account;
      }

      // Check if one contains the other (partial name match)
      if (
        inputNameNorm.includes(accountNameNorm) ||
        accountNameNorm.includes(inputNameNorm)
      ) {
        // Also verify last 4 digits if both have account numbers
        if (input.accountNumber && account.maskedNumber) {
          const last4Input = extractLast4(input.accountNumber);
          const last4Account = extractLast4(account.maskedNumber);
          if (last4Input === last4Account) {
            return account;
          }
        } else {
          // No account numbers to compare, trust the name match
          return account;
        }
      }
    }
  }

  return null;
}

/**
 * Update account with additional information if we learned something new
 */
async function updateAccountIfNeeded(
  account: Account,
  input: AccountInput
): Promise<void> {
  const updates: Partial<Account> = {};

  // If we have a full account number and only had masked before
  if (
    input.accountNumber &&
    !input.accountNumber.includes("X") &&
    (!account.accountNumber || account.accountNumber.includes("X"))
  ) {
    updates.accountNumber = input.accountNumber;
  }

  // If we have a better display name
  if (
    input.accountName &&
    (!account.displayName ||
      account.displayName === account.maskedNumber ||
      account.displayName === "Unknown Account")
  ) {
    updates.displayName = input.accountName;
  }

  // If we have institution info we didn't have before
  if (input.institution && !account.institution) {
    updates.institution = input.institution;
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date();
    await db.update(accounts).set(updates).where(eq(accounts.id, account.id));
  }
}

/**
 * Generate corpus suggestions for a new account
 * Looks for other accounts that might be related
 */
async function generateCorpusSuggestions(newAccount: Account): Promise<void> {
  const allAccounts = await db
    .select()
    .from(accounts)
    .where(sql`${accounts.id} != ${newAccount.id}`);

  for (const otherAccount of allAccounts) {
    let reason: string | null = null;
    let confidence = 0;

    // Check for same institution
    if (
      newAccount.institution &&
      otherAccount.institution &&
      newAccount.institution.toLowerCase() ===
        otherAccount.institution.toLowerCase()
    ) {
      reason = `Same institution: ${newAccount.institution}`;
      confidence = 0.3;
    }

    // Check for similar account names (might be same person/entity)
    if (newAccount.displayName && otherAccount.displayName) {
      const name1 = newAccount.displayName.toLowerCase();
      const name2 = otherAccount.displayName.toLowerCase();

      // Look for common name patterns
      // Filter out: short words, masked numbers (XXXX), pure numbers, common filler words
      const filterMeaninglessWords = (words: string[]) =>
        words.filter((w) => {
          // Skip short words
          if (w.length < 3) return false;
          // Skip masked patterns like "xxxx", "xxx", or anything with x's
          if (/^x+$/i.test(w) || /x{2,}/i.test(w)) return false;
          // Skip pure numbers (could be account numbers or random IDs)
          if (/^\d+$/.test(w)) return false;
          // Skip common filler words
          if (["account", "the", "and", "for", "inc", "llc", "ltd"].includes(w)) return false;
          return true;
        });

      const words1 = filterMeaninglessWords(name1.split(/[\s-]+/));
      const words2 = filterMeaninglessWords(name2.split(/[\s-]+/));

      const commonWords = words1.filter((w) => words2.includes(w));
      if (commonWords.length > 0) {
        reason = `Similar account names - common words: ${commonWords.join(", ")}`;
        confidence = Math.min(0.5 + commonWords.length * 0.1, 0.8);
      }
    }

    // If we found a reason, create a suggestion
    if (reason && confidence > 0.2) {
      // Check if suggestion already exists
      const existing = await db
        .select()
        .from(corpusSuggestions)
        .where(
          or(
            and(
              eq(corpusSuggestions.accountId1, newAccount.id),
              eq(corpusSuggestions.accountId2, otherAccount.id)
            ),
            and(
              eq(corpusSuggestions.accountId1, otherAccount.id),
              eq(corpusSuggestions.accountId2, newAccount.id)
            )
          )
        );

      if (existing.length === 0) {
        await db.insert(corpusSuggestions).values({
          id: uuid(),
          accountId1: newAccount.id,
          accountId2: otherAccount.id,
          reason,
          confidence: String(confidence),
          status: "pending",
        });
      }
    }
  }
}

/**
 * Normalize extraction data into a transaction record
 */
export function normalizeTransaction(
  extraction: TransactionExtraction,
  accountId: string | null | undefined,
  toAccountId: string | null | undefined
): Omit<NewTransaction, "sourceEmailId"> {
  const id = uuid();

  // Build the data object with type-specific fields
  const data: Record<string, unknown> = {};

  // Add option-specific fields
  if (extraction.optionType) data.optionType = extraction.optionType;
  if (extraction.strikePrice) data.strikePrice = extraction.strikePrice;
  if (extraction.expirationDate) data.expirationDate = extraction.expirationDate;
  if (extraction.optionAction) data.optionAction = extraction.optionAction;

  // Add trade-specific fields
  if (extraction.orderType) data.orderType = extraction.orderType;
  if (extraction.orderStatus) data.orderStatus = extraction.orderStatus;

  // Add RSU-specific fields
  if (extraction.grantNumber) data.grantNumber = extraction.grantNumber;
  if (extraction.vestDate) data.vestDate = extraction.vestDate;

  // Add wire/transfer specific
  if (extraction.referenceNumber) data.referenceNumber = extraction.referenceNumber;

  // Add security name
  if (extraction.securityName) data.securityName = extraction.securityName;

  // Add any additional fields
  if (extraction.additionalFields) {
    Object.assign(data, extraction.additionalFields);
  }

  // Add extraction notes
  if (extraction.extractionNotes) data.extractionNotes = extraction.extractionNotes;

  return {
    id,
    type: extraction.transactionType!,
    accountId: accountId || null,
    toAccountId: toAccountId || null,
    date: extraction.transactionDate
      ? new Date(extraction.transactionDate)
      : new Date(),
    amount: extraction.amount ? String(extraction.amount) : null,
    currency: extraction.currency || "USD",
    symbol: extraction.symbol || null,
    quantity: extraction.quantity ? String(extraction.quantity) : null,
    price: extraction.price ? String(extraction.price) : null,
    fees: extraction.fees ? String(extraction.fees) : null,
    data,
    confidence: extraction.confidence ? String(extraction.confidence) : null,
  };
}

/**
 * Get all unique field names discovered during extraction
 */
export async function getDiscoveredFieldNames(): Promise<string[]> {
  const allTransactions = await db
    .select({ data: transactions.data })
    .from(transactions);

  const fieldNames = new Set<string>();

  for (const tx of allTransactions) {
    if (tx.data && typeof tx.data === "object") {
      for (const key of Object.keys(tx.data)) {
        fieldNames.add(key);
      }
    }
  }

  return Array.from(fieldNames).sort();
}
