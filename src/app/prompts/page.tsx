"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Edit,
  Trash2,
  Star,
  FileText,
  Loader2,
  Check,
} from "lucide-react";

interface Prompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [defaultPromptId, setDefaultPromptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    content: "",
    isDefault: false,
  });
  const [saving, setSaving] = useState(false);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await fetch("/api/prompts");
      const data = await res.json();
      setPrompts(data.prompts || []);
      setDefaultPromptId(data.defaultPromptId);
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

  const openCreateDialog = () => {
    setEditingPrompt(null);
    setFormData({
      name: "",
      description: "",
      content: "",
      isDefault: false,
    });
    setShowDialog(true);
  };

  const openEditDialog = (prompt: Prompt) => {
    setEditingPrompt(prompt);
    setFormData({
      name: prompt.name,
      description: prompt.description || "",
      content: prompt.content,
      isDefault: prompt.isDefault,
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      toast.error("Name and content are required");
      return;
    }

    setSaving(true);
    try {
      const url = editingPrompt
        ? `/api/prompts/${editingPrompt.id}`
        : "/api/prompts";
      const method = editingPrompt ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        toast.success(editingPrompt ? "Prompt updated" : "Prompt created");
        setShowDialog(false);
        fetchPrompts();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to save prompt");
      }
    } catch (error) {
      toast.error("Failed to save prompt");
    } finally {
      setSaving(false);
    }
  };

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
          <Button onClick={openCreateDialog} className="gap-2">
            <Plus className="h-4 w-4" />
            New Prompt
          </Button>
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
              <Button onClick={openCreateDialog} className="gap-2">
                <Plus className="h-4 w-4" />
                Create Prompt
              </Button>
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

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(prompt)}
                      className="gap-1"
                    >
                      <Edit className="h-3 w-3" />
                      Edit
                    </Button>
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

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPrompt ? "Edit Prompt" : "Create New Prompt"}
            </DialogTitle>
            <DialogDescription>
              {editingPrompt
                ? "Update the prompt configuration"
                : "Create a new prompt for extraction runs"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="name">Name *</Label>
              <input
                id="name"
                type="text"
                className="mt-2 w-full px-3 py-2 border rounded-md text-sm"
                placeholder="e.g., Default Financial Extraction"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

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

            <div>
              <Label htmlFor="content">Prompt Content *</Label>
              <textarea
                id="content"
                className="mt-2 w-full h-64 px-3 py-2 border rounded-md text-sm font-mono resize-none"
                placeholder="Enter the prompt text..."
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              />
              <p className="mt-1 text-xs text-gray-500">
                This is the prompt that will be sent to the AI model for extraction
              </p>
            </div>

            <div className="flex items-center gap-2">
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>{editingPrompt ? "Update" : "Create"} Prompt</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
