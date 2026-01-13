-- Remove emailSubject key from transaction data JSONB column
-- This key is redundant since we can join to the emails table for the subject

UPDATE transactions
SET data = data - 'emailSubject'
WHERE data ? 'emailSubject';
