import { NextRequest } from "next/server";
import { runExtractionJobStreaming, type ExtractionProgressEvent } from "@/services/job-manager";

// Configure for long-running streaming
export const maxDuration = 300; // 5 minutes max (Vercel Pro limit)
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/stream - Start an extraction job with streaming progress
 *
 * This endpoint keeps the connection open and streams progress updates
 * using Server-Sent Events (SSE). The extraction runs synchronously
 * within this request, avoiding the serverless timeout issue.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, options } = body;

  if (type !== "extraction") {
    return new Response(JSON.stringify({ error: `Streaming only supports extraction jobs` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!options?.setId) {
    return new Response(JSON.stringify({ error: "setId is required for extraction" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!options?.promptId) {
    return new Response(JSON.stringify({ error: "promptId is required for extraction" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create a readable stream for SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Run the extraction and stream progress events
        for await (const event of runExtractionJobStreaming({
          setId: options.setId,
          modelId: options.modelId,
          promptId: options.promptId,
          customPromptContent: options.customPromptContent,
          concurrency: options.concurrency || 3,
          sampleSize: options.sampleSize,
        })) {
          // Format as SSE
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        // Send completion event
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      } catch (error) {
        // Send error event
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    },
  });
}
