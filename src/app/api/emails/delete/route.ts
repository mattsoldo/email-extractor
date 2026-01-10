import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, transactions, emailExtractions, extractionLogs, emailSets } from "@/db/schema";
import { eq, inArray, sql, and, SQL } from "drizzle-orm";

// POST /api/emails/delete - Bulk delete emails and associated data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailIds, deleteAll, filters } = body;

    // Either emailIds or deleteAll must be provided
    if (!deleteAll && (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0)) {
      return NextResponse.json(
        { error: "Must provide an array of emailIds or deleteAll flag" },
        { status: 400 }
      );
    }

    let emailsToDelete: { id: string; setId: string | null }[];

    if (deleteAll) {
      // Build filter conditions
      const conditions: SQL[] = [];

      if (filters?.status) {
        conditions.push(eq(emails.extractionStatus, filters.status));
      }
      if (filters?.setId) {
        conditions.push(eq(emails.setId, filters.setId));
      }

      // Get all emails matching the filters
      emailsToDelete = await db
        .select({ id: emails.id, setId: emails.setId })
        .from(emails)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
    } else {
      // Get specific emails by IDs
      emailsToDelete = await db
        .select({ id: emails.id, setId: emails.setId })
        .from(emails)
        .where(inArray(emails.id, emailIds));
    }

    if (emailsToDelete.length === 0) {
      return NextResponse.json({
        message: "No emails found to delete",
        deletedCount: 0,
      });
    }

    const actualEmailIds = emailsToDelete.map((e) => e.id);

    // Count emails per set for updating counts later
    const setIdCounts = emailsToDelete.reduce((acc, email) => {
      if (email.setId) {
        acc[email.setId] = (acc[email.setId] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    // Delete in order of dependencies

    // 1. Delete transactions associated with these emails
    const deletedTransactions = await db
      .delete(transactions)
      .where(inArray(transactions.sourceEmailId, actualEmailIds))
      .returning({ id: transactions.id });

    // 2. Delete email extractions
    const deletedExtractions = await db
      .delete(emailExtractions)
      .where(inArray(emailExtractions.emailId, actualEmailIds))
      .returning({ id: emailExtractions.id });

    // 3. Delete extraction logs
    const deletedLogs = await db
      .delete(extractionLogs)
      .where(inArray(extractionLogs.emailId, actualEmailIds))
      .returning({ id: extractionLogs.id });

    // 4. Delete the emails
    const deletedEmails = await db
      .delete(emails)
      .where(inArray(emails.id, actualEmailIds))
      .returning({ id: emails.id });

    // 5. Update email set counts
    for (const [setId, count] of Object.entries(setIdCounts)) {
      await db
        .update(emailSets)
        .set({
          emailCount: sql`GREATEST(0, ${emailSets.emailCount} - ${count})`,
          updatedAt: new Date(),
        })
        .where(eq(emailSets.id, setId));
    }

    return NextResponse.json({
      message: `Deleted ${deletedEmails.length} email(s)`,
      deletedCount: deletedEmails.length,
      deletedTransactions: deletedTransactions.length,
      deletedExtractions: deletedExtractions.length,
      deletedLogs: deletedLogs.length,
    });
  } catch (error) {
    console.error("Email delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete emails" },
      { status: 500 }
    );
  }
}
