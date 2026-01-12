-- Migration: Add dedicated columns for options trading and RSU fields
-- These fields were previously stored in the data JSONB column but are common enough to warrant proper columns

-- Options trading fields
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS security_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS option_type TEXT; -- 'call' or 'put'
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS strike_price NUMERIC(18,4);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS expiration_date TEXT; -- ISO date string
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS option_action TEXT; -- buy_to_open, sell_to_close, etc.

-- RSU/Stock grant fields
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS grant_number TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS vest_date TEXT; -- ISO date string

-- Add indexes for commonly queried fields
CREATE INDEX IF NOT EXISTS idx_transactions_option_type ON transactions(option_type) WHERE option_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_security_name ON transactions(security_name) WHERE security_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_grant_number ON transactions(grant_number) WHERE grant_number IS NOT NULL;

-- Add comments
COMMENT ON COLUMN transactions.security_name IS 'Full security name (e.g., INTEL CORP, Apple Inc.)';
COMMENT ON COLUMN transactions.option_type IS 'Option type: call or put';
COMMENT ON COLUMN transactions.strike_price IS 'Option strike price';
COMMENT ON COLUMN transactions.expiration_date IS 'Option expiration date in ISO format (YYYY-MM-DD)';
COMMENT ON COLUMN transactions.option_action IS 'Option action: buy_to_open, buy_to_close, sell_to_open, sell_to_close, assigned, expired, exercised';
COMMENT ON COLUMN transactions.grant_number IS 'RSU or stock grant number';
COMMENT ON COLUMN transactions.vest_date IS 'RSU vesting date in ISO format (YYYY-MM-DD)';

-- Backfill existing data from the JSONB data column
UPDATE transactions
SET
  security_name = COALESCE(security_name, data->>'securityName'),
  option_type = COALESCE(option_type, data->>'optionType'),
  strike_price = COALESCE(strike_price, (data->>'strikePrice')::NUMERIC(18,4)),
  expiration_date = COALESCE(expiration_date, data->>'expirationDate'),
  option_action = COALESCE(option_action, data->>'optionAction'),
  grant_number = COALESCE(grant_number, data->>'grantNumber'),
  vest_date = COALESCE(vest_date, data->>'vestDate')
WHERE data IS NOT NULL
  AND (
    data->>'securityName' IS NOT NULL
    OR data->>'optionType' IS NOT NULL
    OR data->>'strikePrice' IS NOT NULL
    OR data->>'expirationDate' IS NOT NULL
    OR data->>'optionAction' IS NOT NULL
    OR data->>'grantNumber' IS NOT NULL
    OR data->>'vestDate' IS NOT NULL
  );
