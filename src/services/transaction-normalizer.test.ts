import { describe, it, expect } from "vitest";
import {
  normalizeAccountNumber,
  extractLast4,
  accountNumbersMatch,
  normalizeTransaction,
} from "./transaction-normalizer";
import type { TransactionExtraction } from "./ai-extractor";

describe("transaction-normalizer", () => {
  describe("normalizeAccountNumber", () => {
    it("should remove spaces", () => {
      expect(normalizeAccountNumber("1234 5678")).toBe("12345678");
    });

    it("should remove dashes", () => {
      expect(normalizeAccountNumber("1234-5678")).toBe("12345678");
    });

    it("should convert to uppercase", () => {
      expect(normalizeAccountNumber("xxxx1234")).toBe("XXXX1234");
    });

    it("should handle combined formatting", () => {
      expect(normalizeAccountNumber("xxxx-1234 5678")).toBe("XXXX12345678");
    });

    it("should handle already normalized numbers", () => {
      expect(normalizeAccountNumber("XXXX1234")).toBe("XXXX1234");
    });
  });

  describe("extractLast4", () => {
    it("should extract last 4 digits from full account number", () => {
      expect(extractLast4("12345678901234")).toBe("1234");
    });

    it("should extract last 4 from masked account", () => {
      expect(extractLast4("XXXX-1802")).toBe("1802");
    });

    it("should handle account with spaces", () => {
      expect(extractLast4("XXXX 1802")).toBe("1802");
    });

    it("should return null for numbers with less than 4 digits", () => {
      expect(extractLast4("123")).toBe(null);
    });

    it("should return null for non-numeric strings", () => {
      expect(extractLast4("XXXXABCD")).toBe(null);
    });

    it("should handle just 4 digits", () => {
      expect(extractLast4("5678")).toBe("5678");
    });
  });

  describe("accountNumbersMatch", () => {
    describe("exact matches", () => {
      it("should match identical account numbers", () => {
        expect(accountNumbersMatch("12345678", "12345678")).toBe(true);
      });

      it("should match with different formatting", () => {
        expect(accountNumbersMatch("1234-5678", "12345678")).toBe(true);
      });

      it("should match case-insensitively", () => {
        expect(accountNumbersMatch("xxxx1234", "XXXX1234")).toBe(true);
      });
    });

    describe("masked number matching", () => {
      it("should match masked account with full account number sharing last 4", () => {
        expect(accountNumbersMatch("XXXX-1802", "987654321802")).toBe(true);
      });

      it("should match two masked accounts with same last 4", () => {
        expect(accountNumbersMatch("XXXX-1802", "XXXX1802")).toBe(true);
      });

      it("should match full account with differently formatted masked", () => {
        expect(accountNumbersMatch("123456781802", "XXXX 1802")).toBe(true);
      });
    });

    describe("non-matches", () => {
      it("should not match accounts with different last 4 digits", () => {
        expect(accountNumbersMatch("XXXX-1802", "XXXX-1234")).toBe(false);
      });

      it("should not match completely different full numbers", () => {
        expect(accountNumbersMatch("12345678", "87654321")).toBe(false);
      });

      it("should not match when last 4 differ", () => {
        expect(accountNumbersMatch("123456781111", "123456782222")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should match empty strings as exact match", () => {
        // Empty strings are technically equal (exact match)
        expect(accountNumbersMatch("", "")).toBe(true);
      });

      it("should not match empty with non-empty", () => {
        expect(accountNumbersMatch("", "1234")).toBe(false);
      });

      it("should handle accounts without 4 digit suffix", () => {
        expect(accountNumbersMatch("ABC", "ABC")).toBe(true); // exact match
      });
    });
  });

  describe("normalizeTransaction", () => {
    const baseExtraction: TransactionExtraction = {
      transactionType: "dividend",
      transactionDate: "2024-01-15",
      amount: 125.5,
      currency: "USD",
      confidence: 0.95,
    };

    it("should create transaction with basic fields", () => {
      const result = normalizeTransaction(baseExtraction, "acc-1", null);

      expect(result.type).toBe("dividend");
      expect(result.accountId).toBe("acc-1");
      expect(result.amount).toBe("125.5");
      expect(result.currency).toBe("USD");
      expect(result.confidence).toBe("0.95");
      expect(result.id).toBeDefined();
    });

    it("should handle null accountId", () => {
      const result = normalizeTransaction(baseExtraction, null, null);
      expect(result.accountId).toBeNull();
    });

    it("should handle transfer with toAccountId", () => {
      const transferExtraction: TransactionExtraction = {
        ...baseExtraction,
        transactionType: "wire_transfer_out",
      };

      const result = normalizeTransaction(transferExtraction, "acc-1", "acc-2");
      expect(result.accountId).toBe("acc-1");
      expect(result.toAccountId).toBe("acc-2");
    });

    it("should include stock trade fields", () => {
      const stockExtraction: TransactionExtraction = {
        transactionType: "stock_trade",
        transactionDate: "2024-01-15",
        symbol: "AAPL",
        quantity: 100,
        price: 185.5,
        amount: 18550,
        orderType: "limit",
        orderStatus: "executed",
        confidence: 0.9,
      };

      const result = normalizeTransaction(stockExtraction, "acc-1", null);

      expect(result.symbol).toBe("AAPL");
      expect(result.quantity).toBe("100");
      expect(result.price).toBe("185.5");
      expect(result.data).toHaveProperty("orderType", "limit");
      expect(result.data).toHaveProperty("orderStatus", "executed");
    });

    it("should include option fields", () => {
      const optionExtraction: TransactionExtraction = {
        transactionType: "option_trade",
        transactionDate: "2024-01-15",
        symbol: "AAPL",
        optionType: "call",
        strikePrice: 190,
        expirationDate: "2024-02-15",
        optionAction: "buy_to_open",
        quantity: 10,
        price: 5.5,
        confidence: 0.85,
      };

      const result = normalizeTransaction(optionExtraction, "acc-1", null);

      expect(result.data).toHaveProperty("optionType", "call");
      expect(result.data).toHaveProperty("strikePrice", 190);
      expect(result.data).toHaveProperty("expirationDate", "2024-02-15");
      expect(result.data).toHaveProperty("optionAction", "buy_to_open");
    });

    it("should include RSU fields", () => {
      const rsuExtraction: TransactionExtraction = {
        transactionType: "rsu_vest",
        transactionDate: "2024-01-15",
        symbol: "GOOG",
        quantity: 50,
        grantNumber: "RSU-2024-001",
        vestDate: "2024-01-15",
        confidence: 0.92,
      };

      const result = normalizeTransaction(rsuExtraction, "acc-1", null);

      expect(result.data).toHaveProperty("grantNumber", "RSU-2024-001");
      expect(result.data).toHaveProperty("vestDate", "2024-01-15");
    });

    it("should include wire transfer fields", () => {
      const wireExtraction: TransactionExtraction = {
        transactionType: "wire_transfer_in",
        transactionDate: "2024-01-15",
        amount: 50000,
        referenceNumber: "WIRE-2024-12345",
        confidence: 0.98,
      };

      const result = normalizeTransaction(wireExtraction, "acc-1", null);
      expect(result.data).toHaveProperty("referenceNumber", "WIRE-2024-12345");
    });

    it("should include additional fields in data", () => {
      const extractionWithAdditional: TransactionExtraction = {
        ...baseExtraction,
        additionalFields: {
          customField1: "value1",
          customField2: 123,
        },
      };

      const result = normalizeTransaction(extractionWithAdditional, "acc-1", null);

      expect(result.data).toHaveProperty("customField1", "value1");
      expect(result.data).toHaveProperty("customField2", 123);
    });

    it("should include extraction notes", () => {
      const extractionWithNotes: TransactionExtraction = {
        ...baseExtraction,
        extractionNotes: "This dividend was for Q4 2023",
      };

      const result = normalizeTransaction(extractionWithNotes, "acc-1", null);
      expect(result.data).toHaveProperty("extractionNotes", "This dividend was for Q4 2023");
    });

    it("should default currency to USD when not provided", () => {
      const noCurrency: TransactionExtraction = {
        transactionType: "dividend",
        transactionDate: "2024-01-15",
        amount: 100,
      };

      const result = normalizeTransaction(noCurrency, "acc-1", null);
      expect(result.currency).toBe("USD");
    });

    it("should handle fees", () => {
      const withFees: TransactionExtraction = {
        transactionType: "stock_trade",
        transactionDate: "2024-01-15",
        amount: 1000,
        fees: 9.99,
      };

      const result = normalizeTransaction(withFees, "acc-1", null);
      expect(result.fees).toBe("9.99");
    });

    it("should convert numeric values to strings", () => {
      const numericExtraction: TransactionExtraction = {
        transactionType: "stock_trade",
        transactionDate: "2024-01-15",
        amount: 1000.123456,
        quantity: 50.5,
        price: 19.99,
        fees: 0.01,
        confidence: 0.999,
      };

      const result = normalizeTransaction(numericExtraction, "acc-1", null);

      expect(typeof result.amount).toBe("string");
      expect(typeof result.quantity).toBe("string");
      expect(typeof result.price).toBe("string");
      expect(typeof result.fees).toBe("string");
      expect(typeof result.confidence).toBe("string");
    });

    it("should handle security name", () => {
      const withSecurityName: TransactionExtraction = {
        transactionType: "dividend",
        transactionDate: "2024-01-15",
        symbol: "AAPL",
        securityName: "Apple Inc.",
        amount: 50,
      };

      const result = normalizeTransaction(withSecurityName, "acc-1", null);
      expect(result.data).toHaveProperty("securityName", "Apple Inc.");
    });

    it("should use current date when transactionDate is missing", () => {
      const noDate: TransactionExtraction = {
        transactionType: "dividend",
        amount: 100,
      };

      const before = new Date();
      const result = normalizeTransaction(noDate, "acc-1", null);
      const after = new Date();

      expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should generate unique IDs for each transaction", () => {
      const result1 = normalizeTransaction(baseExtraction, "acc-1", null);
      const result2 = normalizeTransaction(baseExtraction, "acc-1", null);

      expect(result1.id).not.toBe(result2.id);
    });
  });
});
