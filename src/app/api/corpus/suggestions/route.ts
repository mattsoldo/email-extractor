import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { corpusSuggestions, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// GET /api/corpus/suggestions - List pending corpus suggestions
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status") || "pending";

  const suggestions = await db
    .select({
      suggestion: corpusSuggestions,
    })
    .from(corpusSuggestions)
    .where(eq(corpusSuggestions.status, status));

  // Enhance with account details
  const result = await Promise.all(
    suggestions.map(async (s) => {
      const account1 = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, s.suggestion.accountId1))
        .limit(1);

      const account2 = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, s.suggestion.accountId2))
        .limit(1);

      return {
        ...s.suggestion,
        account1: account1[0] || null,
        account2: account2[0] || null,
      };
    })
  );

  return NextResponse.json({ suggestions: result });
}

// POST /api/corpus/suggestions - Accept or reject a suggestion
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { suggestionId, action, corpusId, corpusName } = body;

  if (!suggestionId || !action) {
    return NextResponse.json(
      { error: "suggestionId and action are required" },
      { status: 400 }
    );
  }

  const suggestion = await db
    .select()
    .from(corpusSuggestions)
    .where(eq(corpusSuggestions.id, suggestionId))
    .limit(1);

  if (suggestion.length === 0) {
    return NextResponse.json(
      { error: "Suggestion not found" },
      { status: 404 }
    );
  }

  const { accountId1, accountId2 } = suggestion[0];

  if (action === "accept") {
    // Get or create corpus
    let targetCorpusId = corpusId;

    if (!targetCorpusId && corpusName) {
      // Create new corpus
      const newCorpus = {
        id: crypto.randomUUID(),
        name: corpusName,
        description: `Created from suggestion: ${suggestion[0].reason}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const { accountCorpus } = await import("@/db/schema");
      await db.insert(accountCorpus).values(newCorpus);
      targetCorpusId = newCorpus.id;
    }

    if (!targetCorpusId) {
      // Check if either account already has a corpus
      const account1 = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId1))
        .limit(1);
      const account2 = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, accountId2))
        .limit(1);

      targetCorpusId =
        account1[0]?.corpusId || account2[0]?.corpusId || crypto.randomUUID();

      // Create corpus if needed
      if (!account1[0]?.corpusId && !account2[0]?.corpusId) {
        const { accountCorpus } = await import("@/db/schema");
        await db.insert(accountCorpus).values({
          id: targetCorpusId,
          name: `Linked Accounts`,
          description: suggestion[0].reason,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    }

    // Update both accounts to use the same corpus
    await db
      .update(accounts)
      .set({ corpusId: targetCorpusId, updatedAt: new Date() })
      .where(eq(accounts.id, accountId1));
    await db
      .update(accounts)
      .set({ corpusId: targetCorpusId, updatedAt: new Date() })
      .where(eq(accounts.id, accountId2));

    // Mark suggestion as accepted
    await db
      .update(corpusSuggestions)
      .set({ status: "accepted", reviewedAt: new Date() })
      .where(eq(corpusSuggestions.id, suggestionId));

    return NextResponse.json({
      message: "Suggestion accepted",
      corpusId: targetCorpusId,
    });
  } else if (action === "reject") {
    // Mark suggestion as rejected
    await db
      .update(corpusSuggestions)
      .set({ status: "rejected", reviewedAt: new Date() })
      .where(eq(corpusSuggestions.id, suggestionId));

    return NextResponse.json({ message: "Suggestion rejected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
