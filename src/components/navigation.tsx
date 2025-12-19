"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/emails", label: "Emails", icon: Mail },
  { href: "/email-sets", label: "Sets", icon: FolderOpen },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/runs", label: "Runs", icon: History },
  { href: "/compare", label: "Compare", icon: Scale },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/corpus", label: "Account Groups", icon: Link2 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-2">
              <Mail className="h-8 w-8 text-blue-600" />
              <span className="font-bold text-xl text-gray-900">
                Email Extractor
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
