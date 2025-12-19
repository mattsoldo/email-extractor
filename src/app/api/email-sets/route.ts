import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emailSets, emails } from "@/db/schema";
import { desc, eq, count } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// GET /api/email-sets - List all email sets
export async function GET() {
  const sets = await db
    .select({
      set: emailSets,
      emailCount: count(emails.id),
    })
    .from(emailSets)
    .leftJoin(emails, eq(emails.setId, emailSets.id))
    .groupBy(emailSets.id)
    .orderBy(desc(emailSets.createdAt));

  return NextResponse.json({
    sets: sets.map((s) => ({
      ...s.set,
      emailCount: s.emailCount,
    })),
  });
}

// POST /api/email-sets - Create a new email set
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description } = body;

  if (!name || name.trim().length === 0) {
    return NextResponse.json(
      { error: "Set name is required" },
      { status: 400 }
    );
  }

  const newSet = {
    id: uuid(),
    name: name.trim(),
    description: description?.trim() || null,
  };

  await db.insert(emailSets).values(newSet);

  return NextResponse.json({ set: newSet });
}
