import { execution } from '@dynatrace-sdk/automation-utils';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const DEDUP_KEY = 'row_key';
const PREVIOUS_STEP = 'return_loadtest_summarized_execution-details_byattributes';

async function mergeLookup(newRecords, lookupPath, dedupKey) {
  let existingRecords = [];
  try {
    const queryResult = await queryExecutionClient.queryExecute({
      body: {
        query: `load "${lookupPath}"`,
        requestTimeoutMilliseconds: 30000,
      },
    });
    existingRecords = queryResult.result?.records ?? [];
    console.log(`[${lookupPath}] Read ${existingRecords.length} existing records`);
  } catch (e) {
    console.warn(`[${lookupPath}] Could not load existing lookup table (may not exist yet):`, e.message);
  }

  const existingKeys = new Set(existingRecords.map((r) => r[dedupKey]));
  const trulyNewRecords = newRecords.filter((r) => !existingKeys.has(r[dedupKey]));
  const mergedRecords = [...existingRecords, ...trulyNewRecords];

  console.log(
    `[${lookupPath}] Existing: ${existingRecords.length} | New: ${newRecords.length} | Skipped: ${newRecords.length - trulyNewRecords.length} | Total: ${mergedRecords.length}`
  );

  if (trulyNewRecords.length === 0) {
    console.log(`[${lookupPath}] No new records — lookup table unchanged`);
    return { status: 'no_change', total: mergedRecords.length };
  }

  const jsonContent = JSON.stringify(mergedRecords);
  const boundary = '----DynatraceFormBoundary' + Date.now().toString(16);
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="request"',
    'Content-Type: application/json',
    '',
    JSON.stringify({
      filePath: lookupPath,
      parsePattern: 'JSON:data',
      lookupField: dedupKey,
      overwrite: true,
      autoFlatten: true,
    }),
    `--${boundary}`,
    'Content-Disposition: form-data; name="content"; filename="data.json"',
    'Content-Type: application/json',
    '',
    jsonContent,
    `--${boundary}--`,
  ].join('\r\n');

  const uploadResponse = await fetch(
    '/platform/storage/resource-store/v1/files/tabular/lookup:upload',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    }
  );

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`[${lookupPath}] Upload failed [${uploadResponse.status}]: ${errorText}`);
  }

  console.log(`[${lookupPath}] Upload complete — ${mergedRecords.length} total records`);
  return { status: 'success', added: trulyNewRecords.length, total: mergedRecords.length };
}

export default async function ({ executionId }) {
  const ex = await execution(executionId);
  const records = (await ex.result(PREVIOUS_STEP)).records;

  // Add composite dedup key
  const allRecords = records.map((r) => ({
    ...r,
    row_key: `${r.test_execution}::${r.na_keptn}`,
  }));

  console.log(`Received ${allRecords.length} request duration rows from DQL`);

  // Group records by test_execution
  const byTestExecution = {};
  for (const r of allRecords) {
    if (!byTestExecution[r.test_execution]) {
      byTestExecution[r.test_execution] = [];
    }
    byTestExecution[r.test_execution].push(r);
  }

  const testExecutions = Object.keys(byTestExecution);
  console.log(`Found ${testExecutions.length} unique test execution(s)`);

  // Write each test execution to its own lookup table
  const results = [];
  for (const testExecution of testExecutions) {
    const lookupPath = `/lookups/perftest/neoload/${testExecution}/testsummary_responsetime_detailed`;
    const testRecords = byTestExecution[testExecution];
    console.log(`[${testExecution}] Writing ${testRecords.length} records to ${lookupPath}`);
    const result = await mergeLookup(testRecords, lookupPath, DEDUP_KEY);
    results.push({ testExecution, lookupPath, ...result });
  }

  return { processed: testExecutions.length, results };
}
