"use client";

import { useState, useRef, useEffect } from "react";
import { Navigation } from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Send, Bot, User, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface Message {
  role: "user" | "assistant";
  content: string;
  results?: SearchResult[];
  timestamp: Date;
}

interface SearchResult {
  type: "transaction" | "email" | "account" | "summary";
  data: Record<string, unknown>;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I can help you search and analyze your financial transactions. Try asking things like:\n\n• \"Show me my AAPL trades\"\n• \"How many dividends did I receive this year?\"\n• \"Find wire transfers over $10,000\"\n• \"What were my biggest stock sales?\"",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          history,
        }),
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        results: data.results,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        role: "assistant",
        content: `Sorry, I encountered an error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatCurrency = (value: unknown) => {
    if (typeof value === "number" || typeof value === "string") {
      const num = Number(value);
      if (!isNaN(num)) {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(num);
      }
    }
    return String(value || "-");
  };

  const renderResults = (results: SearchResult[]) => {
    if (!results || results.length === 0) return null;

    return (
      <div className="mt-4 space-y-2">
        {results.map((result, idx) => {
          if (result.type === "transaction") {
            const tx = result.data as any;
            return (
              <div
                key={idx}
                className="p-3 bg-gray-50 rounded-lg text-sm border"
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="capitalize">
                    {(tx.type || "").replace(/_/g, " ")}
                  </Badge>
                  <span className="text-gray-500 text-xs">
                    {tx.date
                      ? format(new Date(tx.date), "MMM d, yyyy")
                      : "-"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    {tx.symbol && (
                      <span className="font-semibold">{tx.symbol}</span>
                    )}
                    {tx.quantity && (
                      <span className="text-gray-600 ml-2">
                        {tx.quantity} shares
                      </span>
                    )}
                    {tx.price && (
                      <span className="text-gray-600 ml-1">
                        @ {formatCurrency(tx.price)}
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-right">
                    {formatCurrency(tx.amount)}
                  </div>
                </div>
              </div>
            );
          }

          if (result.type === "email") {
            const email = result.data as any;
            return (
              <div
                key={idx}
                className="p-3 bg-blue-50 rounded-lg text-sm border border-blue-100"
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="capitalize">
                    {email.extractionStatus}
                  </Badge>
                  <span className="text-gray-500 text-xs">
                    {email.date
                      ? format(new Date(email.date), "MMM d, yyyy")
                      : "-"}
                  </span>
                </div>
                <div className="font-medium truncate">{email.subject}</div>
                <div className="text-gray-500 text-xs">{email.sender}</div>
              </div>
            );
          }

          if (result.type === "summary") {
            const stats = result.data as any;
            return (
              <div
                key={idx}
                className="p-4 bg-green-50 rounded-lg text-sm border border-green-100"
              >
                <h4 className="font-semibold mb-2">Summary</h4>
                {stats.overall && (
                  <div className="grid grid-cols-3 gap-4 mb-3">
                    <div>
                      <div className="text-gray-500 text-xs">Transactions</div>
                      <div className="font-semibold">
                        {stats.overall.totalTransactions}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">Total Amount</div>
                      <div className="font-semibold">
                        {formatCurrency(stats.overall.totalAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">Avg Amount</div>
                      <div className="font-semibold">
                        {formatCurrency(stats.overall.avgAmount)}
                      </div>
                    </div>
                  </div>
                )}
                {stats.byType && Object.keys(stats.byType).length > 0 && (
                  <div>
                    <div className="text-gray-500 text-xs mb-1">By Type</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(stats.byType).map(
                        ([type, data]: [string, any]) => (
                          <Badge key={type} variant="secondary">
                            {type.replace(/_/g, " ")}: {data.count}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Transaction Assistant
          </h1>
          <p className="text-gray-600 mt-1">
            Ask questions about your financial transactions and emails
          </p>
        </div>

        <Card className="h-[600px] flex flex-col">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Chat
            </CardTitle>
          </CardHeader>

          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.map((message, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 ${
                    message.role === "user" ? "flex-row-reverse" : ""
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      message.role === "user"
                        ? "bg-blue-500"
                        : "bg-gray-200"
                    }`}
                  >
                    {message.role === "user" ? (
                      <User className="h-4 w-4 text-white" />
                    ) : (
                      <Bot className="h-4 w-4 text-gray-600" />
                    )}
                  </div>
                  <div
                    className={`flex-1 ${
                      message.role === "user" ? "text-right" : ""
                    }`}
                  >
                    <div
                      className={`inline-block rounded-lg px-4 py-2 max-w-[90%] ${
                        message.role === "user"
                          ? "bg-blue-500 text-white"
                          : "bg-white border shadow-sm"
                      }`}
                    >
                      <div className="whitespace-pre-wrap text-sm">
                        {message.content}
                      </div>
                    </div>
                    {message.results && renderResults(message.results)}
                    <div className="text-xs text-gray-400 mt-1">
                      {format(message.timestamp, "h:mm a")}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-gray-600" />
                  </div>
                  <div className="bg-white border rounded-lg px-4 py-2 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <CardContent className="border-t p-4">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your transactions..."
                disabled={loading}
                className="flex-1"
              />
              <Button onClick={sendMessage} disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
