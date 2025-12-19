import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailSets, emails, transactions } from "@/db/schema";
import { eq, count } from "drizzle-orm";

// GET /api/email-sets/[id] - Get a specific email set with stats
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const [set] = await db
    .select()
    .from(emailSets)
    .where(eq(emailSets.id, id));

  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // Get email count
  const [emailCount] = await db
    .select({ count: count() })
    .from(emails)
    .where(eq(emails.setId, id));

  return NextResponse.json({
    set: {
      ...set,
      emailCount: emailCount.count,
    },
  });
}

// PATCH /api/email-sets/[id] - Update set name/description
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();
  const { name, description } = body;

  const [updated] = await db
    .update(emailSets)
    .set({
      name: name !== undefined ? name : undefined,
      description: description !== undefined ? description : undefined,
      updatedAt: new Date(),
    })
    .where(eq(emailSets.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  return NextResponse.json({ set: updated });
}

// DELETE /api/email-sets/[id] - Delete a set and all its emails
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Check if set exists
  const [set] = await db
    .select()
    .from(emailSets)
    .where(eq(emailSets.id, id));

  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // Get email IDs in this set
  const setEmails = await db
    .select({ id: emails.id })
    .from(emails)
    .where(eq(emails.setId, id));

  const emailIds = setEmails.map((e) => e.id);

  // Delete transactions linked to these emails
  if (emailIds.length > 0) {
    for (const emailId of emailIds) {
      await db
        .delete(transactions)
        .where(eq(transactions.sourceEmailId, emailId));
    }
  }

  // Delete the emails
  await db.delete(emails).where(eq(emails.setId, id));

  // Delete the set
  await db.delete(emailSets).where(eq(emailSets.id, id));

  return NextResponse.json({
    message: `Deleted set "${set.name}" with ${emailIds.length} emails`,
    deletedEmails: emailIds.length,
  });
}
