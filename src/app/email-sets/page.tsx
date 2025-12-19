"use client";

import { useEffect, useState, useCallback } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import {
  RefreshCw,
  Trash2,
  Eye,
  Edit2,
  FolderOpen,
  Mail,
  AlertTriangle,
  Plus,
} from "lucide-react";
import Link from "next/link";

interface EmailSet {
  id: string;
  name: string;
  description: string | null;
  emailCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function EmailSetsPage() {
  const [sets, setSets] = useState<EmailSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<EmailSet | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<EmailSet | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchSets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-sets");
      const data = await res.json();
      setSets(data.sets || []);
    } catch (error) {
      console.error("Failed to fetch sets:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSets();
  }, [fetchSets]);

  const handleDelete = async () => {
    if (!deleteTarget) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/email-sets/${deleteTarget.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        fetchSets();
        setDeleteTarget(null);
      }
    } catch (error) {
      console.error("Failed to delete set:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleEdit = async () => {
    if (!editTarget) return;

    try {
      const res = await fetch(`/api/email-sets/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription || null,
        }),
      });

      if (res.ok) {
        fetchSets();
        setEditTarget(null);
      }
    } catch (error) {
      console.error("Failed to update set:", error);
    }
  };

  const openEditDialog = (set: EmailSet) => {
    setEditTarget(set);
    setEditName(set.name);
    setEditDescription(set.description || "");
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch("/api/email-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim() || null,
        }),
      });

      if (res.ok) {
        fetchSets();
        setShowCreateDialog(false);
        setCreateName("");
        setCreateDescription("");
      }
    } catch (error) {
      console.error("Failed to create set:", error);
    } finally {
      setCreating(false);
    }
  };

  const totalEmails = sets.reduce((sum, s) => sum + s.emailCount, 0);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Email Sets</h1>
            <p className="text-gray-600 mt-1">
              Manage groups of imported emails
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Create Set
            </Button>
            <Button onClick={fetchSets} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Total Sets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-blue-600" />
                <span className="text-2xl font-bold">{sets.length}</span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500 font-normal">
                Total Emails
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-green-600" />
                <span className="text-2xl font-bold">{totalEmails}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sets Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Emails</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : sets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      No email sets found. Upload some emails to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  sets.map((set) => (
                    <TableRow key={set.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-gray-400" />
                          {set.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-gray-600 text-sm">
                        {set.description || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{set.emailCount}</Badge>
                      </TableCell>
                      <TableCell className="text-gray-600 text-sm">
                        {format(new Date(set.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Link href={`/emails?setId=${set.id}`}>
                            <Button variant="ghost" size="sm" title="View emails">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(set)}
                            title="Edit set"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(set)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Delete set"
                          >
                            <Trash2 className="h-4 w-4" />
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

        {/* Delete Confirmation Dialog */}
        <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Delete Email Set
              </DialogTitle>
              <DialogDescription>
                Are you sure you want to delete the set &quot;{deleteTarget?.name}&quot;?
                This will permanently delete{" "}
                <strong>{deleteTarget?.emailCount} emails</strong> and any
                transactions extracted from them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete Set"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Email Set</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Set name"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditTarget(null)}>
                Cancel
              </Button>
              <Button onClick={handleEdit}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Email Set</DialogTitle>
              <DialogDescription>
                Create an empty set to organize emails. You can upload emails into this set later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g., Q1 2024 Transactions"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Optional description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
                {creating ? "Creating..." : "Create Set"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
