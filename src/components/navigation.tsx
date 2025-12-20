"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Mail,
  ArrowLeftRight,
  Wallet,
  Link2,
  MessageSquare,
  History,
  FolderOpen,
  Scale,
  Cpu,
  FileText,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { Button } from "./ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/email-sets", label: "Sets", icon: FolderOpen },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/runs", label: "Runs", icon: History },
  { href: "/compare", label: "Compare", icon: Scale },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/corpus", label: "Account Groups", icon: Link2 },
  { href: "/models", label: "Models", icon: Cpu },
  { href: "/prompts", label: "Prompts", icon: FileText },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

export function Navigation() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "true");
    }
  }, []);

  // Update body class when collapsed state changes
  useEffect(() => {
    if (isCollapsed) {
      document.body.classList.add("sidebar-collapsed");
      document.body.classList.remove("sidebar-expanded");
    } else {
      document.body.classList.add("sidebar-expanded");
      document.body.classList.remove("sidebar-collapsed");
    }
  }, [isCollapsed]);

  // Save collapsed state to localStorage
  const toggleCollapsed = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem("sidebar-collapsed", String(newState));
  };

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 z-50 flex items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <Mail className="h-6 w-6 text-blue-600" />
          <span className="font-bold text-lg text-gray-900">
            Email Extractor
          </span>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="lg:hidden"
        >
          {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-screen bg-white border-r border-gray-200 z-40 transition-all duration-300 flex flex-col",
          // Desktop
          "hidden lg:flex",
          isCollapsed ? "lg:w-16" : "lg:w-64",
          // Mobile (override for mobile)
          isMobileOpen ? "flex w-64" : "max-lg:hidden"
        )}
      >
        {/* Logo and Toggle */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200 flex-shrink-0">
          {!isCollapsed ? (
            <>
              <Link href="/" className="flex items-center gap-2">
                <Mail className="h-6 w-6 text-blue-600 flex-shrink-0" />
                <span className="font-bold text-lg text-gray-900 truncate">
                  Email Extractor
                </span>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapsed}
                className="hidden lg:flex"
                title="Collapse sidebar"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <div className="flex items-center justify-center w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleCollapsed}
                className="hidden lg:flex"
                title="Expand sidebar"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                    isCollapsed ? "justify-center" : ""
                  )}
                  title={isCollapsed ? item.label : undefined}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  {!isCollapsed && (
                    <span className="truncate">{item.label}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>
    </>
  );
}
