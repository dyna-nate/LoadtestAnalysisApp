import { DEFAULT_THRESHOLDS } from "../../utils/thresholds";
import type { ReportConfig, ReportInputs, ResourceSnapshot, TxnAgg } from "../reportTypes";

export const CONFIG: ReportConfig = {
  thresholds: structuredClone(DEFAULT_THRESHOLDS),
  gcWarnPct: 5,
  gcFailPct: 10,
  warnFraction: 0.5,
  durationMismatchPct: 20,
  perfMetric: "p95",
};

export const txn = (name: string, p95: number, count = 1000, failCount = 0): TxnAgg => ({
  name, count, failCount, avg: p95 / 2, p50: p95 / 3, p90: p95 * 0.9, p95, p99: p95 * 1.2,
});

export const snap = (over: Partial<ResourceSnapshot> = {}): ResourceSnapshot => ({
  cpuPct: 40, memMiB: 500, cpuRequestM: 500, cpuLimitM: 1000, memRequestMiB: 512, memLimitMiB: 1024, gcPct: 2, ...over,
});

const HOUR = 3600_000;

export function baseInputs(over: Partial<ReportInputs> = {}): ReportInputs {
  return {
    meta: {
      application: "Fusion", environment: "UAT", release: "2.5.0", baselineRelease: "2.4.0",
      generatedAt: "2026-11-11T16:00:00.000Z",
    },
    current: { te_uuid: "cur-aaaaaaaa", test_execution: "Fusion-PaceBenchmark-cur", test_start: "2026-11-05T06:00:00Z", test_end: "2026-11-05T07:00:00Z", durationMs: HOUR },
    baseline: { te_uuid: "bas-bbbbbbbb", test_execution: "Fusion-PaceBenchmark-bas", test_start: "2026-09-09T19:00:00Z", test_end: "2026-09-09T20:00:00Z", durationMs: HOUR },
    baselineTxns: [txn("Login", 200), txn("Search", 400)],
    currentTxns: [txn("Login", 205), txn("Search", 410)],
    resources: [{ key: "ach-api", name: "ach-api", techType: "SPRINGBOOT", baseline: snap(), current: snap() }],
    serviceRequests: { baseline: 3_600_000, current: 3_600_000 },
    config: CONFIG,
    ...over,
  };
}
