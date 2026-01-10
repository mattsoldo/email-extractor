"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  FileText,
  Code,
  Loader2,
  Wand2,
  Trash2,
  Star,
} from "lucide-react";
import Link from "next/link";

interface Prompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  jsonSchema: Record<string, unknown> | null;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function EditPromptPage() {
  const router = useRouter();
  const params = useParams();
  const promptId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    content: "",
    jsonSchema: "",
    isDefault: false,
  });
  const [jsonSchemaError, setJsonSchemaError] = useState<string | null>(null);

  const fetchPrompt = useCallback(async () => {
    try {
      const res = await fetch(`/api/prompts/${promptId}`);
      if (!res.ok) {
        toast.error("Prompt not found");
        router.push("/prompts");
        return;
      }
      const data = await res.json();
      setPrompt(data.prompt);
      setFormData({
        name: data.prompt.name,
        description: data.prompt.description || "",
        content: data.prompt.content,
        jsonSchema: data.prompt.jsonSchema
          ? JSON.stringify(data.prompt.jsonSchema, null, 2)
          : "",
        isDefault: data.prompt.isDefault,
      });
    } catch (error) {
      console.error("Failed to fetch prompt:", error);
      toast.error("Failed to load prompt");
      router.push("/prompts");
    } finally {
      setLoading(false);
    }
  }, [promptId, router]);

  useEffect(() => {
    fetchPrompt();
  }, [fetchPrompt]);

  // Format JSON with proper indentation
  const formatJson = () => {
    if (!formData.jsonSchema.trim()) return;

    try {
      const parsed = JSON.parse(formData.jsonSchema);
      const formatted = JSON.stringify(parsed, null, 2);
      setFormData({ ...formData, jsonSchema: formatted });
      setJsonSchemaError(null);
      toast.success("JSON formatted successfully");
    } catch {
      setJsonSchemaError("Invalid JSON format");
      toast.error("Cannot format invalid JSON");
    }
  };

  // Validate JSON as user types
  const handleJsonSchemaChange = (value: string) => {
    setFormData({ ...formData, jsonSchema: value });
    if (value.trim()) {
      try {
        JSON.parse(value);
        setJsonSchemaError(null);
      } catch {
        setJsonSchemaError("Invalid JSON format");
      }
    } else {
      setJsonSchemaError(null);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      toast.error("Name and content are required");
      return;
    }

    // Validate and format JSON schema if provided
    let parsedJsonSchema: Record<string, unknown> | null = null;
    if (formData.jsonSchema.trim()) {
      try {
        parsedJsonSchema = JSON.parse(formData.jsonSchema);
        // Auto-format the JSON on save
        const formatted = JSON.stringify(parsedJsonSchema, null, 2);
        setFormData({ ...formData, jsonSchema: formatted });
        setJsonSchemaError(null);
      } catch {
        setJsonSchemaError("Invalid JSON format");
        toast.error("Please fix the JSON Schema before saving");
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        content: formData.content,
        jsonSchema: parsedJsonSchema,
        isDefault: formData.isDefault,
        isActive: true,
      };

      const res = await fetch(`/api/prompts/${promptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success("Prompt updated successfully");
        // Refresh the prompt data
        fetchPrompt();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update prompt");
      }
    } catch (error) {
      toast.error("Failed to update prompt");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (prompt?.isDefault) {
      toast.error("Cannot delete the default prompt");
      return;
    }

    if (!confirm(`Are you sure you want to delete "${prompt?.name}"?`)) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/prompts/${promptId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Prompt deleted");
        router.push("/prompts");
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete prompt");
      }
    } catch (error) {
      toast.error("Failed to delete prompt");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </main>
      </div>
    );
  }

  if (!prompt) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/prompts"
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Prompts
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Edit Prompt</h1>
            {prompt.isDefault && (
              <Badge className="bg-blue-600 gap-1">
                <Star className="h-3 w-3" />
                Default
              </Badge>
            )}
          </div>
          <p className="text-gray-600 mt-1">
            Last updated: {new Date(prompt.updatedAt).toLocaleString()}
          </p>
        </div>

        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Prompt Details</CardTitle>
            <CardDescription>
              Configure the prompt name, content, and optional JSON schema for extraction
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Name */}
            <div>
              <Label htmlFor="name">Name *</Label>
              <input
                id="name"
                type="text"
                className="mt-2 w-full px-3 py-2 border rounded-md text-sm"
                placeholder="e.g., Custom Financial Extraction"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="description">Description</Label>
              <input
                id="description"
                type="text"
                className="mt-2 w-full px-3 py-2 border rounded-md text-sm"
                placeholder="What this prompt is used for"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* Tabs for Content and Schema */}
            <Tabs defaultValue="prompt" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="prompt" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Prompt Content
                </TabsTrigger>
                <TabsTrigger value="schema" className="gap-2">
                  <Code className="h-4 w-4" />
                  JSON Schema
                  {formData.jsonSchema && !jsonSchemaError && (
                    <Badge variant="outline" className="ml-1 text-xs text-green-600 border-green-300">
                      Custom
                    </Badge>
                  )}
                  {jsonSchemaError && (
                    <Badge variant="outline" className="ml-1 text-xs text-red-600 border-red-300">
                      Error
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="prompt" className="mt-4">
                <div>
                  <Label htmlFor="content">Prompt Content *</Label>
                  <textarea
                    id="content"
                    className="mt-2 w-full h-96 px-3 py-2 border rounded-md text-sm font-mono resize-none"
                    placeholder="Enter the prompt instructions that will be sent to the AI model..."
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    This is the instruction text that will be sent to the AI model for extraction.
                    Be specific about what data to extract and in what format.
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="schema" className="mt-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="jsonSchema">
                      Custom JSON Schema
                      <span className="ml-2 text-xs text-gray-500 font-normal">(optional)</span>
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={formatJson}
                      disabled={!formData.jsonSchema.trim()}
                      className="gap-1"
                    >
                      <Wand2 className="h-3 w-3" />
                      Format JSON
                    </Button>
                  </div>
                  <textarea
                    id="jsonSchema"
                    className={`w-full h-96 px-3 py-2 border rounded-md text-sm font-mono resize-none ${
                      jsonSchemaError ? "border-red-500 focus:ring-red-500" : ""
                    }`}
                    placeholder={`{
  "type": "object",
  "properties": {
    "isTransactional": { "type": "boolean" },
    "transactions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "transactionType": { "type": "string" },
          "amount": { "type": "number" },
          "date": { "type": "string" }
        },
        "required": ["transactionType"]
      }
    }
  },
  "required": ["isTransactional"]
}`}
                    value={formData.jsonSchema}
                    onChange={(e) => handleJsonSchemaChange(e.target.value)}
                  />
                  {jsonSchemaError && (
                    <p className="mt-2 text-sm text-red-500">{jsonSchemaError}</p>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    Define a custom JSON Schema for the extraction output. Leave empty to use the
                    default TransactionExtractionSchema. The JSON will be auto-formatted when you save.
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            {/* Set as Default */}
            <div className="flex items-center gap-2 pt-4 border-t">
              <input
                id="isDefault"
                type="checkbox"
                className="rounded border-gray-300"
                checked={formData.isDefault}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              />
              <Label htmlFor="isDefault" className="cursor-pointer">
                Set as default prompt
              </Label>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t">
              <div>
                {!prompt.isDefault && (
                  <Button
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    {deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete Prompt
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => router.push("/prompts")}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
