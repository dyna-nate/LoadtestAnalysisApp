// ONE-OFF Workflow JS action (run manually, then delete): copy rows from the legacy lookup
// /lookups/perftest/neoload/testsummarybytime into loadtest.summary bizevents so the app keeps its history.
// event.provider must be exactly 'loadtest-workflow' so the OpenPipeline rule routes events to load_test_bizevents.
// Caveats: lookup rows written by the old workflow may have truncated test_end/duration/counts
// (they were captured mid-test). They are tagged backfilled=true so they can be recognised.
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const BATCH_SIZE = 500;
const MAX_TIME_AGE_MS = 20 * 3600 * 1000;

export default async function () {
  const lk = await queryExecutionClient.queryExecute({
    body: { query: 'load "/lookups/perftest/neoload/testsummarybytime"', requestTimeoutMilliseconds: 60000, maxResultRecords: 100000 },
  });
  const rows = lk.result?.records ?? [];
  console.log(`Lookup rows: ${rows.length}`);

  const ex = await queryExecutionClient.queryExecute({
    body: {
      // Only count summaries already in the routed bucket: an earlier run landed in default_bizevents
      // (35-day retention) because its event.provider did not match the OpenPipeline routing rule.
      query: 'fetch bizevents, from: -365d | filter event.type == "loadtest.summary" | filter dt.system.bucket == "load_test_bizevents" | fields te_uuid | dedup te_uuid',
      requestTimeoutMilliseconds: 60000, maxResultRecords: 100000,
    },
  });
  const have = new Set((ex.result?.records ?? []).map((r) => r.te_uuid));
  const todo = rows.filter((r) => r.te_uuid && !have.has(r.te_uuid));
  console.log(`Already in bizevents: ${have.size}; to backfill: ${todo.length}`);

  const now = Date.now();
  const events = todo.map((r) => {
    const ev = { specversion: '1.0', id: r.te_uuid, source: 'loadtest-workflow', type: 'loadtest.summary', ...r, backfilled: true };
    const endMs = new Date(String(r.test_end).replace(/(\.\d{3})\d+Z$/, '$1Z')).getTime();
    if (!isNaN(endMs) && now - endMs < MAX_TIME_AGE_MS) ev.time = new Date(endMs).toISOString();
    return ev;
  });
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const res = await fetch('/platform/classic/environment-api/v2/bizevents/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/cloudevents-batch+json' },
      body: JSON.stringify(events.slice(i, i + BATCH_SIZE)),
    });
    if (!res.ok) throw new Error(`Ingest failed [${res.status}]: ${await res.text()}`);
  }
  return { backfilled: events.length };
}
