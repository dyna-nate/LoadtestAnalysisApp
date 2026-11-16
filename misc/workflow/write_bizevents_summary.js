// Workflow JS action: write_bizevents_summary
// Writes ONE loadtest.summary bizevent per finished test. This is the completion marker:
// it runs only after the performance + services details were written for the test.
import { execution } from '@dynatrace-sdk/automation-utils';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const PREVIOUS_STEP = 'execute_dql-test_summary';
const EVENT_TYPE = 'loadtest.summary';
const EVENT_SOURCE = 'loadtest-workflow';
const BATCH_SIZE = 500;
const MAX_TIME_AGE_MS = 20 * 3600 * 1000; // bizevent ingest may reject old timestamps; fall back to ingest time

async function existingSummaries(teUuids) {
  const list = teUuids.map((id) => `"${id}"`).join(', ');
  const result = await queryExecutionClient.queryExecute({
    body: {
      query: `fetch bizevents, from: -365d
        | filter event.type == "loadtest.summary"
        | filter in(te_uuid, {${list}})
        | fields te_uuid
        | dedup te_uuid`,
      requestTimeoutMilliseconds: 30000,
      maxResultRecords: 100000,
    },
  });
  return new Set((result.result?.records ?? []).map((r) => r.te_uuid));
}

async function ingestBatch(events) {
  const response = await fetch('/platform/classic/environment-api/v2/bizevents/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/cloudevents-batch+json' },
    body: JSON.stringify(events),
  });
  if (!response.ok) throw new Error(`Ingest failed [${response.status}]: ${await response.text()}`);
}

export default async function ({ executionId }) {
  const ex = await execution(executionId);
  const stepResult = await ex.result(PREVIOUS_STEP);
  const resultArray = Array.isArray(stepResult) ? stepResult : [stepResult];
  const records = resultArray.flatMap((r) => r?.records ?? []);
  console.log(`Received ${records.length} summary record(s) across ${resultArray.length} iteration(s)`);
  if (records.length === 0) return { processed: 0 };

  const done = await existingSummaries([...new Set(records.map((r) => r.te_uuid))]);
  const fresh = records.filter((r) => !done.has(r.te_uuid));
  console.log(`${fresh.length} new summary event(s) (${records.length - fresh.length} already existed)`);
  if (fresh.length === 0) return { processed: 0, skipped: records.length };

  const now = Date.now();
  const events = fresh.map((r) => {
    const endMs = new Date(String(r.test_end).replace(/(\.\d{3})\d+Z$/, '$1Z')).getTime();
    const ev = { specversion: '1.0', id: r.te_uuid, source: EVENT_SOURCE, type: EVENT_TYPE, ...r };
    if (!isNaN(endMs) && now - endMs < MAX_TIME_AGE_MS) ev.time = new Date(endMs).toISOString();
    return ev;
  });

  let ingested = 0;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await ingestBatch(batch);
    ingested += batch.length;
  }
  return { processed: ingested, skipped: records.length - fresh.length };
}
