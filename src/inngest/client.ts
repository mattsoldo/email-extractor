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

export interface ExtractionResumeEvent {
  name: "extraction/resume";
  data: {
    runId: string;
  };
}

// Union of all events
export type InngestEvents = {
  "extraction/started": ExtractionStartedEvent;
  "extraction/resume": ExtractionResumeEvent;
};
