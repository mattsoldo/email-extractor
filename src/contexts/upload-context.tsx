"use client";

import React, { createContext, useContext, useState, useRef, useCallback } from "react";

interface UploadResult {
  uploaded: number;
  skipped: number;
  duplicates: number;
  failed: number;
  details: Array<{
    filename: string;
    status: "uploaded" | "skipped" | "duplicate" | "failed";
    reason?: string;
  }>;
}

interface UploadContextType {
  // State
  uploading: boolean;
  uploadProgress: number;
  uploadTotal: number;
  uploadStage: string;
  uploadMessage: string;
  uploadResult: UploadResult | null;
  cancelling: boolean;
  // Actions
  startUpload: (files: FileList | File[], setName?: string) => Promise<void>;
  cancelUpload: () => Promise<void>;
  clearUploadResult: () => void;
}

const UploadContext = createContext<UploadContextType | null>(null);

export function useUpload() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error("useUpload must be used within an UploadProvider");
  }
  return context;
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadStage, setUploadStage] = useState<string>("");
  const [uploadMessage, setUploadMessage] = useState<string>("");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [currentUploadSetId, setCurrentUploadSetId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startUpload = useCallback(async (files: FileList | File[], setName?: string) => {
    const fileArray = Array.from(files).filter(
      (f) => f.name.endsWith(".eml") || f.name.endsWith(".zip") || f.name.endsWith(".txt")
    );
    if (fileArray.length === 0) {
      return;
    }

    // Check total file size (Vercel Hobby plan has 4.5MB limit, Pro has 10MB)
    const totalSize = fileArray.reduce((sum, file) => sum + file.size, 0);
    const maxSizeHobby = 4.5 * 1024 * 1024; // 4.5MB
    const maxSizePro = 10 * 1024 * 1024; // 10MB

    if (totalSize > maxSizeHobby) {
      const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      const warningMessage = totalSize > maxSizePro
        ? `Upload size (${sizeMB}MB) exceeds Vercel Pro limit (10MB). Please split into smaller batches.`
        : `Upload size (${sizeMB}MB) may exceed Vercel Hobby plan limit (4.5MB). Consider upgrading to Pro or splitting files.`;

      // Show warning but allow attempt
      console.warn(warningMessage);
    }

    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    setUploading(true);
    setUploadProgress(0);
    setUploadTotal(0);
    setUploadStage("extracting");
    setUploadMessage("Preparing upload...");
    setUploadResult(null);
    setCurrentUploadSetId(null);
    setCancelling(false);

    try {
      const formData = new FormData();
      fileArray.forEach((file) => {
        formData.append("files", file);
      });

      if (setName?.trim()) {
        formData.append("setName", setName.trim());
      }

      // Use streaming endpoint for real-time progress
      const response = await fetch("/api/emails/upload-stream", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              setUploadStage(event.stage);
              setUploadMessage(event.message);
              setUploadProgress(event.current);
              setUploadTotal(event.total);

              // Track setId for cancellation cleanup
              if (event.setId) {
                setCurrentUploadSetId(event.setId);
              }

              if (event.details) {
                setUploadResult({
                  uploaded: event.details.uploaded || 0,
                  skipped: event.details.skipped || 0,
                  duplicates: event.details.duplicates || 0,
                  failed: event.details.failed || 0,
                  details: [],
                });
              }

              if (event.stage === "complete") {
                setCurrentUploadSetId(null);
                setUploadResult({
                  uploaded: event.details?.uploaded || 0,
                  skipped: event.details?.skipped || 0,
                  duplicates: event.details?.duplicates || 0,
                  failed: event.details?.failed || 0,
                  details: [],
                });
              }
            } catch (parseError) {
              console.error("Failed to parse SSE event:", parseError);
            }
          }
        }
      }
    } catch (error) {
      // Check if this was a user cancellation
      if (error instanceof Error && error.name === "AbortError") {
        // Cancellation is handled in cancelUpload
        return;
      }
      console.error("Upload failed:", error);
      setUploadStage("error");
      setUploadMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      abortControllerRef.current = null;
    }
  }, []);

  const cancelUpload = useCallback(async () => {
    if (!abortControllerRef.current) return;

    setCancelling(true);
    setUploadMessage("Cancelling upload...");

    // Abort the fetch request
    abortControllerRef.current.abort();

    // If we have a setId, delete the set and all its emails
    if (currentUploadSetId) {
      try {
        setUploadMessage("Cleaning up uploaded emails...");
        await fetch(`/api/email-sets/${currentUploadSetId}/delete`, {
          method: "DELETE",
        });
        setUploadMessage("Upload cancelled and cleaned up");
      } catch (cleanupError) {
        console.error("Failed to cleanup after cancellation:", cleanupError);
        setUploadMessage("Upload cancelled (some cleanup may have failed)");
      }
    } else {
      setUploadMessage("Upload cancelled");
    }

    setUploadStage("error");
    setUploading(false);
    setCancelling(false);
    setCurrentUploadSetId(null);
    abortControllerRef.current = null;
  }, [currentUploadSetId]);

  const clearUploadResult = useCallback(() => {
    setUploadResult(null);
    setUploadMessage("");
    setUploadStage("");
  }, []);

  return (
    <UploadContext.Provider
      value={{
        uploading,
        uploadProgress,
        uploadTotal,
        uploadStage,
        uploadMessage,
        uploadResult,
        cancelling,
        startUpload,
        cancelUpload,
        clearUploadResult,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}
