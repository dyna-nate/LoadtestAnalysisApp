// Workflow JS action: write-bizevents_step_execution_details_performance
// Replaces the lookup-table approach for testsummary_responsetime_detailed.
// Reads DQL step results (possibly looped), deduplicates against existing
// bizevents, and ingests new records as business events.

import { execution } from '@dynatrace-sdk/automation-utils';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const PREVIOUS_STEP = 'execute_dql-step_execution_performance';
const EVENT_TYPE    = 'neoload.responsetime.detailed';
const EVENT_SOURCE  = 'neoload-workflow';
const BATCH_SIZE    = 500; // stay well within 5 MB payload limit

// ── Dedup check ───────────────────────────────────────────────────────────────

async function getExistingRowKeys(teUuids) {
  const uuidList = teUuids.map(id => `"${id}"`).join(', ');
  try {
    const result = await queryExecutionClient.queryExecute({
      body: {
        query: `fetch bizevents, from: -365d
          | filter event.type == "${EVENT_TYPE}"
          | filter in(te_uuid, {${uuidList}})
          | fields row_key
          | dedup row_key`,
        requestTimeoutMilliseconds: 30000,
      },
    });
    return new Set((result.result?.records ?? []).map(r => r.row_key));
  } catch (e) {
    console.warn('Could not check existing bizevents (will attempt full ingest):', e.message);
    return new Set();
  }
}

// ── Ingest ────────────────────────────────────────────────────────────────────

async function ingestBatch(events) {
  const response = await fetch(
    '/platform/classic/environment-api/v2/bizevents/ingest',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/cloudevents-batch+json' },
      body: JSON.stringify(events),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ingest failed [${response.status}]: ${errorText}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default async function ({ executionId }) {
  const ex = await execution(executionId);
  const stepResult = await ex.result(PREVIOUS_STEP);

  // When the DQL step runs inside a loop, ex.result() returns an array
  const resultArray = Array.isArray(stepResult) ? stepResult : [stepResult];
  const records = resultArray.flatMap((r) => r?.records ?? []);

  console.log(`Received ${records.length} records across ${resultArray.length} iteration(s)`);

  if (records.length === 0) {
    console.log('No records returned — nothing to ingest');
    return { processed: 0 };
  }

  const allRecords = records.map((r) => ({
    ...r,
    row_key: `${r.te_uuid}::${r.na_keptn}`,
  }));

  const teUuids = [...new Set(allRecords.map(r => r.te_uuid))];
  console.log(`Found ${teUuids.length} unique test execution(s): ${teUuids.join(', ')}`);

  const existingKeys = await getExistingRowKeys(teUuids);
  console.log(`${existingKeys.size} existing event(s) found — skipping duplicates`);

  const newRecords = allRecords.filter(r => !existingKeys.has(r.row_key));
  console.log(`New records to ingest: ${newRecords.length}`);

  if (newRecords.length === 0) {
    console.log('All records already ingested — nothing to do');
    return { processed: 0, skipped: allRecords.length };
  }

  // Build CloudEvents batch — record fields spread as top-level extensions
  const events = newRecords.map((r) => ({
    specversion: '1.0',
    id: r.row_key,
    source: EVENT_SOURCE,
    type: EVENT_TYPE,
    time: r.test_start ?? new Date().toISOString(),
    ...r,
  }));

  let ingested = 0;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await ingestBatch(batch);
    ingested += batch.length;
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ingested ${batch.length} events (${ingested}/${events.length} total)`);
  }

  return { processed: ingested, skipped: allRecords.length - newRecords.length };
}
