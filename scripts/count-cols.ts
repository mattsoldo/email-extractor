import { sql } from '../src/db';

async function main() {
  const result = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions' ORDER BY ordinal_position`;
  console.log('Total columns:', result.length);
  console.log('\nColumns:');
  result.forEach((r, i) => console.log((i + 1) + '. ' + r.column_name));
  process.exit(0);
}

main();
