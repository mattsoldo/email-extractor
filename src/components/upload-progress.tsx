"use client";

import { useUpload } from "@/contexts/upload-context";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  XCircle,
  CheckCircle,
  Upload,
  X,
} from "lucide-react";

export function UploadProgress() {
  const {
    uploading,
    uploadProgress,
    uploadTotal,
    uploadStage,
    uploadMessage,
    uploadResult,
    cancelling,
    cancelUpload,
    clearUploadResult,
  } = useUpload();

  // Don't show anything if there's no active upload or result
  if (!uploading && !cancelling && !uploadResult && !uploadMessage) {
    return null;
  }

  // Show completion result
  if (uploadResult && !uploading && !cancelling) {
    return (
      <Card className="fixed bottom-4 right-4 w-96 shadow-lg border-green-200 bg-green-50 z-50">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Upload Complete</p>
                <p className="text-sm text-green-600">
                  {uploadResult.uploaded} uploaded
                  {uploadResult.skipped > 0 && `, ${uploadResult.skipped} skipped`}
                  {uploadResult.failed > 0 && `, ${uploadResult.failed} failed`}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearUploadResult}
              className="text-green-600 hover:text-green-700 -mt-1 -mr-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show error state
  if (uploadStage === "error" && !uploading && !cancelling) {
    return (
      <Card className="fixed bottom-4 right-4 w-96 shadow-lg border-red-200 bg-red-50 z-50">
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-red-600" />
              <div>
                <p className="font-medium text-red-800">Upload Failed</p>
                <p className="text-sm text-red-600">{uploadMessage}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearUploadResult}
              className="text-red-600 hover:text-red-700 -mt-1 -mr-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show progress
  return (
    <Card className="fixed bottom-4 right-4 w-96 shadow-lg z-50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {cancelling ? (
              <Loader2 className="h-5 w-5 animate-spin text-orange-600" />
            ) : (
              <Upload className="h-5 w-5 text-blue-600" />
            )}
            <span className="font-medium text-gray-800">
              {cancelling ? "Cancelling..." : "Uploading Emails"}
            </span>
          </div>
          {uploading && !cancelling && (
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelUpload}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 -mt-1 -mr-2"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{uploadMessage}</span>
          </div>
          {uploadTotal > 0 && (
            <>
              <Progress value={(uploadProgress / uploadTotal) * 100} className="h-2" />
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {uploadStage === "extracting" && "Reading files"}
                  {uploadStage === "parsing" && "Parsing emails"}
                  {uploadStage === "saving" && "Saving to database"}
                </span>
                <span>{uploadProgress} / {uploadTotal}</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
