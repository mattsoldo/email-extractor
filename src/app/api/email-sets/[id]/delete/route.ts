import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, emailSets, transactions, emailExtractions, extractionLogs, discussionSummaries } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

// DELETE /api/email-sets/[id]/delete - Delete an email set and ALL its emails atomically
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: setId } = await params;

    // Get all email IDs in this set
    const setEmails = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.setId, setId));

    const emailIds = setEmails.map((e) => e.id);

    if (emailIds.length > 0) {
      // Delete in order of dependencies:
      // 1. Transactions
      await db
        .delete(transactions)
        .where(inArray(transactions.sourceEmailId, emailIds));

      // 2. Email extractions
      await db
        .delete(emailExtractions)
        .where(inArray(emailExtractions.emailId, emailIds));

      // 3. Discussion summaries
      await db
        .delete(discussionSummaries)
        .where(inArray(discussionSummaries.emailId, emailIds));

      // 4. Extraction logs
      await db
        .delete(extractionLogs)
        .where(inArray(extractionLogs.emailId, emailIds));

      // 5. Emails
      await db.delete(emails).where(eq(emails.setId, setId));
    }

    // 6. Delete the set itself
    await db.delete(emailSets).where(eq(emailSets.id, setId));

    return NextResponse.json({
      message: `Deleted email set and ${emailIds.length} emails`,
      deletedEmails: emailIds.length,
    });
  } catch (error) {
    console.error("Email set delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete email set" },
      { status: 500 }
    );
  }
}
