import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

interface ErrorDetail {
  filename: string;
  status: "uploaded" | "skipped" | "failed";
  reason?: string;
}

// POST /api/uploads/summarize-errors - Generate AI summary of upload errors
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { errors, uploaded, skipped, failed } = body as {
      errors: ErrorDetail[];
      uploaded: number;
      skipped: number;
      failed: number;
    };

    // Only summarize if there are errors or skips worth explaining
    if (failed === 0 && skipped === 0) {
      return NextResponse.json({
        summary: `All ${uploaded} files uploaded successfully!`,
      });
    }

    // Group errors by reason
    const errorsByReason: Record<string, string[]> = {};
    for (const error of errors) {
      if (error.status !== "uploaded" && error.reason) {
        const reason = error.reason;
        if (!errorsByReason[reason]) {
          errorsByReason[reason] = [];
        }
        errorsByReason[reason].push(error.filename);
      }
    }

    // Build context for Claude
    const errorSummary = Object.entries(errorsByReason)
      .map(([reason, files]) => `- ${reason}: ${files.length} files (e.g., ${files.slice(0, 3).join(", ")}${files.length > 3 ? "..." : ""})`)
      .join("\n");

    const prompt = `You are helping a user understand why some email files failed to upload or were skipped during import.

Upload Results:
- Successfully uploaded: ${uploaded} files
- Skipped: ${skipped} files
- Failed: ${failed} files

Errors grouped by reason:
${errorSummary || "(no specific errors recorded)"}

Please provide a brief, helpful summary (2-3 sentences) explaining:
1. What happened overall
2. Why files might have been skipped or failed
3. What the user can do about it (if anything)

Be concise and friendly. Don't repeat the exact numbers - focus on actionable insights.`;

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt,
    });

    return NextResponse.json({ summary: text });
  } catch (error) {
    console.error("Error summarizing upload:", error);
    // Provide a basic fallback summary
    return NextResponse.json({
      summary: "Some files couldn't be uploaded. Check the details above for specific issues.",
    });
  }
}
