import { Inngest } from "inngest";

// Create the Inngest client
// This client is used to send events and define functions
export const inngest = new Inngest({
  id: "email-extractor",
  // Event key is only needed for sending events from the browser
  // For server-side, Inngest uses the signing key from env
});

// Event types for type safety
export interface ExtractionStartedEvent {
  name: "extraction/started";
  data: {
    runId: string;
    setId: string;
    modelId: string;
    promptId: string;
    concurrency?: number;
    sampleSize?: number;
    resumeRunId?: string; // For resuming failed runs
  };
}

export interface ExtractionProcessEmailEvent {
  name: "extraction/process-email";
  data: {
    runId: string;
    emailId: string;
    modelId: string;
    promptContent: string;
    jsonSchema: Record<string, unknown> | null;
    totalEmails: number; // Total emails in this run (for finalization check)
  };
}

export interface ExtractionResumeEvent {
  name: "extraction/resume";
  data: {
    runId: string;
  };
}

// Union of all events
export type InngestEvents = {
  "extraction/started": ExtractionStartedEvent;
  "extraction/process-email": ExtractionProcessEmailEvent;
  "extraction/resume": ExtractionResumeEvent;
};
