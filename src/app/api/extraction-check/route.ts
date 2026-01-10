import { NextRequest, NextResponse } from "next/server";
import { SOFTWARE_VERSION } from "@/config/version";
import { db } from "@/db";
import { emails } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/extraction-check - Check if extraction can be run for a set
 *
 * This checks if the set has emails that can be processed.
 * Multiple extractions with the same model/prompt are now allowed
 * to support sample-based extraction runs.
 *
 * Returns eligibility status and reason if not eligible
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setId = searchParams.get("setId");

  if (!setId) {
    return NextResponse.json(
      { error: "setId parameter is required" },
      { status: 400 }
    );
  }

  try {
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
      message: `Ready to extract ${emailCount.length} emails`,
    });
  } catch (error) {
    console.error("Extraction check error:", error);
    return NextResponse.json(
      { error: "Failed to check extraction eligibility" },
      { status: 500 }
    );
  }
}
