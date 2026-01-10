-- Migration: Expand transactions table with order tracking and execution fields
-- Merges Rails schema fields while keeping our normalized structure and conventions

-- Add description field
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS description TEXT;

-- Add execution-related fields (using our decimal precision for prices)
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS execution_price DECIMAL(18, 4);

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS price_type TEXT;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS quantity_executed DECIMAL(18, 6);

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS quantity_remaining DECIMAL(18, 6);

-- Add category field
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS category TEXT;

-- Add limit price (using our decimal precision)
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS limit_price DECIMAL(18, 4);

-- Add options-specific field
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS contract_size INTEGER;

-- Add order tracking fields
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS time_in_force TEXT;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS partially_executed BOOLEAN DEFAULT FALSE;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS execution_time TEXT;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS order_quantity DECIMAL(18, 6);

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS order_id TEXT;

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS order_price DECIMAL(18, 4);

ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS order_status TEXT;

-- Add unclassified data for fields the LLM couldn't map
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS unclassified_data JSONB;

-- Add LLM model tracking
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS llm_model TEXT;

-- Add updated_at timestamp
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_transactions_order_id ON transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_order_status ON transactions(order_status);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category);

-- Add comment explaining the type column (similar to Rails STI note)
COMMENT ON COLUMN transactions.type IS 'Transaction type enum - dividend, stock_trade, option_trade, etc.';
