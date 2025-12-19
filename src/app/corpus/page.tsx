"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Plus, Check, X, Link2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Account {
  id: string;
  displayName: string | null;
  institution: string | null;
  maskedNumber: string | null;
}

interface CorpusGroup {
  id: string;
  name: string;
  description: string | null;
  accounts: Account[];
  accountCount: number;
}

interface CorpusSuggestion {
  id: string;
  reason: string;
  confidence: string;
  status: string;
  account1: Account | null;
  account2: Account | null;
}

export default function CorpusPage() {
  const [corpusGroups, setCorpusGroups] = useState<CorpusGroup[]>([]);
  const [suggestions, setSuggestions] = useState<CorpusSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCorpusName, setNewCorpusName] = useState("");
  const [newCorpusDescription, setNewCorpusDescription] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [corpusRes, suggestionsRes] = await Promise.all([
        fetch("/api/corpus"),
        fetch("/api/corpus/suggestions"),
      ]);

      const corpusData = await corpusRes.json();
      const suggestionsData = await suggestionsRes.json();

      setCorpusGroups(corpusData.corpusGroups || []);
      setSuggestions(suggestionsData.suggestions || []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSuggestionAction = async (
    suggestionId: string,
    action: "accept" | "reject",
    corpusName?: string
  ) => {
    try {
      await fetch("/api/corpus/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestionId,
          action,
          corpusName: action === "accept" ? corpusName : undefined,
        }),
      });

      toast.success(
        action === "accept"
          ? "Accounts linked successfully"
          : "Suggestion dismissed"
      );
      fetchData();
    } catch (error) {
      toast.error("Failed to process suggestion");
    }
  };

  const createCorpus = async () => {
    if (!newCorpusName.trim()) return;

    try {
      await fetch("/api/corpus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCorpusName,
          description: newCorpusDescription || null,
        }),
      });

      toast.success("Account group created");
      setCreateDialogOpen(false);
      setNewCorpusName("");
      setNewCorpusDescription("");
      fetchData();
    } catch (error) {
      toast.error("Failed to create account group");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Account Groups</h1>
            <p className="text-gray-600 mt-1">
              Group accounts that represent the same corpus of money
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => setCreateDialogOpen(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New Group
            </Button>
            <Button onClick={fetchData} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Suggestions Section */}
        {suggestions.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
              Suggested Links ({suggestions.length})
            </h2>
            <div className="space-y-4">
              {suggestions.map((suggestion) => (
                <Card key={suggestion.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-4">
                          <div className="p-2 bg-gray-100 rounded-lg">
                            <span className="font-medium">
                              {suggestion.account1?.displayName || "Unknown"}
                            </span>
                            {suggestion.account1?.institution && (
                              <span className="text-xs text-gray-500 block">
                                {suggestion.account1.institution}
                              </span>
                            )}
                          </div>
                          <Link2 className="h-5 w-5 text-gray-400" />
                          <div className="p-2 bg-gray-100 rounded-lg">
                            <span className="font-medium">
                              {suggestion.account2?.displayName || "Unknown"}
                            </span>
                            {suggestion.account2?.institution && (
                              <span className="text-xs text-gray-500 block">
                                {suggestion.account2.institution}
                              </span>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">
                          {suggestion.reason}
                        </p>
                        <Badge variant="outline">
                          {Math.round(parseFloat(suggestion.confidence) * 100)}%
                          confidence
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() =>
                            handleSuggestionAction(suggestion.id, "reject")
                          }
                        >
                          <X className="h-4 w-4 mr-1" />
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            handleSuggestionAction(
                              suggestion.id,
                              "accept",
                              `${suggestion.account1?.displayName} Group`
                            )
                          }
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Link Accounts
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Existing Groups */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Account Groups ({corpusGroups.length})
          </h2>

          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">Loading...</CardContent>
            </Card>
          ) : corpusGroups.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-gray-500">
                <Link2 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No account groups yet.</p>
                <p className="text-sm">
                  Create a group or accept suggestions to link related accounts.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {corpusGroups.map((group) => (
                <Card key={group.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{group.name}</CardTitle>
                    {group.description && (
                      <CardDescription>{group.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {group.accounts.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded"
                        >
                          <span className="font-medium">
                            {account.displayName || "Unknown"}
                          </span>
                          <span className="text-sm text-gray-500">
                            {account.institution || account.maskedNumber || "-"}
                          </span>
                        </div>
                      ))}
                      {group.accounts.length === 0 && (
                        <p className="text-sm text-gray-500">
                          No accounts in this group
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Create Corpus Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Account Group</DialogTitle>
              <DialogDescription>
                Create a new group to link accounts that represent the same
                corpus of money.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="corpusName">Group Name</Label>
                <Input
                  id="corpusName"
                  value={newCorpusName}
                  onChange={(e) => setNewCorpusName(e.target.value)}
                  placeholder="e.g., Personal Investments"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="corpusDescription">Description (optional)</Label>
                <Input
                  id="corpusDescription"
                  value={newCorpusDescription}
                  onChange={(e) => setNewCorpusDescription(e.target.value)}
                  placeholder="e.g., All accounts for personal investment portfolio"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={createCorpus} disabled={!newCorpusName.trim()}>
                  Create Group
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
