import { NextRequest, NextResponse } from "next/server";
import { checkExistingExtraction } from "@/services/job-manager";
import { SOFTWARE_VERSION } from "@/config/version";
import { db } from "@/db";
import { emails } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/extraction-check - Check if extraction can be run for a set+model+prompt combo
 *
 * This checks if:
 * 1. The set+model+prompt+software version combination has already been extracted
 * 2. The set has emails that can be processed
 *
 * Returns eligibility status and reason if not eligible
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setId = searchParams.get("setId");
  const modelId = searchParams.get("modelId");
  const promptId = searchParams.get("promptId");

  if (!setId) {
    return NextResponse.json(
      { error: "setId parameter is required" },
      { status: 400 }
    );
  }

  if (!modelId) {
    return NextResponse.json(
      { error: "modelId parameter is required" },
      { status: 400 }
    );
  }

  if (!promptId) {
    return NextResponse.json(
      { error: "promptId parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Check if extraction already exists for this set+model+prompt+version
    const { exists, run } = await checkExistingExtraction(setId, modelId, promptId);

    if (exists && run) {
      return NextResponse.json({
        eligible: false,
        reason: "already_extracted",
        message: `This set has already been extracted with this model and prompt using software version ${SOFTWARE_VERSION}`,
        existingRun: {
          id: run.id,
          completedAt: run.completedAt,
          transactionsCreated: run.transactionsCreated,
        },
        softwareVersion: SOFTWARE_VERSION,
      });
    }

    // Check how many emails are in this set
    const emailCount = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.setId, setId));

    if (emailCount.length === 0) {
      return NextResponse.json({
        eligible: false,
        reason: "no_emails",
        message: "This set has no emails to process",
        softwareVersion: SOFTWARE_VERSION,
      });
    }

    return NextResponse.json({
      eligible: true,
      emailCount: emailCount.length,
      softwareVersion: SOFTWARE_VERSION,
      message: `Ready to extract ${emailCount.length} emails with ${modelId}`,
    });
  } catch (error) {
    console.error("Extraction check error:", error);
    return NextResponse.json(
      { error: "Failed to check extraction eligibility" },
      { status: 500 }
    );
  }
}
