/**
 * Script to identify and drop columns with no data in the transactions table
 *
 * Usage:
 *   npx tsx scripts/cleanup-empty-columns.ts          # Preview mode (default)
 *   npx tsx scripts/cleanup-empty-columns.ts --drop   # Actually drop the columns
 */

import { sql } from '../src/db';

// Columns that should NEVER be dropped, even if empty
const PROTECTED_COLUMNS = new Set([
  'id',
  'type',
  'account_id',
  'to_account_id',
  'date',
  'amount',
  'currency',
  'description',
  'symbol',
  'category',
  'quantity',
  'quantity_executed',
  'quantity_remaining',
  'price',
  'execution_price',
  'price_type',
  'limit_price',
  'fees',
  'contract_size',
  'option_type',
  'strike_price',
  'expiration_date',
  'option_action',
  'security_name',
  'grant_number',
  'vest_date',
  'order_id',
  'order_type',
  'order_quantity',
  'order_price',
  'order_status',
  'time_in_force',
  'reference_number',
  'partially_executed',
  'execution_time',
  'data',
  'unclassified_data',
  'source_email_id',
  'extraction_run_id',
  'run_completed',
  'confidence',
  'llm_model',
  'source_transaction_id',
  'created_at',
  'updated_at',
]);

async function main() {
  const shouldDrop = process.argv.includes('--drop');

  console.log('Analyzing transactions table columns...\n');

  // Get all columns
  const columns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'transactions'
    ORDER BY ordinal_position
  `;

  console.log(`Total columns: ${columns.length}`);
  console.log(`Protected columns: ${PROTECTED_COLUMNS.size}`);
  console.log(`Dynamic columns: ${columns.length - PROTECTED_COLUMNS.size}\n`);

  // Check each column for non-null count
  const emptyColumns: string[] = [];
  const columnsWithData: { name: string; count: number }[] = [];

  for (const col of columns) {
    const columnName = col.column_name;

    // Skip protected columns
    if (PROTECTED_COLUMNS.has(columnName)) {
      continue;
    }

    // Count non-null values
    const result = await sql.unsafe(
      `SELECT COUNT("${columnName}") as cnt FROM transactions WHERE "${columnName}" IS NOT NULL`
    );
    const count = parseInt(result[0]?.cnt || '0', 10);

    if (count === 0) {
      emptyColumns.push(columnName);
    } else {
      columnsWithData.push({ name: columnName, count });
    }
  }

  // Sort columns with data by count descending
  columnsWithData.sort((a, b) => b.count - a.count);

  console.log('=== Dynamic Columns WITH Data ===');
  if (columnsWithData.length === 0) {
    console.log('  (none)');
  } else {
    for (const col of columnsWithData) {
      console.log(`  ${col.name}: ${col.count} rows`);
    }
  }

  console.log(`\n=== Empty Columns (${emptyColumns.length}) ===`);
  if (emptyColumns.length === 0) {
    console.log('  (none)');
  } else {
    for (const col of emptyColumns) {
      console.log(`  ${col}`);
    }
  }

  if (emptyColumns.length === 0) {
    console.log('\nNo empty columns to drop.');
    process.exit(0);
  }

  if (!shouldDrop) {
    console.log(`\n⚠️  Preview mode: ${emptyColumns.length} columns would be dropped.`);
    console.log('Run with --drop flag to actually drop these columns:');
    console.log('  npx tsx scripts/cleanup-empty-columns.ts --drop');
    process.exit(0);
  }

  // Actually drop the columns
  console.log(`\n🗑️  Dropping ${emptyColumns.length} empty columns...`);

  for (const columnName of emptyColumns) {
    try {
      await sql.unsafe(`ALTER TABLE transactions DROP COLUMN IF EXISTS "${columnName}"`);
      console.log(`  ✓ Dropped: ${columnName}`);
    } catch (error) {
      console.error(`  ✗ Failed to drop ${columnName}:`, error);
    }
  }

  console.log('\nDone!');

  // Show final column count
  const finalColumns = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM information_schema.columns WHERE table_name = 'transactions'
  `;
  console.log(`Final column count: ${finalColumns[0].count}`);

  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
