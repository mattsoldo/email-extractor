import { describe, it, expect } from "vitest";
import {
  TransactionExtractionSchema,
  prepareEmailContent,
  stripHtml,
} from "./ai-extractor";
import type { ParsedEmail } from "./email-parser";

describe("ai-extractor", () => {
  describe("TransactionExtractionSchema", () => {
    it("should validate a complete dividend extraction", () => {
      const data = {
        isTransaction: true,
        transactionType: "dividend",
        confidence: 0.95,
        transactionDate: "2024-01-15",
        amount: 125.5,
        currency: "USD",
        accountNumber: "XXXX-1802",
        accountName: "Personal Brokerage",
        institution: "E*TRADE",
        toAccountNumber: null,
        toAccountName: null,
        toInstitution: null,
        symbol: "AAPL",
        securityName: "Apple Inc.",
        quantity: null,
        price: null,
        optionType: null,
        strikePrice: null,
        expirationDate: null,
        optionAction: null,
        orderType: null,
        orderStatus: null,
        fees: null,
        referenceNumber: null,
        grantNumber: null,
        vestDate: null,
        additionalFields: {},
        extractionNotes: null,
      };

      const result = TransactionExtractionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("should validate a stock trade extraction", () => {
      const data = {
        isTransaction: true,
        transactionType: "stock_trade",
        confidence: 0.92,
        transactionDate: "2024-01-15",
        amount: 18550,
        currency: "USD",
        accountNumber: "XXXX-1234",
        accountName: null,
        institution: "Fidelity",
        toAccountNumber: null,
        toAccountName: null,
        toInstitution: null,
        symbol: "AAPL",
        securityName: "Apple Inc.",
        quantity: 100,
        price: 185.5,
        optionType: null,
        strikePrice: null,
        expirationDate: null,
        optionAction: null,
        orderType: "buy",
        orderStatus: "executed",
        fees: 0,
        referenceNumber: null,
        grantNumber: null,
        vestDate: null,
        additionalFields: { orderNumber: "12345" },
        extractionNotes: null,
      };

      const result = TransactionExtractionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("should validate an option trade extraction", () => {
      const data = {
        isTransaction: true,
        transactionType: "option_trade",
        confidence: 0.88,
        transactionDate: "2024-01-15",
        amount: 550,
        currency: "USD",
        accountNumber: "XXXX-5678",
        accountName: null,
        institution: null,
        toAccountNumber: null,
        toAccountName: null,
        toInstitution: null,
        symbol: "AAPL",
        securityName: null,
        quantity: 10,
        price: 5.5,
        optionType: "call",
        strikePrice: 190,
        expirationDate: "2024-02-15",
        optionAction: "buy_to_open",
        orderType: null,
        orderStatus: null,
        fees: 6.5,
        referenceNumber: null,
        grantNumber: null,
        vestDate: null,
        additionalFields: {},
        extractionNotes: "Premium paid for 10 contracts",
      };

      const result = TransactionExtractionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("should validate a wire transfer extraction", () => {
      const data = {
        isTransaction: true,
        transactionType: "wire_transfer_out",
        confidence: 0.98,
        transactionDate: "2024-01-15",
        amount: 50000,
        currency: "USD",
        accountNumber: "XXXX-1111",
        accountName: "Personal Account",
        institution: "E*TRADE",
        toAccountNumber: "XXXX-9999",
        toAccountName: "External Bank",
        toInstitution: "Chase",
        symbol: null,
        securityName: null,
        quantity: null,
        price: null,
        optionType: null,
        strikePrice: null,
        expirationDate: null,
        optionAction: null,
        orderType: null,
        orderStatus: null,
        fees: 25,
        referenceNumber: "WIRE-2024-12345",
        grantNumber: null,
        vestDate: null,
        additionalFields: {},
        extractionNotes: null,
      };

      const result = TransactionExtractionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("should validate a non-transaction email", () => {
      const data = {
        isTransaction: false,
        transactionType: null,
        confidence: 0.15,
        transactionDate: null,
        amount: null,
        currency: "USD",
        accountNumber: null,
        accountName: null,
        institution: null,
        toAccountNumber: null,
        toAccountName: null,
        toInstitution: null,
        symbol: null,
        securityName: null,
        quantity: null,
        price: null,
        optionType: null,
        strikePrice: null,
        expirationDate: null,
        optionAction: null,
        orderType: null,
        orderStatus: null,
        fees: null,
        referenceNumber: null,
        grantNumber: null,
        vestDate: null,
        additionalFields: {},
        extractionNotes: "Marketing email - no transaction",
      };

      const result = TransactionExtractionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    describe("validation errors", () => {
      it("should reject invalid transaction type", () => {
        const data = {
          isTransaction: true,
          transactionType: "invalid_type",
          confidence: 0.5,
        };

        const result = TransactionExtractionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it("should reject confidence outside 0-1 range", () => {
        const data = {
          isTransaction: true,
          transactionType: "dividend",
          confidence: 1.5, // Invalid
        };

        const result = TransactionExtractionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it("should reject negative confidence", () => {
        const data = {
          isTransaction: true,
          transactionType: "dividend",
          confidence: -0.1,
        };

        const result = TransactionExtractionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it("should reject invalid option type", () => {
        const data = {
          isTransaction: true,
          transactionType: "option_trade",
          confidence: 0.8,
          optionType: "straddle", // Invalid - should be call or put
        };

        const result = TransactionExtractionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });

      it("should reject invalid order type", () => {
        const data = {
          isTransaction: true,
          transactionType: "stock_trade",
          confidence: 0.8,
          orderType: "market_buy", // Invalid - should be buy, sell, etc.
        };

        const result = TransactionExtractionSchema.safeParse(data);
        expect(result.success).toBe(false);
      });
    });

    describe("all transaction types", () => {
      const validTypes = [
        "dividend",
        "interest",
        "stock_trade",
        "option_trade",
        "wire_transfer_in",
        "wire_transfer_out",
        "funds_transfer",
        "deposit",
        "withdrawal",
        "rsu_vest",
        "rsu_release",
        "account_transfer",
        "fee",
        "other",
      ];

      it.each(validTypes)("should accept transaction type: %s", (type) => {
        const data = {
          isTransaction: true,
          transactionType: type,
          confidence: 0.8,
          // Include all nullable fields
          transactionDate: null,
          amount: null,
          accountNumber: null,
          accountName: null,
          institution: null,
          toAccountNumber: null,
          toAccountName: null,
          toInstitution: null,
          symbol: null,
          securityName: null,
          quantity: null,
          price: null,
          optionType: null,
          strikePrice: null,
          expirationDate: null,
          optionAction: null,
          orderType: null,
          orderStatus: null,
          fees: null,
          referenceNumber: null,
          grantNumber: null,
          vestDate: null,
          extractionNotes: null,
        };

        const result = TransactionExtractionSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });
  });

  describe("stripHtml", () => {
    it("should remove simple HTML tags", () => {
      const html = "<p>Hello <strong>World</strong></p>";
      expect(stripHtml(html)).toBe("Hello World");
    });

    it("should remove script tags and content", () => {
      const html = "<p>Before</p><script>alert('hack')</script><p>After</p>";
      expect(stripHtml(html)).toBe("Before After");
    });

    it("should remove style tags and content", () => {
      const html = "<style>.red { color: red; }</style><p>Content</p>";
      expect(stripHtml(html)).toBe("Content");
    });

    it("should decode &nbsp;", () => {
      const html = "Hello&nbsp;World";
      expect(stripHtml(html)).toBe("Hello World");
    });

    it("should decode &amp;", () => {
      const html = "Tom &amp; Jerry";
      expect(stripHtml(html)).toBe("Tom & Jerry");
    });

    it("should decode &lt; and &gt;", () => {
      const html = "a &lt; b &gt; c";
      expect(stripHtml(html)).toBe("a < b > c");
    });

    it("should decode &quot;", () => {
      const html = "He said &quot;Hello&quot;";
      expect(stripHtml(html)).toBe('He said "Hello"');
    });

    it("should decode &#39; and &apos;", () => {
      const html = "It&#39;s working, isn&apos;t it";
      expect(stripHtml(html)).toBe("It's working, isn't it");
    });

    it("should collapse multiple whitespaces", () => {
      const html = "<p>Hello</p>    <p>World</p>";
      expect(stripHtml(html)).toBe("Hello World");
    });

    it("should handle complex HTML", () => {
      const html = `
        <html>
          <head><style>body { font: sans-serif; }</style></head>
          <body>
            <h1>Transaction Confirmation</h1>
            <p>Your order for <strong>100</strong> shares of <em>AAPL</em> has been executed.</p>
            <p>Amount: $18,550.00</p>
            <script>trackEvent('page_view');</script>
          </body>
        </html>
      `;
      const result = stripHtml(html);
      expect(result).toContain("Transaction Confirmation");
      expect(result).toContain("100");
      expect(result).toContain("AAPL");
      expect(result).toContain("$18,550.00");
      expect(result).not.toContain("script");
      expect(result).not.toContain("trackEvent");
      expect(result).not.toContain("style");
    });

    it("should handle empty string", () => {
      expect(stripHtml("")).toBe("");
    });
  });

  describe("prepareEmailContent", () => {
    const createEmail = (text: string | null, html: string | null): ParsedEmail => ({
      id: "test-id",
      filename: "test.eml",
      subject: "Test",
      sender: "test@example.com",
      recipient: "user@example.com",
      date: new Date(),
      bodyText: text,
      bodyHtml: html,
      rawContent: null,
      headers: {},
    });

    it("should prefer bodyText when it has substantial content", () => {
      const longText = "A".repeat(150); // More than 100 chars
      const email = createEmail(longText, "<p>HTML content</p>");

      const result = prepareEmailContent(email);
      expect(result).toBe(longText);
    });

    it("should fall back to HTML when bodyText is short", () => {
      const shortText = "Short"; // Less than 100 chars
      const email = createEmail(shortText, "<p>Longer HTML content here</p>");

      const result = prepareEmailContent(email);
      expect(result).toBe("Longer HTML content here");
    });

    it("should fall back to HTML when bodyText is null", () => {
      const email = createEmail(null, "<p>HTML only</p>");

      const result = prepareEmailContent(email);
      expect(result).toBe("HTML only");
    });

    it("should fall back to HTML when bodyText is whitespace only", () => {
      const email = createEmail("   \n\t  ", "<p>HTML fallback</p>");

      const result = prepareEmailContent(email);
      expect(result).toBe("HTML fallback");
    });

    it("should return placeholder when no content", () => {
      const email = createEmail(null, null);

      const result = prepareEmailContent(email);
      expect(result).toBe("(no content)");
    });

    it("should return placeholder when both are empty", () => {
      const email = createEmail("", "");

      const result = prepareEmailContent(email);
      expect(result).toBe("(no content)");
    });

    it("should strip HTML when using HTML body", () => {
      const email = createEmail(null, "<p><strong>Bold</strong> text &amp; more</p>");

      const result = prepareEmailContent(email);
      expect(result).toBe("Bold text & more");
    });
  });
});
