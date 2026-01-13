import { NextRequest, NextResponse } from "next/server";
import { db, sql as queryClient } from "@/db";
import { transactions, extractionRuns, emails } from "@/db/schema";
import { eq, inArray, and, max, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

// POST /api/runs/synthesize - Create a synthesized run
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, runAId, runBId, primaryRunId, name, description, preview } = body;

    if (!type) {
      return NextResponse.json(
        { error: "Synthesis type is required" },
        { status: 400 }
      );
    }

    if (type === "comparison_winners") {
      return handleComparisonWinners({
        runAId,
        runBId,
        primaryRunId,
        name,
        description,
      });
    }

    if (type === "data_flatten") {
      return handleDataFlatten({
        sourceRunId: runAId,
        name,
        description,
        preview: preview === true,
        selectedKeys: body.selectedKeys,
      });
    }

    if (type === "data_flatten_all") {
      return handleDataFlattenAll({
        setId: body.setId,
        preview: preview === true,
        selectedKeys: body.selectedKeys,
      });
    }

    return NextResponse.json(
      { error: `Unknown synthesis type: ${type}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("Synthesis error:", error);
    return NextResponse.json(
      { error: "Failed to create synthesized run" },
      { status: 500 }
    );
  }
}

interface ComparisonWinnersParams {
  runAId: string;
  runBId: string;
  primaryRunId: string;
  name?: string;
  description?: string;
}

async function handleComparisonWinners(params: ComparisonWinnersParams) {
  const { runAId, runBId, primaryRunId, name, description } = params;

  if (!runAId || !runBId || !primaryRunId) {
    return NextResponse.json(
      { error: "runAId, runBId, and primaryRunId are required for comparison_winners synthesis" },
      { status: 400 }
    );
  }

  if (primaryRunId !== runAId && primaryRunId !== runBId) {
    return NextResponse.json(
      { error: "primaryRunId must be either runAId or runBId" },
      { status: 400 }
    );
  }

  // Verify runs exist
  const [runA, runB] = await Promise.all([
    db.select().from(extractionRuns).where(eq(extractionRuns.id, runAId)).limit(1),
    db.select().from(extractionRuns).where(eq(extractionRuns.id, runBId)).limit(1),
  ]);

  if (!runA[0] || !runB[0]) {
    return NextResponse.json(
      { error: "One or both source runs not found" },
      { status: 404 }
    );
  }

  // Both runs must be from the same email set
  if (runA[0].setId !== runB[0].setId) {
    return NextResponse.json(
      { error: "Both runs must be from the same email set" },
      { status: 400 }
    );
  }

  const setId = runA[0].setId;
  const primaryRun = primaryRunId === runAId ? runA[0] : runB[0];

  // Get all transactions from both runs
  const [transactionsA, transactionsB] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.extractionRunId, runAId)),
    db.select().from(transactions).where(eq(transactions.extractionRunId, runBId)),
  ]);

  // Map transactions by source email ID
  const byEmailA = new Map<string, typeof transactions.$inferSelect>();
  const byEmailB = new Map<string, typeof transactions.$inferSelect>();

  for (const t of transactionsA) {
    if (t.sourceEmailId) {
      byEmailA.set(t.sourceEmailId, t);
    }
  }
  for (const t of transactionsB) {
    if (t.sourceEmailId) {
      byEmailB.set(t.sourceEmailId, t);
    }
  }

  // Get all emails with their winner designations and field overrides
  const allEmailIds = new Set([...byEmailA.keys(), ...byEmailB.keys()]);
  const emailList = await db
    .select({
      id: emails.id,
      winnerTransactionId: emails.winnerTransactionId,
      fieldOverrides: emails.fieldOverrides,
    })
    .from(emails)
    .where(inArray(emails.id, Array.from(allEmailIds)));

  const emailWinners = new Map(emailList.map((e) => [e.id, e.winnerTransactionId]));
  const emailOverrides = new Map(emailList.map((e) => [e.id, e.fieldOverrides as Record<string, unknown> | null]));

  // Get next version number for this set
  const maxVersionResult = await db
    .select({ maxVersion: max(extractionRuns.version) })
    .from(extractionRuns)
    .where(eq(extractionRuns.setId, setId));
  const nextVersion = (maxVersionResult[0]?.maxVersion || 0) + 1;

  // Create the synthesized run
  const synthesizedRunId = randomUUID();
  const synthesizedRunName = name || `Synthesized v${nextVersion} (${runA[0].version} vs ${runB[0].version} winners)`;

  // Determine which transactions to include
  const transactionsToCreate: Array<typeof transactions.$inferInsert> = [];
  let transactionsFromA = 0;
  let transactionsFromB = 0;
  let transactionsTied = 0;
  let transactionsNoWinner = 0;

  // Helper to check if a value is "empty" (null, undefined, or empty string)
  const isEmpty = (val: unknown): boolean => {
    return val === null || val === undefined || val === "";
  };

  // Helper to merge data objects (winner takes precedence, loser fills gaps)
  const mergeData = (
    winnerData: Record<string, unknown> | null,
    loserData: Record<string, unknown> | null
  ): Record<string, unknown> => {
    if (!winnerData && !loserData) return {};
    if (!loserData) return winnerData || {};
    if (!winnerData) return loserData || {};

    const merged = { ...winnerData };
    for (const [key, value] of Object.entries(loserData)) {
      if (isEmpty(merged[key]) && !isEmpty(value)) {
        merged[key] = value;
      }
    }
    return merged;
  };

  // Helper to apply field overrides to a transaction object
  const applyFieldOverrides = (
    txn: typeof transactions.$inferInsert,
    overrides: Record<string, unknown> | null
  ): typeof transactions.$inferInsert => {
    if (!overrides) return txn;

    const result = { ...txn };
    for (const [key, value] of Object.entries(overrides)) {
      // Handle data.* keys (for additional data fields)
      if (key.startsWith("data.")) {
        const dataKey = key.substring(5);
        result.data = {
          ...(result.data as Record<string, unknown> || {}),
          [dataKey]: value,
        };
      } else if (key in result) {
        // Direct field override - cast appropriately
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (result as any)[key] = value;
      }
    }
    return result;
  };

  for (const emailId of allEmailIds) {
    const tA = byEmailA.get(emailId);
    const tB = byEmailB.get(emailId);
    const winner = emailWinners.get(emailId);
    const overrides = emailOverrides.get(emailId);

    let winnerTransaction: typeof transactions.$inferSelect | null = null;
    let loserTransaction: typeof transactions.$inferSelect | null = null;
    let reason = "";

    if (winner === "tie") {
      // Use primary run for ties, secondary as loser for field merging
      winnerTransaction = primaryRunId === runAId ? tA || null : tB || null;
      loserTransaction = primaryRunId === runAId ? tB || null : tA || null;
      reason = "tie";
      transactionsTied++;
    } else if (winner && tA && winner === tA.id) {
      // Run A was designated winner
      winnerTransaction = tA;
      loserTransaction = tB || null;
      reason = "winner_a";
      transactionsFromA++;
    } else if (winner && tB && winner === tB.id) {
      // Run B was designated winner
      winnerTransaction = tB;
      loserTransaction = tA || null;
      reason = "winner_b";
      transactionsFromB++;
    } else {
      // No winner designated - use primary run
      winnerTransaction = primaryRunId === runAId ? tA || null : tB || null;
      loserTransaction = primaryRunId === runAId ? tB || null : tA || null;
      reason = "no_winner";
      transactionsNoWinner++;
    }

    if (winnerTransaction) {
      // Create a merged transaction: winner fields take precedence, loser fills gaps
      const newTransactionId = randomUUID();

      // For each field: use winner's value if present, otherwise use loser's
      const w = winnerTransaction;
      const l = loserTransaction;

      const baseTransaction: typeof transactions.$inferInsert = {
        id: newTransactionId,
        type: w.type, // Type always from winner
        accountId: !isEmpty(w.accountId) ? w.accountId : l?.accountId || null,
        toAccountId: !isEmpty(w.toAccountId) ? w.toAccountId : l?.toAccountId || null,
        date: w.date, // Date always from winner
        amount: !isEmpty(w.amount) ? w.amount : l?.amount || null,
        currency: !isEmpty(w.currency) ? w.currency : l?.currency || null,
        description: !isEmpty(w.description) ? w.description : l?.description || null,
        symbol: !isEmpty(w.symbol) ? w.symbol : l?.symbol || null,
        category: !isEmpty(w.category) ? w.category : l?.category || null,
        quantity: !isEmpty(w.quantity) ? w.quantity : l?.quantity || null,
        quantityExecuted: !isEmpty(w.quantityExecuted) ? w.quantityExecuted : l?.quantityExecuted || null,
        quantityRemaining: !isEmpty(w.quantityRemaining) ? w.quantityRemaining : l?.quantityRemaining || null,
        price: !isEmpty(w.price) ? w.price : l?.price || null,
        executionPrice: !isEmpty(w.executionPrice) ? w.executionPrice : l?.executionPrice || null,
        priceType: !isEmpty(w.priceType) ? w.priceType : l?.priceType || null,
        limitPrice: !isEmpty(w.limitPrice) ? w.limitPrice : l?.limitPrice || null,
        fees: !isEmpty(w.fees) ? w.fees : l?.fees || null,
        contractSize: !isEmpty(w.contractSize) ? w.contractSize : l?.contractSize || null,
        optionType: !isEmpty(w.optionType) ? w.optionType : l?.optionType || null,
        strikePrice: !isEmpty(w.strikePrice) ? w.strikePrice : l?.strikePrice || null,
        expirationDate: !isEmpty(w.expirationDate) ? w.expirationDate : l?.expirationDate || null,
        optionAction: !isEmpty(w.optionAction) ? w.optionAction : l?.optionAction || null,
        securityName: !isEmpty(w.securityName) ? w.securityName : l?.securityName || null,
        grantNumber: !isEmpty(w.grantNumber) ? w.grantNumber : l?.grantNumber || null,
        vestDate: !isEmpty(w.vestDate) ? w.vestDate : l?.vestDate || null,
        orderId: !isEmpty(w.orderId) ? w.orderId : l?.orderId || null,
        orderType: !isEmpty(w.orderType) ? w.orderType : l?.orderType || null,
        orderQuantity: !isEmpty(w.orderQuantity) ? w.orderQuantity : l?.orderQuantity || null,
        orderPrice: !isEmpty(w.orderPrice) ? w.orderPrice : l?.orderPrice || null,
        orderStatus: !isEmpty(w.orderStatus) ? w.orderStatus : l?.orderStatus || null,
        timeInForce: !isEmpty(w.timeInForce) ? w.timeInForce : l?.timeInForce || null,
        referenceNumber: !isEmpty(w.referenceNumber) ? w.referenceNumber : l?.referenceNumber || null,
        partiallyExecuted: w.partiallyExecuted !== null ? w.partiallyExecuted : l?.partiallyExecuted || null,
        executionTime: !isEmpty(w.executionTime) ? w.executionTime : l?.executionTime || null,
        // Merge data objects: winner's keys take precedence, loser's unique keys are added
        data: mergeData(
          w.data as Record<string, unknown> | null,
          l?.data as Record<string, unknown> | null
        ),
        unclassifiedData: mergeData(
          w.unclassifiedData as Record<string, unknown> | null,
          l?.unclassifiedData as Record<string, unknown> | null
        ),
        sourceEmailId: w.sourceEmailId,
        extractionRunId: synthesizedRunId,
        runCompleted: true,
        confidence: w.confidence, // Confidence from winner
        llmModel: w.llmModel, // Model from winner
        sourceTransactionId: w.id, // Track provenance (winner's ID)
      };

      // Apply any user field overrides (these take highest precedence)
      const finalTransaction = applyFieldOverrides(baseTransaction, overrides || null);
      transactionsToCreate.push(finalTransaction);
    }
  }

  // Insert the synthesized run
  await db.insert(extractionRuns).values({
    id: synthesizedRunId,
    setId,
    version: nextVersion,
    name: synthesizedRunName,
    description: description || `Synthesized from runs v${runA[0].version} and v${runB[0].version}. Primary fallback: v${primaryRun.version}`,
    modelId: primaryRun.modelId, // Use primary run's model
    promptId: primaryRun.promptId, // Use primary run's prompt
    softwareVersion: primaryRun.softwareVersion,
    emailsProcessed: allEmailIds.size,
    transactionsCreated: transactionsToCreate.length,
    informationalCount: 0,
    errorCount: 0,
    config: {
      sourceRunA: runAId,
      sourceRunB: runBId,
      primaryRunId,
      synthesisStats: {
        fromA: transactionsFromA,
        fromB: transactionsFromB,
        ties: transactionsTied,
        noWinner: transactionsNoWinner,
      },
    },
    stats: {
      byType: {},
      avgConfidence: 0,
      processingTimeMs: 0,
    },
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    isSynthesized: true,
    synthesisType: "comparison_winners",
    sourceRunIds: [runAId, runBId],
    // primaryRunId is stored in config, not as a separate column
  });

  // Insert all transactions in batches
  const BATCH_SIZE = 100;
  for (let i = 0; i < transactionsToCreate.length; i += BATCH_SIZE) {
    const batch = transactionsToCreate.slice(i, i + BATCH_SIZE);
    await db.insert(transactions).values(batch);
  }

  // Calculate stats by type
  const byType: Record<string, number> = {};
  for (const t of transactionsToCreate) {
    byType[t.type] = (byType[t.type] || 0) + 1;
  }

  // Update run with stats
  await db
    .update(extractionRuns)
    .set({
      stats: {
        byType,
        avgConfidence: 0, // Could calculate this
        processingTimeMs: 0,
      },
    })
    .where(eq(extractionRuns.id, synthesizedRunId));

  return NextResponse.json({
    message: "Synthesized run created",
    run: {
      id: synthesizedRunId,
      name: synthesizedRunName,
      version: nextVersion,
      transactionsCreated: transactionsToCreate.length,
      stats: {
        fromRunA: transactionsFromA,
        fromRunB: transactionsFromB,
        ties: transactionsTied,
        noWinner: transactionsNoWinner,
      },
    },
  });
}

interface DataFlattenParams {
  sourceRunId: string;
  name?: string;
  description?: string;
  preview?: boolean;
  selectedKeys?: string[];
}

// Convert camelCase or any string to snake_case for PostgreSQL column names
function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 63); // PostgreSQL column name limit
}

async function handleDataFlatten(params: DataFlattenParams) {
  const { sourceRunId, name, description, preview = false, selectedKeys } = params;

  if (!sourceRunId) {
    return NextResponse.json(
      { error: "sourceRunId is required for data_flatten synthesis" },
      { status: 400 }
    );
  }

  // Get source run
  const [sourceRun] = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.id, sourceRunId))
    .limit(1);

  if (!sourceRun) {
    return NextResponse.json(
      { error: "Source run not found" },
      { status: 404 }
    );
  }

  // Get all transactions from source run
  const sourceTransactions = await db
    .select()
    .from(transactions)
    .where(eq(transactions.extractionRunId, sourceRunId));

  // Helper to flatten data - extracts {key, value} objects from numeric indices
  const flattenData = (data: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (/^\d+$/.test(k) && v && typeof v === "object" && "key" in v && "value" in v) {
        const obj = v as { key: string; value: unknown };
        result[obj.key] = obj.value;
      } else if (/^\d+$/.test(k) && v && typeof v === "object") {
        continue;
      } else {
        result[k] = v;
      }
    }
    return result;
  };

  // Step 1: Discover all unique keys in data fields
  const allKeys = new Set<string>();
  const flattenedDataByTxn = new Map<string, Record<string, unknown>>();

  for (const t of sourceTransactions) {
    const flattenedData = t.data ? flattenData(t.data as Record<string, unknown>) : {};
    flattenedDataByTxn.set(t.id, flattenedData);
    for (const key of Object.keys(flattenedData)) {
      allKeys.add(key);
    }
  }

  if (allKeys.size === 0) {
    return NextResponse.json(
      { error: "No data fields found to flatten" },
      { status: 400 }
    );
  }

  // Filter to only selected keys if specified (non-preview mode)
  let keysToFlatten = allKeys;
  if (selectedKeys && selectedKeys.length > 0 && !preview) {
    keysToFlatten = new Set(selectedKeys.filter((k) => allKeys.has(k)));
    if (keysToFlatten.size === 0) {
      return NextResponse.json(
        { error: "None of the selected keys were found in the data" },
        { status: 400 }
      );
    }
  }

  // Step 2: Get existing columns in transactions table
  const existingColumnsResult = await queryClient<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions'
  `;
  const existingColumns = new Set(existingColumnsResult.map((r) => r.column_name));

  // Step 3: Build mapping from keys to columns, grouping keys that map to same column
  // For preview, use all keys. For actual flatten, use filtered keys.
  const keysForMapping = preview ? allKeys : keysToFlatten;
  const keyToColumn = new Map<string, string>();
  const columnToKeys = new Map<string, string[]>(); // Group original keys by column name

  for (const key of keysForMapping) {
    const columnName = toSnakeCase(key);
    keyToColumn.set(key, columnName);

    if (!columnToKeys.has(columnName)) {
      columnToKeys.set(columnName, []);
    }
    columnToKeys.get(columnName)!.push(key);
  }

  // Determine which columns need to be created (deduplicated)
  const columnsToCreate = new Set<string>();
  for (const columnName of columnToKeys.keys()) {
    if (!existingColumns.has(columnName)) {
      columnsToCreate.add(columnName);
    }
  }

  // If preview mode, return what would happen without making changes
  if (preview) {
    // Count how many transactions have each key
    const keyOccurrences: Record<string, number> = {};
    for (const key of allKeys) {
      keyOccurrences[key] = 0;
    }
    for (const [, flatData] of flattenedDataByTxn) {
      for (const key of Object.keys(flatData)) {
        if (keyOccurrences[key] !== undefined) {
          keyOccurrences[key]++;
        }
      }
    }

    // Build column arrays, aggregating occurrences for keys that map to same column
    const newColumnsArray = Array.from(columnsToCreate).map((col) => {
      const originalKeys = columnToKeys.get(col) || [];
      // Sum occurrences across all keys that map to this column
      const totalOccurrences = originalKeys.reduce((sum, key) => sum + (keyOccurrences[key] || 0), 0);
      return {
        columnName: col,
        originalKey: col, // Use column name as the key for selection
        originalKeys, // Include all original keys for reference
        occurrences: totalOccurrences,
      };
    }).sort((a, b) => b.occurrences - a.occurrences);

    // For existing columns, also deduplicate by column name
    const existingColumnNames = new Set<string>();
    for (const key of allKeys) {
      const colName = toSnakeCase(key);
      if (existingColumns.has(colName)) {
        existingColumnNames.add(colName);
      }
    }

    const existingColumnsArray = Array.from(existingColumnNames).map((col) => {
      const originalKeys = columnToKeys.get(col) || [];
      const totalOccurrences = originalKeys.reduce((sum, key) => sum + (keyOccurrences[key] || 0), 0);
      return {
        columnName: col,
        originalKey: col,
        originalKeys,
        occurrences: totalOccurrences,
      };
    }).sort((a, b) => b.occurrences - a.occurrences);

    return NextResponse.json({
      preview: true,
      sourceRun: {
        id: sourceRun.id,
        version: sourceRun.version,
        name: sourceRun.name,
        transactionCount: sourceTransactions.length,
      },
      changes: {
        newColumns: newColumnsArray,
        existingColumns: existingColumnsArray,
        totalKeys: columnToKeys.size, // Unique columns, not raw keys
        totalTransactions: sourceTransactions.length,
      },
    });
  }

  // Step 4: Create new columns (all as TEXT for flexibility)
  for (const columnName of columnsToCreate) {
    // Use raw query for DDL - column names are sanitized by toSnakeCase
    await queryClient.unsafe(
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "${columnName}" TEXT`
    );
  }

  // Step 5: Get next version number and create synthesized run
  const maxVersionResult = await db
    .select({ maxVersion: max(extractionRuns.version) })
    .from(extractionRuns)
    .where(eq(extractionRuns.setId, sourceRun.setId));
  const nextVersion = (maxVersionResult[0]?.maxVersion || 0) + 1;

  const synthesizedRunId = randomUUID();
  const synthesizedRunName = name || `Flattened v${nextVersion} (from v${sourceRun.version})`;

  await db.insert(extractionRuns).values({
    id: synthesizedRunId,
    setId: sourceRun.setId,
    version: nextVersion,
    name: synthesizedRunName,
    description: description || `Data flattened from run v${sourceRun.version}. Flattened ${keysToFlatten.size} keys${columnsToCreate.size > 0 ? `, created ${columnsToCreate.size} new columns: ${Array.from(columnsToCreate).join(", ")}` : ""}`,
    modelId: sourceRun.modelId,
    promptId: sourceRun.promptId,
    softwareVersion: sourceRun.softwareVersion,
    emailsProcessed: sourceRun.emailsProcessed,
    transactionsCreated: sourceTransactions.length,
    informationalCount: 0,
    errorCount: 0,
    config: {
      flattenedKeys: Array.from(keysToFlatten),
      columnsCreated: Array.from(columnsToCreate),
      keyToColumnMapping: Object.fromEntries(keyToColumn),
    },
    status: "completed",
    startedAt: new Date(),
    completedAt: new Date(),
    isSynthesized: true,
    synthesisType: "data_flatten",
    sourceRunIds: [sourceRunId],
  });

  // Step 6: Insert transactions with flattened data in proper columns using raw SQL
  // Build column list for INSERT
  const baseColumns = [
    "id", "type", "account_id", "to_account_id", "date", "amount", "currency",
    "description", "symbol", "category", "quantity", "quantity_executed",
    "quantity_remaining", "price", "execution_price", "price_type", "limit_price",
    "fees", "contract_size", "option_type", "strike_price", "expiration_date",
    "option_action", "security_name", "grant_number", "vest_date", "order_id",
    "order_type", "order_quantity", "order_price", "order_status", "time_in_force",
    "reference_number", "partially_executed", "execution_time", "data",
    "unclassified_data", "source_email_id", "extraction_run_id", "run_completed",
    "confidence", "llm_model", "source_transaction_id", "created_at"
  ];

  // Add dynamic columns (deduplicated - multiple keys may map to same column)
  const dynamicColumns = Array.from(new Set(keyToColumn.values()));
  const allColumns = [...baseColumns, ...dynamicColumns];

  // Insert transactions in batches
  const BATCH_SIZE = 50;
  for (let i = 0; i < sourceTransactions.length; i += BATCH_SIZE) {
    const batch = sourceTransactions.slice(i, i + BATCH_SIZE);

    const values = batch.map((t) => {
      const flatData = flattenedDataByTxn.get(t.id) || {};
      const newId = randomUUID();

      // Base values
      const baseValues: (string | number | boolean | null | Date | Record<string, unknown>)[] = [
        newId,
        t.type,
        t.accountId,
        t.toAccountId,
        t.date,
        t.amount,
        t.currency,
        t.description,
        t.symbol,
        t.category,
        t.quantity,
        t.quantityExecuted,
        t.quantityRemaining,
        t.price,
        t.executionPrice,
        t.priceType,
        t.limitPrice,
        t.fees,
        t.contractSize,
        t.optionType,
        t.strikePrice,
        t.expirationDate,
        t.optionAction,
        t.securityName,
        t.grantNumber,
        t.vestDate,
        t.orderId,
        t.orderType,
        t.orderQuantity,
        t.orderPrice,
        t.orderStatus,
        t.timeInForce,
        t.referenceNumber,
        t.partiallyExecuted,
        t.executionTime,
        {}, // data - empty since we're flattening to columns
        t.unclassifiedData,
        t.sourceEmailId,
        synthesizedRunId,
        true, // run_completed
        t.confidence,
        t.llmModel,
        t.id, // source_transaction_id
        new Date(),
      ];

      // Add dynamic column values (one per unique column)
      for (const colName of dynamicColumns) {
        // Find value from any key that maps to this column
        const keysForCol = columnToKeys.get(colName) || [];
        let value: unknown = undefined;
        for (const key of keysForCol) {
          if (flatData[key] !== undefined) {
            value = flatData[key];
            break;
          }
        }
        baseValues.push(value !== undefined ? String(value) : null);
      }

      return baseValues;
    });

    // Use postgres.js insert syntax for better handling
    const columnList = allColumns.map(c => `"${c}"`).join(", ");

    // Insert each row individually to handle complex value types
    for (const rowValues of values) {
      const placeholders = rowValues.map((_, i) => `$${i + 1}`).join(", ");
      const query = `INSERT INTO transactions (${columnList}) VALUES (${placeholders})`;

      // Convert values to appropriate types for postgres
      const pgValues = rowValues.map(v => {
        if (v === null || v === undefined) return null;
        if (v instanceof Date) return v.toISOString();
        if (typeof v === "object") return JSON.stringify(v);
        return v;
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await queryClient.unsafe(query, pgValues as any);
    }
  }

  return NextResponse.json({
    message: "Flattened run created with new columns",
    run: {
      id: synthesizedRunId,
      name: synthesizedRunName,
      version: nextVersion,
      transactionsCreated: sourceTransactions.length,
      columnsCreated: Array.from(columnsToCreate),
      totalFlattenedKeys: keysToFlatten.size,
    },
  });
}

interface DataFlattenAllParams {
  setId?: string;
  preview?: boolean;
  selectedKeys?: string[];
}

async function handleDataFlattenAll(params: DataFlattenAllParams) {
  const { setId, preview = false, selectedKeys } = params;

  // Get all non-synthesized, completed runs (optionally filtered by setId)
  const runsQuery = db
    .select()
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.status, "completed"),
        eq(extractionRuns.isSynthesized, false),
        setId ? eq(extractionRuns.setId, setId) : undefined
      )
    );

  const allRuns = await runsQuery;

  if (allRuns.length === 0) {
    return NextResponse.json(
      { error: "No runs found to flatten" },
      { status: 404 }
    );
  }

  // Helper to flatten data - extracts {key, value} objects from numeric indices
  const flattenData = (data: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (/^\d+$/.test(k) && v && typeof v === "object" && "key" in v && "value" in v) {
        const obj = v as { key: string; value: unknown };
        result[obj.key] = obj.value;
      } else if (/^\d+$/.test(k) && v && typeof v === "object") {
        continue;
      } else {
        result[k] = v;
      }
    }
    return result;
  };

  // Step 1: Scan ALL transactions from ALL runs to discover all unique keys
  const allKeys = new Set<string>();
  const keyOccurrences: Record<string, number> = {};

  for (const run of allRuns) {
    const runTransactions = await db
      .select({ data: transactions.data })
      .from(transactions)
      .where(eq(transactions.extractionRunId, run.id));

    for (const t of runTransactions) {
      const flattenedData = t.data ? flattenData(t.data as Record<string, unknown>) : {};
      for (const key of Object.keys(flattenedData)) {
        allKeys.add(key);
        keyOccurrences[key] = (keyOccurrences[key] || 0) + 1;
      }
    }
  }

  if (allKeys.size === 0) {
    return NextResponse.json(
      { error: "No data fields found to flatten across all runs" },
      { status: 400 }
    );
  }

  // Step 2: Get existing columns in transactions table
  const existingColumnsResult = await queryClient<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'transactions'
  `;
  const existingColumns = new Set(existingColumnsResult.map((r) => r.column_name));

  // Step 3: Build mapping from keys to columns, grouping keys that map to same column
  const columnToKeys = new Map<string, string[]>();

  for (const key of allKeys) {
    const columnName = toSnakeCase(key);
    if (!columnToKeys.has(columnName)) {
      columnToKeys.set(columnName, []);
    }
    columnToKeys.get(columnName)!.push(key);
  }

  // Determine which columns need to be created (deduplicated)
  const columnsToCreate = new Set<string>();
  for (const columnName of columnToKeys.keys()) {
    if (!existingColumns.has(columnName)) {
      columnsToCreate.add(columnName);
    }
  }

  // If preview mode, return what would happen without making changes
  if (preview) {
    // Build column arrays, aggregating occurrences for keys that map to same column
    const newColumnsArray = Array.from(columnsToCreate).map((col) => {
      const originalKeys = columnToKeys.get(col) || [];
      const totalOccurrences = originalKeys.reduce((sum, key) => sum + (keyOccurrences[key] || 0), 0);
      return {
        columnName: col,
        originalKey: col,
        originalKeys,
        occurrences: totalOccurrences,
      };
    }).sort((a, b) => b.occurrences - a.occurrences);

    const existingColumnNames = new Set<string>();
    for (const key of allKeys) {
      const colName = toSnakeCase(key);
      if (existingColumns.has(colName)) {
        existingColumnNames.add(colName);
      }
    }

    const existingColumnsArray = Array.from(existingColumnNames).map((col) => {
      const originalKeys = columnToKeys.get(col) || [];
      const totalOccurrences = originalKeys.reduce((sum, key) => sum + (keyOccurrences[key] || 0), 0);
      return {
        columnName: col,
        originalKey: col,
        originalKeys,
        occurrences: totalOccurrences,
      };
    }).sort((a, b) => b.occurrences - a.occurrences);

    return NextResponse.json({
      preview: true,
      runs: allRuns.map((r) => ({
        id: r.id,
        version: r.version,
        name: r.name,
        transactionCount: r.transactionsCreated,
      })),
      changes: {
        newColumns: newColumnsArray,
        existingColumns: existingColumnsArray,
        totalKeys: columnToKeys.size,
        totalRuns: allRuns.length,
      },
    });
  }

  // Filter to only selected keys if specified
  let keysToFlatten = allKeys;
  if (selectedKeys && selectedKeys.length > 0) {
    keysToFlatten = new Set(selectedKeys.filter((k) => allKeys.has(k)));
    if (keysToFlatten.size === 0) {
      return NextResponse.json(
        { error: "None of the selected keys were found in the data" },
        { status: 400 }
      );
    }
  }

  // Rebuild column mapping for selected keys only
  const keyToColumn = new Map<string, string>();
  const finalColumnToKeys = new Map<string, string[]>();

  for (const key of keysToFlatten) {
    const columnName = toSnakeCase(key);
    keyToColumn.set(key, columnName);
    if (!finalColumnToKeys.has(columnName)) {
      finalColumnToKeys.set(columnName, []);
    }
    finalColumnToKeys.get(columnName)!.push(key);
  }

  // Recalculate columns to create based on selected keys
  const finalColumnsToCreate = new Set<string>();
  for (const columnName of finalColumnToKeys.keys()) {
    if (!existingColumns.has(columnName)) {
      finalColumnsToCreate.add(columnName);
    }
  }

  // Step 4: Create new columns (all as TEXT for flexibility)
  for (const columnName of finalColumnsToCreate) {
    await queryClient.unsafe(
      `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS "${columnName}" TEXT`
    );
  }

  // Step 5: For each run, create a flattened synthesized version
  const createdRuns: Array<{
    sourceRunId: string;
    sourceVersion: number;
    newRunId: string;
    newVersion: number;
    transactionsCreated: number;
  }> = [];

  // Get max version across all sets to avoid conflicts
  const maxVersionResult = await db
    .select({ maxVersion: max(extractionRuns.version) })
    .from(extractionRuns);
  let nextVersion = (maxVersionResult[0]?.maxVersion || 0) + 1;

  // Base columns for INSERT
  const baseColumns = [
    "id", "type", "account_id", "to_account_id", "date", "amount", "currency",
    "description", "symbol", "category", "quantity", "quantity_executed",
    "quantity_remaining", "price", "execution_price", "price_type", "limit_price",
    "fees", "contract_size", "option_type", "strike_price", "expiration_date",
    "option_action", "security_name", "grant_number", "vest_date", "order_id",
    "order_type", "order_quantity", "order_price", "order_status", "time_in_force",
    "reference_number", "partially_executed", "execution_time", "data",
    "unclassified_data", "source_email_id", "extraction_run_id", "run_completed",
    "confidence", "llm_model", "source_transaction_id", "created_at"
  ];

  const dynamicColumns = Array.from(new Set(keyToColumn.values()));
  const allColumns = [...baseColumns, ...dynamicColumns];
  const columnList = allColumns.map(c => `"${c}"`).join(", ");

  for (const sourceRun of allRuns) {
    const synthesizedRunId = randomUUID();
    const synthesizedRunName = `Flattened v${nextVersion} (from v${sourceRun.version})`;

    // Get all transactions for this run with their data
    const sourceTransactions = await db
      .select()
      .from(transactions)
      .where(eq(transactions.extractionRunId, sourceRun.id));

    // Create the synthesized run record
    await db.insert(extractionRuns).values({
      id: synthesizedRunId,
      setId: sourceRun.setId,
      version: nextVersion,
      name: synthesizedRunName,
      description: `Data flattened from run v${sourceRun.version}. Flattened ${keysToFlatten.size} keys${finalColumnsToCreate.size > 0 ? `, created ${finalColumnsToCreate.size} new columns` : ""}`,
      modelId: sourceRun.modelId,
      promptId: sourceRun.promptId,
      softwareVersion: sourceRun.softwareVersion,
      emailsProcessed: sourceRun.emailsProcessed,
      transactionsCreated: sourceTransactions.length,
      informationalCount: 0,
      errorCount: 0,
      config: {
        flattenedKeys: Array.from(keysToFlatten),
        columnsCreated: Array.from(finalColumnsToCreate),
        sourceRunVersion: sourceRun.version,
      },
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      isSynthesized: true,
      synthesisType: "data_flatten",
      sourceRunIds: [sourceRun.id],
    });

    // Insert transactions with flattened data
    const BATCH_SIZE = 50;
    for (let i = 0; i < sourceTransactions.length; i += BATCH_SIZE) {
      const batch = sourceTransactions.slice(i, i + BATCH_SIZE);

      for (const t of batch) {
        const flatData = t.data ? flattenData(t.data as Record<string, unknown>) : {};
        const newId = randomUUID();

        const baseValues: (string | number | boolean | null | Date | Record<string, unknown>)[] = [
          newId,
          t.type,
          t.accountId,
          t.toAccountId,
          t.date,
          t.amount,
          t.currency,
          t.description,
          t.symbol,
          t.category,
          t.quantity,
          t.quantityExecuted,
          t.quantityRemaining,
          t.price,
          t.executionPrice,
          t.priceType,
          t.limitPrice,
          t.fees,
          t.contractSize,
          t.optionType,
          t.strikePrice,
          t.expirationDate,
          t.optionAction,
          t.securityName,
          t.grantNumber,
          t.vestDate,
          t.orderId,
          t.orderType,
          t.orderQuantity,
          t.orderPrice,
          t.orderStatus,
          t.timeInForce,
          t.referenceNumber,
          t.partiallyExecuted,
          t.executionTime,
          {},
          t.unclassifiedData,
          t.sourceEmailId,
          synthesizedRunId,
          true,
          t.confidence,
          t.llmModel,
          t.id,
          new Date(),
        ];

        // Add dynamic column values
        for (const colName of dynamicColumns) {
          const keysForCol = finalColumnToKeys.get(colName) || [];
          let value: unknown = undefined;
          for (const key of keysForCol) {
            if (flatData[key] !== undefined) {
              value = flatData[key];
              break;
            }
          }
          baseValues.push(value !== undefined ? String(value) : null);
        }

        const placeholders = baseValues.map((_, i) => `$${i + 1}`).join(", ");
        const query = `INSERT INTO transactions (${columnList}) VALUES (${placeholders})`;

        const pgValues = baseValues.map(v => {
          if (v === null || v === undefined) return null;
          if (v instanceof Date) return v.toISOString();
          if (typeof v === "object") return JSON.stringify(v);
          return v;
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await queryClient.unsafe(query, pgValues as any);
      }
    }

    createdRuns.push({
      sourceRunId: sourceRun.id,
      sourceVersion: sourceRun.version,
      newRunId: synthesizedRunId,
      newVersion: nextVersion,
      transactionsCreated: sourceTransactions.length,
    });

    nextVersion++;
  }

  return NextResponse.json({
    message: `Created ${createdRuns.length} flattened runs`,
    columnsCreated: Array.from(finalColumnsToCreate),
    totalFlattenedKeys: keysToFlatten.size,
    runs: createdRuns,
  });
}
