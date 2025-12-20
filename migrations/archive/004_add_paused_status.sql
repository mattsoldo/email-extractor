-- Migration: Add 'paused' status to job_status enum
-- Version: 0.4.0
-- Date: 2025-12-20
-- Description: Allows extraction runs to be paused and resumed

-- Add 'paused' value to the job_status enum
-- PostgreSQL requires using ALTER TYPE for enum modifications
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'paused';

-- Note: The new value 'paused' will be added after 'running' in the enum
-- This allows jobs to transition: pending -> running -> paused -> running -> completed/failed/cancelled
