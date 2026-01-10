-- Migration: Add order_type and reference_number fields to transactions
-- Supports order type (buy/sell) and transaction reference numbers

-- Add order type (buy, sell, short, cover, etc.)
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS order_type TEXT;

-- Add reference number (transaction/order reference number)
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- Add index for reference number lookups
CREATE INDEX IF NOT EXISTS idx_transactions_reference_number ON transactions(reference_number);
