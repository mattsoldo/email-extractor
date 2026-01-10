import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { prompts, type NewPrompt } from "@/db/schema";
import { eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// GET /api/prompts - List all prompts
export async function GET() {
  try {
    const allPrompts = await db
      .select()
      .from(prompts)
      .where(eq(prompts.isActive, true))
      .orderBy(prompts.isDefault, prompts.createdAt);

    // Find the default prompt
    const defaultPrompt = allPrompts.find(p => p.isDefault);

    return NextResponse.json({
      prompts: allPrompts,
      defaultPromptId: defaultPrompt?.id || null,
    });
  } catch (error) {
    console.error("Failed to fetch prompts:", error);
    return NextResponse.json(
      { error: "Failed to fetch prompts" },
      { status: 500 }
    );
  }
}

// POST /api/prompts - Create a new prompt
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, content, isDefault, jsonSchema } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: "Name and content are required" },
        { status: 400 }
      );
    }

    const newPrompt: NewPrompt = {
      id: uuid(),
      name,
      description: description || null,
      content,
      jsonSchema: jsonSchema || null,
      isDefault: isDefault || false,
      isActive: true,
    };

    // If this is set as default, unset other defaults
    if (isDefault) {
      await db
        .update(prompts)
        .set({ isDefault: false })
        .where(eq(prompts.isDefault, true));
    }

    await db.insert(prompts).values(newPrompt);

    return NextResponse.json({
      message: "Prompt created successfully",
      prompt: newPrompt,
    });
  } catch (error) {
    console.error("Failed to create prompt:", error);
    return NextResponse.json(
      { error: "Failed to create prompt" },
      { status: 500 }
    );
  }
}
