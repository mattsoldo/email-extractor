/**
 * JSON Schema for transaction extraction
 * Matches the expanded transactions table schema
 * Note: additionalProperties: false is required for OpenAI structured output
 */
export const transactionExtractionJsonSchema = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "description": "Schema for extracting financial transaction data from emails",
  "additionalProperties": false,
  "properties": {
    "isTransactional": {
      "type": "boolean",
      "description": "Whether this email contains any financial transactions"
    },
    "emailType": {
      "type": "string",
      "enum": ["transactional", "evidence", "informational", "marketing", "alert", "statement", "other"],
      "description": "The type of email"
    },
    "transactions": {
      "type": "array",
      "description": "Array of transactions found in this email (can be empty if non-transactional)",
      "items": {
        "type": "object",
        "properties": {
          // Core fields
          "transactionType": {
            "type": "string",
            "enum": [
              "dividend", "interest", "stock_trade", "option_trade",
              "wire_transfer_in", "wire_transfer_out", "funds_transfer",
              "deposit", "withdrawal", "rsu_vest", "rsu_release",
              "account_transfer", "fee", "other"
            ],
            "description": "The type of financial transaction"
          },
          "confidence": {
            "type": "number",
            "description": "Confidence score from 0 to 1"
          },
          "transactionDate": {
            "type": ["string", "null"],
            "description": "Transaction date in ISO format (YYYY-MM-DD)"
          },
          "description": {
            "type": ["string", "null"],
            "description": "Description of the transaction"
          },
          "amount": {
            "type": ["number", "null"],
            "description": "Transaction amount in the specified currency"
          },
          "currency": {
            "type": "string",
            "default": "USD",
            "description": "Currency code (e.g., USD, EUR, GBP)"
          },
          "category": {
            "type": ["string", "null"],
            "description": "Transaction category (e.g., equity, fixed_income, cash)"
          },

          // Account information
          "accountNumber": {
            "type": ["string", "null"],
            "description": "Account number or masked account number (e.g., XXXX-1802)"
          },
          "accountName": {
            "type": ["string", "null"],
            "description": "Account name if mentioned (e.g., 'MAS Irrevocable Trust')"
          },
          "institution": {
            "type": ["string", "null"],
            "description": "Financial institution name (e.g., E*TRADE, Fidelity, Schwab)"
          },

          // Transfer destination
          "toAccountNumber": {
            "type": ["string", "null"],
            "description": "Destination account number for transfers"
          },
          "toAccountName": {
            "type": ["string", "null"],
            "description": "Destination account name for transfers"
          },
          "toInstitution": {
            "type": ["string", "null"],
            "description": "Destination institution for transfers"
          },

          // Security information
          "symbol": {
            "type": ["string", "null"],
            "description": "Stock or option symbol (e.g., AAPL, INTC, SPY)"
          },
          "securityName": {
            "type": ["string", "null"],
            "description": "Full security name (e.g., 'INTEL CORP', 'Apple Inc.')"
          },

          // Quantity fields
          "quantity": {
            "type": ["number", "null"],
            "description": "Number of shares or contracts in the order"
          },
          "quantityExecuted": {
            "type": ["number", "null"],
            "description": "Number of shares or contracts actually executed/filled"
          },
          "quantityRemaining": {
            "type": ["number", "null"],
            "description": "Number of shares or contracts remaining unfilled"
          },

          // Price fields
          "price": {
            "type": ["number", "null"],
            "description": "Price per share or contract"
          },
          "executionPrice": {
            "type": ["number", "null"],
            "description": "Actual execution/fill price per share or contract"
          },
          "priceType": {
            "type": ["string", "null"],
            "enum": ["market", "limit", "stop", "stop_limit", "trailing_stop", null],
            "description": "Type of price/order"
          },
          "limitPrice": {
            "type": ["number", "null"],
            "description": "Limit price for limit orders"
          },

          // Fees
          "fees": {
            "type": ["number", "null"],
            "description": "Transaction fees or commissions"
          },

          // Options fields
          "optionType": {
            "type": ["string", "null"],
            "enum": ["call", "put", null],
            "description": "Option type if applicable"
          },
          "strikePrice": {
            "type": ["number", "null"],
            "description": "Option strike price"
          },
          "expirationDate": {
            "type": ["string", "null"],
            "description": "Option expiration date in ISO format (YYYY-MM-DD)"
          },
          "optionAction": {
            "type": ["string", "null"],
            "enum": ["buy_to_open", "buy_to_close", "sell_to_open", "sell_to_close", "assigned", "expired", "exercised", null],
            "description": "Option action type"
          },
          "contractSize": {
            "type": ["integer", "null"],
            "description": "Number of shares per contract (typically 100 for equity options)"
          },

          // Order tracking
          "orderId": {
            "type": ["string", "null"],
            "description": "Order ID or reference number from the broker"
          },
          "orderQuantity": {
            "type": ["number", "null"],
            "description": "Original order quantity"
          },
          "orderPrice": {
            "type": ["number", "null"],
            "description": "Original order price"
          },
          "orderType": {
            "type": ["string", "null"],
            "enum": ["buy", "sell", "buy_to_cover", "sell_short", null],
            "description": "Order type for stock trades"
          },
          "orderStatus": {
            "type": ["string", "null"],
            "enum": ["pending", "open", "executed", "filled", "partial", "cancelled", "rejected", "expired", null],
            "description": "Order execution status"
          },
          "timeInForce": {
            "type": ["string", "null"],
            "enum": ["day", "gtc", "ioc", "fok", "gtd", "ext", "opg", "cls", null],
            "description": "Time in force (day, good-til-cancelled, immediate-or-cancel, fill-or-kill, etc.)"
          },
          "partiallyExecuted": {
            "type": ["boolean", "null"],
            "description": "Whether the order was partially filled"
          },
          "executionTime": {
            "type": ["string", "null"],
            "description": "Time of execution (HH:MM:SS or full ISO timestamp)"
          },

          // Reference numbers
          "referenceNumber": {
            "type": ["string", "null"],
            "description": "Transaction reference, confirmation, or case number"
          },

          // RSU fields
          "grantNumber": {
            "type": ["string", "null"],
            "description": "RSU or stock grant number"
          },
          "vestDate": {
            "type": ["string", "null"],
            "description": "RSU vesting date in ISO format (YYYY-MM-DD)"
          },

          // Catch-all for additional fields
          "additionalFields": {
            "type": "array",
            "description": "Any other relevant fields extracted from the email as key-value pairs",
            "default": [],
            "items": {
              "type": "object",
              "properties": {
                "key": { "type": "string", "description": "Field name" },
                "value": { "type": "string", "description": "Field value as string" }
              },
              "required": ["key", "value"],
              "additionalProperties": false
            }
          }
        },
        "required": [
          "transactionType", "confidence", "transactionDate", "description", "amount", "currency", "category",
          "accountNumber", "accountName", "institution",
          "toAccountNumber", "toAccountName", "toInstitution",
          "symbol", "securityName",
          "quantity", "quantityExecuted", "quantityRemaining",
          "price", "executionPrice", "priceType", "limitPrice",
          "fees",
          "optionType", "strikePrice", "expirationDate", "optionAction", "contractSize",
          "orderId", "orderQuantity", "orderPrice", "orderType", "orderStatus", "timeInForce", "partiallyExecuted", "executionTime",
          "referenceNumber",
          "grantNumber", "vestDate",
          "additionalFields"
        ],
        "additionalProperties": false
      }
    },
    "extractionNotes": {
      "type": ["string", "null"],
      "description": "Any notes about the extraction, ambiguities, or why this email is non-transactional"
    },
    "discussionSummary": {
      "type": ["string", "null"],
      "description": "Concise summary for evidence/discussion emails (null if not evidence)"
    },
    "relatedReferenceNumbers": {
      "type": "array",
      "description": "External reference numbers, confirmation numbers, or case IDs mentioned in evidence emails (not database IDs)",
      "items": { "type": "string" },
      "default": []
    }
  },
  "required": ["isTransactional", "emailType", "transactions", "discussionSummary", "relatedReferenceNumbers", "extractionNotes"]
} as const;

// Type for the schema (for use with TypeScript)
export type TransactionExtractionJsonSchema = typeof transactionExtractionJsonSchema;
