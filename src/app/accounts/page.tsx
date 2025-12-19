"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  RefreshCw,
  Edit,
  Eye,
  ExternalLink,
  FolderOpen,
  History,
  Search,
  Merge,
  ArrowRight,
  AlertTriangle,
} from "lucide-react";

interface EmailSet {
  id: string;
  name: string;
  emailCount: number;
}

interface ExtractionRun {
  id: string;
  name: string | null;
  version: number;
  transactionsCreated: number;
}

interface Account {
  id: string;
  displayName: string | null;
  institution: string | null;
  accountNumber: string | null;
  maskedNumber: string | null;
  accountType: string | null;
  corpusId: string | null;
  isExternal: boolean;
  stats?: {
    transactionCount: number;
    totalAmount: number;
  };
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({
    displayName: "",
    institution: "",
    accountType: "",
  });

  // Filters
  const [setFilter, setSetFilter] = useState<string>("all");
  const [runFilter, setRunFilter] = useState<string>("all");
  const [emailSets, setEmailSets] = useState<EmailSet[]>([]);
  const [extractionRuns, setExtractionRuns] = useState<ExtractionRun[]>([]);

  // Text filter
  const [searchQuery, setSearchQuery] = useState("");

  // Multi-select for merging
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [targetAccountId, setTargetAccountId] = useState<string>("");
  const [merging, setMerging] = useState(false);

  // Fetch filter options
  useEffect(() => {
    async function fetchFilterOptions() {
      try {
        const [setsRes, runsRes] = await Promise.all([
          fetch("/api/email-sets"),
          fetch("/api/runs"),
        ]);
        const setsData = await setsRes.json();
        const runsData = await runsRes.json();
        setEmailSets(setsData.sets || []);
        setExtractionRuns(runsData.runs || []);
      } catch (error) {
        console.error("Failed to fetch filter options:", error);
      }
    }
    fetchFilterOptions();
  }, []);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ stats: "true" });
      if (setFilter !== "all") {
        params.set("setId", setFilter);
      }
      if (runFilter !== "all") {
        params.set("runId", runFilter);
      }
      const res = await fetch(`/api/accounts?${params}`);
      const data = await res.json();
      setAccounts(data.accounts || []);
      // Clear selection when accounts change
      setSelectedIds(new Set());
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setLoading(false);
    }
  }, [setFilter, runFilter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Filter accounts by search query
  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts;
    const query = searchQuery.toLowerCase();
    return accounts.filter((account) => {
      const searchableFields = [
        account.displayName,
        account.institution,
        account.accountNumber,
        account.maskedNumber,
        account.accountType,
      ].filter(Boolean);
      return searchableFields.some((field) =>
        field?.toLowerCase().includes(query)
      );
    });
  }, [accounts, searchQuery]);

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setEditForm({
      displayName: account.displayName || "",
      institution: account.institution || "",
      accountType: account.accountType || "",
    });
  };

  const saveAccount = async () => {
    if (!editingAccount) return;

    try {
      await fetch(`/api/accounts/${editingAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      setEditingAccount(null);
      fetchAccounts();
      toast.success("Account updated");
    } catch (error) {
      console.error("Failed to update account:", error);
      toast.error("Failed to update account");
    }
  };

  // Selection handlers
  const toggleSelection = (accountId: string) => {
    const newSelection = new Set(selectedIds);
    if (newSelection.has(accountId)) {
      newSelection.delete(accountId);
    } else {
      newSelection.add(accountId);
    }
    setSelectedIds(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAccounts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAccounts.map((a) => a.id)));
    }
  };

  // Get selected accounts for merge dialog
  const selectedAccounts = useMemo(() => {
    return accounts.filter((a) => selectedIds.has(a.id));
  }, [accounts, selectedIds]);

  // Open merge dialog
  const openMergeDialog = () => {
    if (selectedIds.size < 2) {
      toast.error("Select at least 2 accounts to merge");
      return;
    }
    // Default to account with most transactions as target
    const sortedSelected = [...selectedAccounts].sort(
      (a, b) => (b.stats?.transactionCount || 0) - (a.stats?.transactionCount || 0)
    );
    setTargetAccountId(sortedSelected[0]?.id || "");
    setShowMergeDialog(true);
  };

  // Execute merge
  const executeMerge = async () => {
    if (!targetAccountId || selectedIds.size < 2) return;

    setMerging(true);
    try {
      const sourceIds = [...selectedIds].filter((id) => id !== targetAccountId);
      const res = await fetch("/api/accounts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAccountId,
          sourceAccountIds: sourceIds,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Merged ${data.mergedCount} accounts`);
        setShowMergeDialog(false);
        setSelectedIds(new Set());
        fetchAccounts();
      } else {
        toast.error(data.error || "Failed to merge accounts");
      }
    } catch (error) {
      console.error("Merge failed:", error);
      toast.error("Failed to merge accounts");
    } finally {
      setMerging(false);
    }
  };

  const getAccountLabel = (account: Account) => {
    const parts = [account.displayName || "Unknown"];
    if (account.institution) parts.push(`(${account.institution})`);
    if (account.maskedNumber) parts.push(`- ${account.maskedNumber}`);
    return parts.join(" ");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Accounts</h1>
            <p className="text-gray-600 mt-1">
              Manage detected accounts and merge duplicates
            </p>
          </div>
          <div className="flex gap-2">
            {selectedIds.size >= 2 && (
              <Button onClick={openMergeDialog} className="gap-2">
                <Merge className="h-4 w-4" />
                Merge Selected ({selectedIds.size})
              </Button>
            )}
            <Button onClick={fetchAccounts} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Filter accounts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600">Set:</span>
            <Select value={setFilter} onValueChange={setSetFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sets</SelectItem>
                {emailSets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {set.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-gray-400" />
            <span className="text-sm text-gray-600">Run:</span>
            <Select value={runFilter} onValueChange={setRunFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All runs</SelectItem>
                {extractionRuns.map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    {run.name || `Run v${run.version}`} ({run.transactionsCreated})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(setFilter !== "all" || runFilter !== "all" || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSetFilter("all");
                setRunFilter("all");
                setSearchQuery("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Selection Info */}
        {selectedIds.size > 0 && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg flex items-center justify-between">
            <span className="text-sm text-blue-800">
              {selectedIds.size} account(s) selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear selection
            </Button>
          </div>
        )}

        {/* Accounts Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={
                        filteredAccounts.length > 0 &&
                        selectedIds.size === filteredAccounts.length
                      }
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Account Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  <TableHead className="text-right">Total Amount</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredAccounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      {searchQuery
                        ? "No accounts match your search"
                        : "No accounts found. Process some emails first."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAccounts.map((account) => (
                    <TableRow
                      key={account.id}
                      className={selectedIds.has(account.id) ? "bg-blue-50" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(account.id)}
                          onCheckedChange={() => toggleSelection(account.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {account.displayName || "Unknown Account"}
                          </span>
                          {account.isExternal && (
                            <Badge variant="outline" className="text-xs">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              External
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600">
                        {account.institution || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {account.accountNumber || account.maskedNumber || "-"}
                      </TableCell>
                      <TableCell>
                        {account.accountType ? (
                          <Badge variant="secondary">{account.accountType}</Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {account.stats?.transactionCount || 0}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {account.stats
                          ? formatAmount(account.stats.totalAmount)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedAccount(account)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(account)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Account Count */}
        <div className="mt-4 text-sm text-gray-500">
          Showing {filteredAccounts.length} of {accounts.length} accounts
        </div>

        {/* Account Detail Dialog */}
        <Dialog
          open={!!selectedAccount}
          onOpenChange={() => setSelectedAccount(null)}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {selectedAccount?.displayName || "Account Details"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Institution:</span>{" "}
                  {selectedAccount?.institution || "-"}
                </div>
                <div>
                  <span className="text-gray-500">Account Number:</span>{" "}
                  <span className="font-mono">
                    {selectedAccount?.accountNumber ||
                      selectedAccount?.maskedNumber ||
                      "-"}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Type:</span>{" "}
                  {selectedAccount?.accountType || "-"}
                </div>
                <div>
                  <span className="text-gray-500">External:</span>{" "}
                  {selectedAccount?.isExternal ? "Yes" : "No"}
                </div>
                <div>
                  <span className="text-gray-500">Transactions:</span>{" "}
                  {selectedAccount?.stats?.transactionCount || 0}
                </div>
                <div>
                  <span className="text-gray-500">Total Amount:</span>{" "}
                  {selectedAccount?.stats
                    ? formatAmount(selectedAccount.stats.totalAmount)
                    : "-"}
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Account Dialog */}
        <Dialog
          open={!!editingAccount}
          onOpenChange={() => setEditingAccount(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name</Label>
                <Input
                  id="displayName"
                  value={editForm.displayName}
                  onChange={(e) =>
                    setEditForm({ ...editForm, displayName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="institution">Institution</Label>
                <Input
                  id="institution"
                  value={editForm.institution}
                  onChange={(e) =>
                    setEditForm({ ...editForm, institution: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountType">Account Type</Label>
                <Input
                  id="accountType"
                  value={editForm.accountType}
                  onChange={(e) =>
                    setEditForm({ ...editForm, accountType: e.target.value })
                  }
                  placeholder="e.g., brokerage, ira, trust"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setEditingAccount(null)}
                >
                  Cancel
                </Button>
                <Button onClick={saveAccount}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Merge Dialog */}
        <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Merge className="h-5 w-5" />
                Merge Accounts
              </DialogTitle>
              <DialogDescription>
                Select the target account to keep. All transactions from other
                selected accounts will be moved to this account.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* Warning */}
              <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg text-amber-800 text-sm">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div>
                  <strong>This action cannot be undone.</strong> The source
                  accounts will be permanently deleted after their transactions
                  are moved to the target account.
                </div>
              </div>

              {/* Target Account Selection */}
              <div className="space-y-2">
                <Label>Keep this account (target)</Label>
                <Select value={targetAccountId} onValueChange={setTargetAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select target account" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        <div className="flex items-center gap-2">
                          <span>{getAccountLabel(account)}</span>
                          <Badge variant="secondary" className="ml-2">
                            {account.stats?.transactionCount || 0} txns
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Preview of merge */}
              {targetAccountId && (
                <div className="space-y-2">
                  <Label className="text-gray-500">Accounts to merge</Label>
                  <ScrollArea className="h-[150px] border rounded-lg p-2">
                    <div className="space-y-2">
                      {selectedAccounts
                        .filter((a) => a.id !== targetAccountId)
                        .map((account) => (
                          <div
                            key={account.id}
                            className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded"
                          >
                            <div className="flex items-center gap-2">
                              <span>{getAccountLabel(account)}</span>
                            </div>
                            <div className="flex items-center gap-2 text-gray-500">
                              <span>
                                {account.stats?.transactionCount || 0} txns
                              </span>
                              <ArrowRight className="h-4 w-4" />
                              <span className="text-blue-600">Target</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowMergeDialog(false)}
                disabled={merging}
              >
                Cancel
              </Button>
              <Button
                onClick={executeMerge}
                disabled={!targetAccountId || merging}
                className="gap-2"
              >
                {merging ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Merging...
                  </>
                ) : (
                  <>
                    <Merge className="h-4 w-4" />
                    Merge {selectedIds.size - 1} Account(s)
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
