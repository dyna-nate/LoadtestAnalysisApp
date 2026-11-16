// Workflow JS action: select_unrecorded_tests
// Input : records from execute_dql-find_finished_tests (tests whose last span is older than the quiet period)
// Output: { tests: [...] } = finished tests that do NOT yet have a loadtest.summary bizevent.
// The summary bizevent is written LAST for each test, so "no summary" == "not (fully) processed yet".
import { execution } from '@dynatrace-sdk/automation-utils';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const PREVIOUS_STEP = 'execute_dql-find_finished_tests';
const PAD_MS = 5 * 60 * 1000;   // widen each test's query window by 5 min on both sides
const MAX_TESTS = 50;           // bound the run; remaining tests are picked up on the next run

// DQL returns nanosecond precision; trim to milliseconds so Date can parse it everywhere.
const toMs = (s) => new Date(String(s).replace(/(\.\d{3})\d+Z$/, '$1Z')).getTime();

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

export default async function ({ executionId }) {
  const ex = await execution(executionId);
  const records = (await ex.result(PREVIOUS_STEP))?.records ?? [];
  console.log(`${records.length} finished test execution(s) found in the lookback window`);
  if (records.length === 0) return { tests: [] };

  const candidates = records.map((r) => ({ ...r, te_uuid: String(r.test_execution).slice(-36) }));
  // If the existence check fails we must NOT proceed (would re-ingest everything) - let the step fail and retry next run.
  const done = await existingSummaries([...new Set(candidates.map((c) => c.te_uuid))]);

  const pending = candidates
    .filter((c) => !done.has(c.te_uuid))
    .sort((a, b) => toMs(a.test_start) - toMs(b.test_start));
  console.log(`${pending.length} not yet recorded (${done.size} already have a summary)`);
  if (pending.length > MAX_TESTS) console.log(`Processing the oldest ${MAX_TESTS}; ${pending.length - MAX_TESTS} deferred to next run`);

  const tests = pending.slice(0, MAX_TESTS).map((c) => ({
    test_execution: c.test_execution,
    te_uuid: c.te_uuid,
    source_id: c.source_id,
    test_start: c.test_start,
    test_end: c.test_end,
    window_start: new Date(toMs(c.test_start) - PAD_MS).toISOString(),
    window_end: new Date(toMs(c.test_end) + PAD_MS).toISOString(),
  }));
  tests.forEach((t) => console.log(`${t.test_execution}  ${t.test_start} -> ${t.test_end}`));
  return { tests };
}
