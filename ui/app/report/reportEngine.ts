import { isWorse, type MetricThreshold } from "../utils/thresholds";
import { buildAuditStatement } from "./auditStatement";
import type {
  ErrorRow, GcRow, PerfMetric, PerfRow, ReleaseReport, ReportConfig, ReportInputs,
  ResourceEntity, ResourceRow, RuleResult, ThroughputRow, TxnAgg, Verdict,
} from "./reportTypes";

// ── Verdict helpers ───────────────────────────────────────────────────────────

const SEVERITY: Record<Verdict, number> = { "N/A": 0, PASS: 1, WARNING: 2, FAIL: 3 };

export function worstVerdict(verdicts: Verdict[]): Verdict {
  let worst: Verdict = "N/A";
  for (const v of verdicts) if (SEVERITY[v] > SEVERITY[worst]) worst = v;
  return worst;
}

/** Overall verdict: any FAIL → FAIL, else any WARNING → WARNING, else PASS. No evaluable data → WARNING. */
export function overallVerdict(rules: RuleResult[]): Verdict {
  const worst = worstVerdict(rules.map((r) => r.verdict));
  return worst === "N/A" ? "WARNING" : worst;
}

export function deltaPct(current: number | null, baseline: number | null): number | null {
  if (current == null || baseline == null || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

/**
 * FAIL when the configured threshold is breached (reusing isWorse);
 * WARNING when the relative part of the threshold is breached at `warnFraction` of its value.
 */
export function thresholdVerdict(
  current: number | null,
  baseline: number | null,
  betterIsLower: boolean,
  threshold: MetricThreshold,
  warnFraction: number
): Verdict {
  if (current == null) return "N/A";
  if (baseline == null && !threshold.staticEnabled) return "N/A";
  if (isWorse(current, baseline, betterIsLower, threshold)) return "FAIL";
  if (threshold.relEnabled) {
    const warnThreshold: MetricThreshold = { ...threshold, relPct: threshold.relPct * warnFraction };
    if (isWorse(current, baseline, betterIsLower, warnThreshold)) return "WARNING";
  }
  return "PASS";
}

/** Verdict for a configuration value (request/limit) that is expected to stay unchanged between releases. */
export function configChangeVerdict(current: number | null, baseline: number | null, thresholdPct: number): Verdict {
  if (current == null || baseline == null) return "N/A";
  if (current === baseline) return "PASS";
  if (baseline === 0) return "WARNING";
  const pct = Math.abs(((current - baseline) / baseline) * 100);
  return pct > thresholdPct ? "FAIL" : "WARNING";
}

// ── Performance ───────────────────────────────────────────────────────────────

function metricOf(t: TxnAgg, metric: PerfMetric): number | null {
  return t[metric];
}

export function evaluatePerformance(
  baseline: TxnAgg[], current: TxnAgg[], cfg: ReportConfig
): PerfRow[] {
  const base = new Map(baseline.map((t) => [t.name, t]));
  const rows: PerfRow[] = current.map((c) => {
    const b = base.get(c.name);
    const cur = metricOf(c, cfg.perfMetric);
    const bas = b ? metricOf(b, cfg.perfMetric) : null;
    return {
      transaction: c.name,
      baseline: bas,
      current: cur,
      deltaPct: deltaPct(cur, bas),
      baselineCount: b?.count ?? 0,
      currentCount: c.count,
      status: thresholdVerdict(cur, bas, true, cfg.thresholds.responseTime, cfg.warnFraction),
    };
  });
  return rows.sort((a, b) => (b.deltaPct ?? -Infinity) - (a.deltaPct ?? -Infinity));
}

// ── Throughput ────────────────────────────────────────────────────────────────

export function evaluateThroughput(inputs: ReportInputs): ThroughputRow[] {
  const { baseline, current, baselineTxns, currentTxns, serviceRequests, config } = inputs;
  const t = config.thresholds.requestCount;
  const sum = (txns: TxnAgg[], f: (x: TxnAgg) => number) => txns.reduce((a, x) => a + f(x), 0);
  const rate = (n: number | null, ms: number | null) => (n != null && ms != null && ms > 0 ? n / (ms / 1000) : null);

  const bTotal = sum(baselineTxns, (x) => x.count);
  const cTotal = sum(currentTxns, (x) => x.count);
  const bOk = bTotal - sum(baselineTxns, (x) => x.failCount);
  const cOk = cTotal - sum(currentTxns, (x) => x.failCount);

  const mk = (metric: string, unit: string, b: number | null, c: number | null): ThroughputRow => ({
    metric, unit, baseline: b, current: c, deltaPct: deltaPct(c, b),
    status: thresholdVerdict(c, b, false, t, config.warnFraction),
  });

  const rows: ThroughputRow[] = [
    mk("Transactions per second", "tx/s", rate(bTotal, baseline.durationMs), rate(cTotal, current.durationMs)),
    mk("Completed business transactions (successful)", "count", bOk, cOk),
  ];
  if (serviceRequests && (serviceRequests.baseline != null || serviceRequests.current != null)) {
    rows.splice(1, 0, mk(
      "Service requests per second", "req/s",
      rate(serviceRequests.baseline, baseline.durationMs),
      rate(serviceRequests.current, current.durationMs)
    ));
  }
  return rows;
}

// ── Errors ────────────────────────────────────────────────────────────────────

const errRate = (failed: number, total: number): number | null => (total > 0 ? (failed / total) * 100 : null);

export function evaluateErrors(baseline: TxnAgg[], current: TxnAgg[], cfg: ReportConfig): ErrorRow[] {
  const t = cfg.thresholds.errorRate;
  const tot = (txns: TxnAgg[]) => ({
    n: txns.reduce((a, x) => a + x.count, 0),
    f: txns.reduce((a, x) => a + x.failCount, 0),
  });
  const b = tot(baseline), c = tot(current);
  const bRate = errRate(b.f, b.n), cRate = errRate(c.f, c.n);

  const rows: ErrorRow[] = [{
    scope: "Overall",
    baselineRatePct: bRate, currentRatePct: cRate,
    baselineFailed: b.f, currentFailed: c.f, currentTotal: c.n,
    status: thresholdVerdict(cRate, bRate, true, t, cfg.warnFraction),
    informational: false,
  }];

  const base = new Map(baseline.map((x) => [x.name, x]));
  for (const x of current) {
    if (x.failCount === 0 && !(base.get(x.name)?.failCount)) continue;
    const bx = base.get(x.name);
    const br = bx ? errRate(bx.failCount, bx.count) : null;
    const cr = errRate(x.failCount, x.count);
    rows.push({
      scope: x.name,
      baselineRatePct: br, currentRatePct: cr,
      baselineFailed: bx?.failCount ?? 0, currentFailed: x.failCount, currentTotal: x.count,
      status: thresholdVerdict(cr, br, true, t, cfg.warnFraction),
      informational: true, // per-transaction detail does not drive the rule verdict
    });
  }
  return rows;
}

// ── Resources (CPU / memory) ──────────────────────────────────────────────────

function resourceRow(
  e: ResourceEntity, metric: string, unit: string,
  b: number | null, c: number | null, status: Verdict
): ResourceRow {
  return { entity: e.name, techType: e.techType, metric, unit, baseline: b, current: c, deltaPct: deltaPct(c, b), status };
}

export function evaluateCpu(entities: ResourceEntity[], cfg: ReportConfig): ResourceRow[] {
  const t = cfg.thresholds.cpu;
  return entities.flatMap((e) => [
    resourceRow(e, "CPU usage", "%", e.baseline.cpuPct, e.current.cpuPct,
      thresholdVerdict(e.current.cpuPct, e.baseline.cpuPct, true, t, cfg.warnFraction)),
    resourceRow(e, "CPU request", "m", e.baseline.cpuRequestM, e.current.cpuRequestM,
      configChangeVerdict(e.current.cpuRequestM, e.baseline.cpuRequestM, t.relPct)),
    resourceRow(e, "CPU limit", "m", e.baseline.cpuLimitM, e.current.cpuLimitM,
      configChangeVerdict(e.current.cpuLimitM, e.baseline.cpuLimitM, t.relPct)),
  ]);
}

export function evaluateMemory(entities: ResourceEntity[], cfg: ReportConfig): ResourceRow[] {
  const t = cfg.thresholds.memory;
  return entities.flatMap((e) => [
    resourceRow(e, "Memory usage", "MiB", e.baseline.memMiB, e.current.memMiB,
      thresholdVerdict(e.current.memMiB, e.baseline.memMiB, true, t, cfg.warnFraction)),
    resourceRow(e, "Memory request", "MiB", e.baseline.memRequestMiB, e.current.memRequestMiB,
      configChangeVerdict(e.current.memRequestMiB, e.baseline.memRequestMiB, t.relPct)),
    resourceRow(e, "Memory limit", "MiB", e.baseline.memLimitMiB, e.current.memLimitMiB,
      configChangeVerdict(e.current.memLimitMiB, e.baseline.memLimitMiB, t.relPct)),
  ]);
}

// ── GC ────────────────────────────────────────────────────────────────────────

export function gcVerdict(pct: number | null, warnPct: number, failPct: number): Verdict {
  if (pct == null) return "N/A";
  if (pct >= failPct) return "FAIL";
  if (pct >= warnPct) return "WARNING";
  return "PASS";
}

export function evaluateGc(entities: ResourceEntity[], cfg: ReportConfig): GcRow[] {
  return entities
    .filter((e) => e.current.gcPct != null || e.baseline.gcPct != null)
    .map((e) => ({
      entity: e.name,
      baselinePct: e.baseline.gcPct,
      currentPct: e.current.gcPct,
      status: gcVerdict(e.current.gcPct, cfg.gcWarnPct, cfg.gcFailPct),
    }));
}

// ── Rule summaries ────────────────────────────────────────────────────────────

function countBy(rows: { status: Verdict }[], v: Verdict): number {
  return rows.filter((r) => r.status === v).length;
}

function ruleFrom(
  id: RuleResult["id"], title: string, rows: { status: Verdict }[], noun: string, naText: string
): RuleResult {
  const verdict = worstVerdict(rows.map((r) => r.status));
  if (verdict === "N/A") return { id, title, verdict, summary: naText };
  const fail = countBy(rows, "FAIL"), warn = countBy(rows, "WARNING");
  const summary = fail || warn
    ? `${fail} ${noun} failed and ${warn} raised warnings out of ${rows.length} evaluated.`
    : `All ${rows.length} ${noun} are within configured thresholds.`;
  return { id, title, verdict, summary };
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function evaluateReport(inputs: ReportInputs): ReleaseReport {
  const { config, meta, current, baseline } = inputs;

  const perfRows = evaluatePerformance(inputs.baselineTxns, inputs.currentTxns, config);
  const tpRows = evaluateThroughput(inputs);
  const errRows = evaluateErrors(inputs.baselineTxns, inputs.currentTxns, config);
  const cpuRows = evaluateCpu(inputs.resources, config);
  const memRows = evaluateMemory(inputs.resources, config);
  const gcRows = evaluateGc(inputs.resources, config);

  const rules: RuleResult[] = [
    ruleFrom("performance", "Online performance vs previous release", perfRows, "business transactions",
      "No transactions could be compared with the baseline."),
    ruleFrom("cpu", "CPU request/limit and usage vs previous release", cpuRows, "CPU checks",
      "No CPU data was available for the mapped services."),
    ruleFrom("memory", "Memory request/limit and usage vs previous release", memRows, "memory checks",
      "No memory data was available for the mapped services."),
    gcRows.length
      ? ruleFrom("gc", `Java GC overhead below ${config.gcFailPct}% (warning at ${config.gcWarnPct}%)`, gcRows, "JVM processes", "")
      : { id: "gc", title: "Java GC overhead", verdict: "N/A", summary: "Not applicable: no JVM GC metrics were found for the mapped services." },
    ruleFrom("errors", "Error rate within threshold", errRows.filter((r) => !r.informational), "error-rate checks",
      "No transaction counts were available to compute an error rate."),
    ruleFrom("throughput", "No throughput degradation vs previous release", tpRows, "throughput measures",
      "No throughput data was available."),
  ];

  const warnings: string[] = [];
  if (current.durationMs != null && baseline.durationMs != null && baseline.durationMs > 0) {
    const diff = (Math.abs(current.durationMs - baseline.durationMs) / baseline.durationMs) * 100;
    if (diff > config.durationMismatchPct) {
      warnings.push(
        `Test durations differ by ${diff.toFixed(0)}% (baseline ${fmtDuration(baseline.durationMs)}, current ${fmtDuration(current.durationMs)}); ` +
        `counts are not directly comparable and rates should be interpreted with care.`
      );
    }
  } else {
    warnings.push("Test duration is unavailable for one or both tests; throughput rates may be unreliable.");
  }
  if (perfRows.some((r) => r.baseline == null)) {
    warnings.push("Some transactions have no baseline data and were not evaluated for performance.");
  }

  const overall = overallVerdict(rules);

  const report: ReleaseReport = {
    schemaVersion: 1,
    id: `${meta.generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}-${current.te_uuid.slice(-8)}`,
    meta, current, baseline, config,
    overall, rules, warnings,
    performance: { metric: config.perfMetric, rows: perfRows },
    throughput: { rows: tpRows },
    errors: { rows: errRows },
    cpu: { rows: cpuRows },
    memory: { rows: memRows },
    gc: { rows: gcRows },
    auditStatement: "",
  };
  report.auditStatement = buildAuditStatement(report);
  return report;
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "n/a";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
