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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw, Edit, Eye, ExternalLink } from "lucide-react";

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

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounts?stats=true");
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (error) {
      console.error("Failed to fetch accounts:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

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
    } catch (error) {
      console.error("Failed to update account:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Accounts</h1>
            <p className="text-gray-600 mt-1">
              Manage detected accounts and consolidate duplicates
            </p>
          </div>
          <Button onClick={fetchAccounts} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {/* Accounts Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell colSpan={7} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : accounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      No accounts found. Process some emails first.
                    </TableCell>
                  </TableRow>
                ) : (
                  accounts.map((account) => (
                    <TableRow key={account.id}>
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
      </main>
    </div>
  );
}
