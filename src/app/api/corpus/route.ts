import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountCorpus, accounts, corpusSuggestions } from "@/db/schema";
import { eq, count } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// GET /api/corpus - List all corpus groups with their accounts
export async function GET() {
  const corpusGroups = await db
    .select({
      corpus: accountCorpus,
      accountCount: count(accounts.id),
    })
    .from(accountCorpus)
    .leftJoin(accounts, eq(accountCorpus.id, accounts.corpusId))
    .groupBy(accountCorpus.id);

  // Get accounts for each corpus
  const result = await Promise.all(
    corpusGroups.map(async (group) => {
      const corpusAccounts = await db
        .select()
        .from(accounts)
        .where(eq(accounts.corpusId, group.corpus.id));

      return {
        ...group.corpus,
        accounts: corpusAccounts,
        accountCount: group.accountCount,
      };
    })
  );

  return NextResponse.json({ corpusGroups: result });
}

// POST /api/corpus - Create a new corpus group
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, description, accountIds } = body;

  const newCorpus = {
    id: uuid(),
    name,
    description: description || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(accountCorpus).values(newCorpus);

  // Assign accounts to this corpus
  if (accountIds && accountIds.length > 0) {
    for (const accountId of accountIds) {
      await db
        .update(accounts)
        .set({ corpusId: newCorpus.id, updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
    }
  }

  return NextResponse.json({ corpus: newCorpus });
}
