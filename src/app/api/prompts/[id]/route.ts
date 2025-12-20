import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { prompts } from "@/db/schema";
import { eq } from "drizzle-orm";

// GET /api/prompts/[id] - Get a specific prompt
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [prompt] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, id))
      .limit(1);

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ prompt });
  } catch (error) {
    console.error("Failed to fetch prompt:", error);
    return NextResponse.json(
      { error: "Failed to fetch prompt" },
      { status: 500 }
    );
  }
}

// PUT /api/prompts/[id] - Update a prompt
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, content, isDefault, isActive } = body;

    if (!name || !content) {
      return NextResponse.json(
        { error: "Name and content are required" },
        { status: 400 }
      );
    }

    // Check if prompt exists
    const [existing] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    // If setting as default, unset other defaults
    if (isDefault && !existing.isDefault) {
      await db
        .update(prompts)
        .set({ isDefault: false })
        .where(eq(prompts.isDefault, true));
    }

    // Update the prompt
    await db
      .update(prompts)
      .set({
        name,
        description: description || null,
        content,
        isDefault: isDefault !== undefined ? isDefault : existing.isDefault,
        isActive: isActive !== undefined ? isActive : existing.isActive,
        updatedAt: new Date(),
      })
      .where(eq(prompts.id, id));

    // Fetch updated prompt
    const [updated] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, id))
      .limit(1);

    return NextResponse.json({
      message: "Prompt updated successfully",
      prompt: updated,
    });
  } catch (error) {
    console.error("Failed to update prompt:", error);
    return NextResponse.json(
      { error: "Failed to update prompt" },
      { status: 500 }
    );
  }
}

// DELETE /api/prompts/[id] - Delete a prompt (soft delete by setting isActive = false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check if prompt exists
    const [existing] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Prompt not found" },
        { status: 404 }
      );
    }

    // Don't allow deleting the default prompt
    if (existing.isDefault) {
      return NextResponse.json(
        { error: "Cannot delete the default prompt. Set another prompt as default first." },
        { status: 400 }
      );
    }

    // Soft delete by setting isActive = false
    await db
      .update(prompts)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(prompts.id, id));

    return NextResponse.json({
      message: "Prompt deleted successfully",
    });
  } catch (error) {
    console.error("Failed to delete prompt:", error);
    return NextResponse.json(
      { error: "Failed to delete prompt" },
      { status: 500 }
    );
  }
}
