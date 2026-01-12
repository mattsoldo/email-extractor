import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Create and export the Inngest handler
// This endpoint is called by Inngest to execute functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
