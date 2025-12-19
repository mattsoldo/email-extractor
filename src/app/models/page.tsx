"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RefreshCw,
  Search,
  Check,
  X,
  Star,
  Sparkles,
  AlertCircle,
  CheckCircle,
  Plus,
  Loader2,
  ExternalLink,
  DollarSign,
} from "lucide-react";

interface ModelConfig {
  id: string;
  provider: "anthropic" | "openai" | "google";
  name: string;
  description: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  contextWindow: number;
  recommended?: boolean;
  isActive?: boolean;
  available?: boolean;
}

interface DiscoveredModel {
  id: string;
  provider: "anthropic" | "openai" | "google";
  name: string;
  description: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  contextWindow: number;
  source: string;
}

interface ProviderStatus {
  provider: string;
  configured: boolean;
  modelCount: number;
}

export default function ModelsPage() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Discovery state
  const [showDiscoveryDialog, setShowDiscoveryDialog] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Set<string>>(new Set());
  const [addingModels, setAddingModels] = useState(false);

  // Add model dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newModel, setNewModel] = useState<Partial<ModelConfig>>({
    provider: "anthropic",
    isActive: true,
  });

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models/config");
      const data = await res.json();
      setModels(data.models || []);
      setProviderStatus(data.providers || []);
    } catch (error) {
      console.error("Failed to fetch models:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const toggleModelActive = async (modelId: string, isActive: boolean) => {
    // Optimistic update
    setModels(prev =>
      prev.map(m => (m.id === modelId ? { ...m, isActive } : m))
    );

    try {
      await fetch("/api/models/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId, isActive }),
      });
    } catch (error) {
      console.error("Failed to update model:", error);
      // Revert on error
      fetchModels();
    }
  };

  const discoverNewModels = async () => {
    setDiscovering(true);
    setDiscoveryError(null);
    setDiscoveredModels([]);

    try {
      const res = await fetch("/api/models/discover", { method: "POST" });
      const data = await res.json();

      if (data.error) {
        setDiscoveryError(data.error);
      } else {
        setDiscoveredModels(data.models || []);
      }
    } catch (error) {
      console.error("Discovery failed:", error);
      setDiscoveryError("Failed to discover models. Please try again.");
    } finally {
      setDiscovering(false);
    }
  };

  const addDiscoveredModels = async () => {
    if (selectedDiscovered.size === 0) return;

    setAddingModels(true);
    try {
      const modelsToAdd = discoveredModels.filter(m => selectedDiscovered.has(m.id));

      const res = await fetch("/api/models/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: modelsToAdd }),
      });

      if (res.ok) {
        setShowDiscoveryDialog(false);
        setSelectedDiscovered(new Set());
        fetchModels();
      }
    } catch (error) {
      console.error("Failed to add models:", error);
    } finally {
      setAddingModels(false);
    }
  };

  const addManualModel = async () => {
    if (!newModel.id || !newModel.name || !newModel.provider) return;

    setSaving(true);
    try {
      const res = await fetch("/api/models/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: [{
            ...newModel,
            inputCostPerMillion: newModel.inputCostPerMillion || 0,
            outputCostPerMillion: newModel.outputCostPerMillion || 0,
            contextWindow: newModel.contextWindow || 128000,
            description: newModel.description || "",
          }],
        }),
      });

      if (res.ok) {
        setShowAddDialog(false);
        setNewModel({ provider: "anthropic", isActive: true });
        fetchModels();
      }
    } catch (error) {
      console.error("Failed to add model:", error);
    } finally {
      setSaving(false);
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case "anthropic":
        return "bg-orange-100 text-orange-800";
      case "openai":
        return "bg-green-100 text-green-800";
      case "google":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getProviderLabel = (provider: string) => {
    switch (provider) {
      case "anthropic":
        return "Anthropic";
      case "openai":
        return "OpenAI";
      case "google":
        return "Google";
      default:
        return provider;
    }
  };

  const formatCost = (cost: number) => {
    if (cost < 1) {
      return `$${cost.toFixed(2)}`;
    }
    return `$${cost.toFixed(2)}`;
  };

  const formatContextWindow = (size: number) => {
    if (size >= 1000000) {
      return `${(size / 1000000).toFixed(1)}M`;
    }
    return `${(size / 1000).toFixed(0)}K`;
  };

  const groupedModels = models.reduce<Record<string, ModelConfig[]>>((acc, model) => {
    const provider = model.provider;
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">AI Models</h1>
            <p className="text-gray-600 mt-1">
              Configure which AI models to use for extraction
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowAddDialog(true)} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Add Model
            </Button>
            <Button onClick={() => { setShowDiscoveryDialog(true); discoverNewModels(); }} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Discover New Models
            </Button>
          </div>
        </div>

        {/* Provider Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {providerStatus.map((provider) => (
            <Card key={provider.provider}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge className={getProviderColor(provider.provider)}>
                      {getProviderLabel(provider.provider)}
                    </Badge>
                    <span className="text-sm text-gray-600">
                      {provider.modelCount} models
                    </span>
                  </div>
                  {provider.configured ? (
                    <div className="flex items-center gap-1 text-green-600">
                      <CheckCircle className="h-4 w-4" />
                      <span className="text-sm">Configured</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-yellow-600">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">No API Key</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Models by Provider */}
        {loading ? (
          <Card>
            <CardContent className="py-20">
              <div className="flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              </div>
            </CardContent>
          </Card>
        ) : (
          Object.entries(groupedModels).map(([provider, providerModels]) => (
            <Card key={provider} className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Badge className={getProviderColor(provider)}>
                    {getProviderLabel(provider)}
                  </Badge>
                  <span className="text-lg">{providerModels.length} Models</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]">Active</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Input Cost</TableHead>
                      <TableHead>Output Cost</TableHead>
                      <TableHead>Context</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {providerModels.map((model) => (
                      <TableRow key={model.id} className={!model.available ? "opacity-60" : ""}>
                        <TableCell>
                          <Switch
                            checked={model.isActive !== false}
                            onCheckedChange={(checked) => toggleModelActive(model.id, checked)}
                            disabled={!model.available}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{model.name}</span>
                              {model.recommended && (
                                <Badge variant="secondary" className="gap-1 text-xs">
                                  <Star className="h-3 w-3" /> Recommended
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-gray-500 font-mono">{model.id}</span>
                            {model.description && (
                              <span className="text-sm text-gray-600 mt-1">{model.description}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">
                            {formatCost(model.inputCostPerMillion)}/M
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">
                            {formatCost(model.outputCostPerMillion)}/M
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm">
                            {formatContextWindow(model.contextWindow)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {model.available ? (
                            <Badge variant="outline" className="text-green-600">
                              <Check className="h-3 w-3 mr-1" /> Available
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-gray-500">
                              <X className="h-3 w-3 mr-1" /> No API Key
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))
        )}

        {/* Model Discovery Dialog */}
        <Dialog open={showDiscoveryDialog} onOpenChange={setShowDiscoveryDialog}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Discover New AI Models
              </DialogTitle>
              <DialogDescription>
                Search for the latest AI models from major providers
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {discovering && (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center space-y-3">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
                    <p className="text-gray-600">Searching for new models...</p>
                    <p className="text-sm text-gray-500">This may take a moment</p>
                  </div>
                </div>
              )}

              {discoveryError && (
                <div className="p-4 bg-red-50 rounded-lg text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  <span>{discoveryError}</span>
                </div>
              )}

              {!discovering && discoveredModels.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      Found {discoveredModels.length} models not in your configuration
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (selectedDiscovered.size === discoveredModels.length) {
                          setSelectedDiscovered(new Set());
                        } else {
                          setSelectedDiscovered(new Set(discoveredModels.map(m => m.id)));
                        }
                      }}
                    >
                      {selectedDiscovered.size === discoveredModels.length ? "Deselect All" : "Select All"}
                    </Button>
                  </div>

                  <ScrollArea className="h-[400px] border rounded-lg">
                    <div className="p-2 space-y-2">
                      {discoveredModels.map((model) => (
                        <div
                          key={model.id}
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            selectedDiscovered.has(model.id)
                              ? "border-blue-500 bg-blue-50"
                              : "border-gray-200 hover:bg-gray-50"
                          }`}
                          onClick={() => {
                            const newSelected = new Set(selectedDiscovered);
                            if (newSelected.has(model.id)) {
                              newSelected.delete(model.id);
                            } else {
                              newSelected.add(model.id);
                            }
                            setSelectedDiscovered(newSelected);
                          }}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Badge className={getProviderColor(model.provider)}>
                                  {getProviderLabel(model.provider)}
                                </Badge>
                                <span className="font-medium">{model.name}</span>
                              </div>
                              <p className="text-xs text-gray-500 font-mono mt-1">{model.id}</p>
                              <p className="text-sm text-gray-600 mt-2">{model.description}</p>
                              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                                <span>Input: {formatCost(model.inputCostPerMillion)}/M</span>
                                <span>Output: {formatCost(model.outputCostPerMillion)}/M</span>
                                <span>Context: {formatContextWindow(model.contextWindow)}</span>
                              </div>
                            </div>
                            <div className="ml-3">
                              {selectedDiscovered.has(model.id) ? (
                                <CheckCircle className="h-5 w-5 text-blue-600" />
                              ) : (
                                <div className="h-5 w-5 border-2 border-gray-300 rounded-full" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}

              {!discovering && discoveredModels.length === 0 && !discoveryError && (
                <div className="text-center py-12 text-gray-500">
                  <Search className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>No new models found</p>
                  <p className="text-sm">Your model list is up to date!</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowDiscoveryDialog(false)}>
                  Cancel
                </Button>
                {discoveredModels.length > 0 && (
                  <Button
                    onClick={addDiscoveredModels}
                    disabled={selectedDiscovered.size === 0 || addingModels}
                  >
                    {addingModels ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Add {selectedDiscovered.size} Model{selectedDiscovered.size !== 1 ? "s" : ""}
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Model Dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Custom Model</DialogTitle>
              <DialogDescription>
                Manually add a model not in the discovery list
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <select
                  className="w-full border rounded-md p-2"
                  value={newModel.provider}
                  onChange={(e) => setNewModel({ ...newModel, provider: e.target.value as ModelConfig["provider"] })}
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="google">Google (Gemini)</option>
                </select>
              </div>

              <div className="space-y-2">
                <Label>Model ID</Label>
                <Input
                  placeholder="e.g., claude-3-opus-20240229"
                  value={newModel.id || ""}
                  onChange={(e) => setNewModel({ ...newModel, id: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Display Name</Label>
                <Input
                  placeholder="e.g., Claude 3 Opus"
                  value={newModel.name || ""}
                  onChange={(e) => setNewModel({ ...newModel, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  placeholder="Brief description of the model"
                  value={newModel.description || ""}
                  onChange={(e) => setNewModel({ ...newModel, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Input Cost ($/M tokens)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="3.00"
                    value={newModel.inputCostPerMillion || ""}
                    onChange={(e) => setNewModel({ ...newModel, inputCostPerMillion: parseFloat(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Output Cost ($/M tokens)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="15.00"
                    value={newModel.outputCostPerMillion || ""}
                    onChange={(e) => setNewModel({ ...newModel, outputCostPerMillion: parseFloat(e.target.value) })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Context Window (tokens)</Label>
                <Input
                  type="number"
                  placeholder="128000"
                  value={newModel.contextWindow || ""}
                  onChange={(e) => setNewModel({ ...newModel, contextWindow: parseInt(e.target.value) })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={addManualModel}
                  disabled={!newModel.id || !newModel.name || saving}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add Model"
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
