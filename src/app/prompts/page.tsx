"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Plus,
  Edit,
  Trash2,
  Star,
  FileText,
  Loader2,
  Check,
  Code,
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

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch("/api/prompts");
      const data = await res.json();
      setPrompts(data.prompts || []);
    } catch (error) {
      console.error("Failed to fetch prompts:", error);
      toast.error("Failed to load prompts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const handleDelete = async (prompt: Prompt) => {
    if (prompt.isDefault) {
      toast.error("Cannot delete the default prompt");
      return;
    }

    if (!confirm(`Are you sure you want to delete "${prompt.name}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/prompts/${prompt.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Prompt deleted");
        fetchPrompts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete prompt");
      }
    } catch (error) {
      toast.error("Failed to delete prompt");
    }
  };

  const handleSetDefault = async (prompt: Prompt) => {
    try {
      const res = await fetch(`/api/prompts/${prompt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: prompt.name,
          description: prompt.description,
          content: prompt.content,
          jsonSchema: prompt.jsonSchema,
          isDefault: true,
          isActive: true,
        }),
      });

      if (res.ok) {
        toast.success("Default prompt updated");
        fetchPrompts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to set default");
      }
    } catch (error) {
      toast.error("Failed to set default");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <FileText className="h-8 w-8" />
              Extraction Prompts
            </h1>
            <p className="text-gray-600 mt-1">
              Manage prompts used for extracting financial data from emails
            </p>
          </div>
          <Link href="/prompts/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Prompt
            </Button>
          </Link>
        </div>

        {/* Prompts Grid */}
        {prompts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No prompts yet</h3>
              <p className="text-gray-500 mb-4">
                Create your first prompt to customize extraction behavior
              </p>
              <Link href="/prompts/new">
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  Create Prompt
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {prompts.map((prompt) => (
              <Card
                key={prompt.id}
                className={prompt.isDefault ? "border-blue-300 bg-blue-50/30" : ""}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{prompt.name}</CardTitle>
                        {prompt.isDefault && (
                          <Badge className="bg-blue-600 gap-1">
                            <Star className="h-3 w-3" />
                            Default
                          </Badge>
                        )}
                      </div>
                      {prompt.description && (
                        <CardDescription className="mt-1">
                          {prompt.description}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4">
                    <div className="text-xs text-gray-500 mb-2">Prompt Content:</div>
                    <div className="bg-gray-100 rounded p-3 text-sm font-mono max-h-32 overflow-auto">
                      {prompt.content.substring(0, 200)}
                      {prompt.content.length > 200 && "..."}
                    </div>
                  </div>

                  {/* JSON Schema indicator */}
                  <div className="mb-4 flex items-center gap-2">
                    <Code className="h-4 w-4 text-gray-500" />
                    <span className="text-xs text-gray-500">
                      JSON Schema:{" "}
                      {prompt.jsonSchema ? (
                        <Badge variant="outline" className="text-xs text-green-600 border-green-300">
                          Custom
                        </Badge>
                      ) : (
                        <span className="text-gray-400">Default</span>
                      )}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link href={`/prompts/${prompt.id}`}>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                      >
                        <Edit className="h-3 w-3" />
                        Edit
                      </Button>
                    </Link>
                    {!prompt.isDefault && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSetDefault(prompt)}
                          className="gap-1"
                        >
                          <Check className="h-3 w-3" />
                          Set as Default
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(prompt)}
                          className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="mt-3 pt-3 border-t text-xs text-gray-500">
                    Last updated: {new Date(prompt.updatedAt).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
