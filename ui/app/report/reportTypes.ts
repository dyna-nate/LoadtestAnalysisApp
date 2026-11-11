import type { ThresholdConfig } from "../utils/thresholds";

export type Verdict = "PASS" | "WARNING" | "FAIL" | "N/A";

export type RuleId = "performance" | "cpu" | "memory" | "gc" | "errors" | "throughput";

// ── Inputs (produced by reportData.ts, consumed by reportEngine.ts) ───────────

export interface ReportMeta {
  application: string;
  environment: string;
  release: string;
  baselineRelease: string;
  project?: string;
  scenario?: string;
  generatedAt: string; // ISO timestamp
  generatedBy?: string;
}

export interface ReportTest {
  te_uuid: string;
  test_execution: string;
  test_start: string;
  test_end: string;
  durationMs: number | null;
}

export interface TxnAgg {
  name: string;
  count: number;
  failCount: number;
  avg: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
}

export type PerfMetric = "avg" | "p50" | "p90" | "p95" | "p99";

export interface ResourceSnapshot {
  cpuPct: number | null;
  memMiB: number | null;
  cpuRequestM: number | null; // millicores
  cpuLimitM: number | null;   // millicores
  memRequestMiB: number | null;
  memLimitMiB: number | null;
  gcPct: number | null;       // GC overhead % of runtime; null when no JVM metrics
}

export interface ResourceEntity {
  key: string;
  name: string;
  techType: string;
  baseline: ResourceSnapshot;
  current: ResourceSnapshot;
}

export interface ReportConfig {
  thresholds: ThresholdConfig;
  gcWarnPct: number;
  gcFailPct: number;
  /** Fraction of a relative threshold at which a WARNING is raised (0.5 = half the FAIL threshold). */
  warnFraction: number;
  /** Warn when baseline/current durations differ by more than this percentage. */
  durationMismatchPct: number;
  perfMetric: PerfMetric;
}

export interface ReportInputs {
  meta: ReportMeta;
  current: ReportTest;
  baseline: ReportTest;
  currentTxns: TxnAgg[];
  baselineTxns: TxnAgg[];
  resources: ResourceEntity[];
  /** Sum of dt.service.request.count over the mapped services, per test window (optional). */
  serviceRequests?: { baseline: number | null; current: number | null };
  config: ReportConfig;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export interface PerfRow {
  transaction: string;
  baseline: number | null;
  current: number | null;
  deltaPct: number | null;
  baselineCount: number;
  currentCount: number;
  status: Verdict;
}

export interface ThroughputRow {
  metric: string;
  unit: string;
  baseline: number | null;
  current: number | null;
  deltaPct: number | null;
  status: Verdict;
}

export interface ErrorRow {
  scope: string; // "Overall" or transaction name
  baselineRatePct: number | null;
  currentRatePct: number | null;
  baselineFailed: number;
  currentFailed: number;
  currentTotal: number;
  status: Verdict;
  informational: boolean;
}

export interface ResourceRow {
  entity: string;
  techType: string;
  metric: string; // e.g. "CPU usage", "CPU request", "CPU limit"
  unit: string;
  baseline: number | null;
  current: number | null;
  deltaPct: number | null;
  status: Verdict;
}

export interface GcRow {
  entity: string;
  baselinePct: number | null;
  currentPct: number | null;
  status: Verdict;
}

export interface RuleResult {
  id: RuleId;
  title: string;
  verdict: Verdict;
  summary: string;
}

export interface ReleaseReport {
  schemaVersion: 1;
  id: string;
  meta: ReportMeta;
  current: ReportTest;
  baseline: ReportTest;
  config: ReportConfig; // snapshot of thresholds used — required for audit reproducibility
  overall: Verdict;
  rules: RuleResult[];
  warnings: string[];
  performance: { metric: PerfMetric; rows: PerfRow[] };
  throughput: { rows: ThroughputRow[] };
  errors: { rows: ErrorRow[] };
  cpu: { rows: ResourceRow[] };
  memory: { rows: ResourceRow[] };
  gc: { rows: GcRow[] };
  auditStatement: string;
}
