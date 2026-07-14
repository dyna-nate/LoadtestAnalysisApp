import { execution } from '@dynatrace-sdk/automation-utils';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const LOOKUP_PATH = '/lookups/perftest/neoload/testsummarybytime';
const DEDUP_KEY = 'test_execution';
const PREVIOUS_STEP = 'return_loadtest_execution-details';

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
  const newRecords = (await ex.result(PREVIOUS_STEP)).records;

  console.log(`Received ${newRecords.length} summarized test execution(s) from DQL`);

  return mergeLookup(newRecords, LOOKUP_PATH, DEDUP_KEY);
}
