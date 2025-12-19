import { describe, it, expect } from "vitest";
import { parseEmlContent, classifyEmail, toDbEmail, ParsedEmail } from "./email-parser";

// Sample .eml file content for testing
const sampleEmlContent = `From: "E*TRADE Alerts" <smartalerts-donotreply@etrade.com>
To: customer@example.com
Subject: Your order to BUY AAPL has been executed
Date: Mon, 15 Jan 2024 10:30:00 -0500
Content-Type: text/plain; charset="UTF-8"

Dear Customer,

Your order has been executed.

Security: Apple Inc. (AAPL)
Action: Buy
Quantity: 100 shares
Price: $185.50
Total: $18,550.00

Thank you for using E*TRADE.
`;

const marketingEmlContent = `From: "E*TRADE" <info@etrade.com>
To: customer@example.com
Subject: Important information about your account benefits
Date: Mon, 15 Jan 2024 10:30:00 -0500
Content-Type: text/plain; charset="UTF-8"

Dear Customer,

We have some important information about exciting new features!

Thank you for choosing E*TRADE.
`;

describe("email-parser", () => {
  describe("parseEmlContent", () => {
    it("should parse basic email structure", async () => {
      const result = await parseEmlContent(sampleEmlContent, "test-order.eml");

      expect(result.filename).toBe("test-order.eml");
      expect(result.subject).toBe("Your order to BUY AAPL has been executed");
      expect(result.sender).toBe("smartalerts-donotreply@etrade.com");
      expect(result.recipient).toBe("customer@example.com");
      expect(result.bodyText).toContain("Your order has been executed");
      expect(result.id).toBeDefined();
    });

    it("should parse email from Buffer", async () => {
      const buffer = Buffer.from(sampleEmlContent, "utf-8");
      const result = await parseEmlContent(buffer, "test.eml");

      expect(result.subject).toBe("Your order to BUY AAPL has been executed");
    });

    it("should store raw content", async () => {
      const result = await parseEmlContent(sampleEmlContent, "test.eml");

      expect(result.rawContent).toBe(sampleEmlContent);
    });

    it("should extract date", async () => {
      const result = await parseEmlContent(sampleEmlContent, "test.eml");

      expect(result.date).toBeInstanceOf(Date);
      expect(result.date?.getFullYear()).toBe(2024);
      expect(result.date?.getMonth()).toBe(0); // January
      expect(result.date?.getDate()).toBe(15);
    });

    it("should generate unique IDs", async () => {
      const result1 = await parseEmlContent(sampleEmlContent, "test1.eml");
      const result2 = await parseEmlContent(sampleEmlContent, "test2.eml");

      expect(result1.id).not.toBe(result2.id);
    });

    it("should handle minimal email", async () => {
      const minimalEmail = `From: sender@example.com
To: recipient@example.com
Subject: Test

Body content`;

      const result = await parseEmlContent(minimalEmail, "minimal.eml");

      expect(result.sender).toBe("sender@example.com");
      expect(result.recipient).toBe("recipient@example.com");
      expect(result.subject).toBe("Test");
    });

    it("should handle email with HTML body", async () => {
      const htmlEmail = `From: sender@example.com
To: recipient@example.com
Subject: HTML Test
Content-Type: text/html; charset="UTF-8"

<html><body><h1>Test</h1><p>Content</p></body></html>`;

      const result = await parseEmlContent(htmlEmail, "html.eml");

      expect(result.bodyHtml).toContain("<h1>Test</h1>");
    });
  });

  describe("classifyEmail", () => {
    const createParsedEmail = (
      subject: string,
      sender: string = "alerts@broker.com"
    ): ParsedEmail => ({
      id: "test-id",
      filename: "test.eml",
      subject,
      sender,
      recipient: "customer@example.com",
      date: new Date(),
      bodyText: "Test body",
      bodyHtml: null,
      rawContent: null,
      headers: {},
    });

    describe("transactional emails (should process)", () => {
      it.each([
        "Your order has been executed",
        "Dividend payment received",
        "Interest paid to your account",
        "Wire transfer complete",
        "Funds transfer confirmation",
        "Deposit received",
        "Withdrawal processed",
        "Restricted stock vesting notification",
        "Shares released",
        "Options assigned",
        "Options expired",
        "Account transfer complete",
        "Order confirmation",
        "Trade settled",
        "1099 tax document ready",
      ])('should process email with subject: "%s"', (subject) => {
        const email = createParsedEmail(subject);
        const result = classifyEmail(email);
        expect(result.shouldProcess).toBe(true);
      });
    });

    describe("marketing emails (should skip)", () => {
      it.each([
        "Important information about your account",
        "We have officially joined forces",
        "COVID-19 update",
        "Charitable donations this season",
        "Jump start your savings today",
        "Boost your savings",
        "Message from E*TRADE",
        "Get a competitive rate",
        "Earn 5.00% APY",
        "Annual percentage yield update",
        "Help boost your portfolio",
        "Earn more on your cash",
        "Earn up to 5%",
      ])('should skip email with subject: "%s"', (subject) => {
        const email = createParsedEmail(subject);
        const result = classifyEmail(email);
        expect(result.shouldProcess).toBe(false);
        expect(result.skipReason).toContain("marketing");
      });
    });

    describe("edge cases", () => {
      it("should process emails with unknown subjects by default", () => {
        const email = createParsedEmail("Some random subject");
        const result = classifyEmail(email);
        expect(result.shouldProcess).toBe(true);
      });

      it("should handle null subject", () => {
        const email = createParsedEmail("");
        email.subject = null;
        const result = classifyEmail(email);
        expect(result.shouldProcess).toBe(true);
      });

      it("should handle null sender", () => {
        const email = createParsedEmail("Order executed");
        email.sender = null;
        const result = classifyEmail(email);
        expect(result.shouldProcess).toBe(true);
      });

      it("should be case insensitive", () => {
        const email1 = createParsedEmail("YOUR ORDER HAS BEEN EXECUTED");
        const email2 = createParsedEmail("IMPORTANT INFORMATION ABOUT YOUR ACCOUNT");

        expect(classifyEmail(email1).shouldProcess).toBe(true);
        expect(classifyEmail(email2).shouldProcess).toBe(false);
      });

      it("should process emails from transactional senders", () => {
        const email = createParsedEmail(
          "Your account notification",
          "smartalerts-donotreply@etrade.com"
        );
        const result = classifyEmail(email);
        expect(result.shouldProcess).toBe(true);
      });
    });
  });

  describe("toDbEmail", () => {
    it("should convert ParsedEmail to NewEmail format", () => {
      const parsed: ParsedEmail = {
        id: "test-123",
        filename: "order.eml",
        subject: "Your order executed",
        sender: "alerts@broker.com",
        recipient: "customer@example.com",
        date: new Date("2024-01-15"),
        bodyText: "Order details here",
        bodyHtml: "<p>Order details here</p>",
        rawContent: "Raw email content",
        headers: { "content-type": "text/plain" },
      };

      const dbEmail = toDbEmail(parsed);

      expect(dbEmail.id).toBe("test-123");
      expect(dbEmail.filename).toBe("order.eml");
      expect(dbEmail.subject).toBe("Your order executed");
      expect(dbEmail.sender).toBe("alerts@broker.com");
      expect(dbEmail.recipient).toBe("customer@example.com");
      expect(dbEmail.date).toEqual(new Date("2024-01-15"));
      expect(dbEmail.bodyText).toBe("Order details here");
      expect(dbEmail.bodyHtml).toBe("<p>Order details here</p>");
      expect(dbEmail.rawContent).toBe("Raw email content");
      expect(dbEmail.headers).toEqual({ "content-type": "text/plain" });
      expect(dbEmail.extractionStatus).toBe("pending");
    });

    it("should handle null values", () => {
      const parsed: ParsedEmail = {
        id: "test-123",
        filename: "empty.eml",
        subject: null,
        sender: null,
        recipient: null,
        date: null,
        bodyText: null,
        bodyHtml: null,
        rawContent: null,
        headers: {},
      };

      const dbEmail = toDbEmail(parsed);

      expect(dbEmail.subject).toBeNull();
      expect(dbEmail.sender).toBeNull();
      expect(dbEmail.recipient).toBeNull();
      expect(dbEmail.date).toBeNull();
      expect(dbEmail.bodyText).toBeNull();
      expect(dbEmail.bodyHtml).toBeNull();
      expect(dbEmail.rawContent).toBeNull();
      expect(dbEmail.extractionStatus).toBe("pending");
    });
  });
});
