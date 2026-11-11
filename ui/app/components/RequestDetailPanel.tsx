import React, { useEffect, useMemo, useRef, useState } from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Select, Switch } from "@dynatrace/strato-components/forms";
import { TimeseriesChart } from "@dynatrace/strato-components/charts";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import { Accordion } from "@dynatrace/strato-components/content";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { useSelectedTest } from "../context/SelectedTestContext";
import { useSettings } from "../context/SettingsContext";
import { useFilters } from "../context/FilterContext";
import { isWorse, type MetricThreshold } from "../utils/thresholds";
import { InfrastructurePanel } from "./InfrastructurePanel";
import { useSlos } from "../context/SloContext";
import { lookupSlo, normalizeNaKeptn, parseProjectFromTestExecution } from "../utils/sloData";

const COLOR_BETTER = "#00b140";
const COLOR_WORSE  = "#e8323e";

// ── Raw record shape from lookup table ───────────────────────────────────────

interface RequestDetailRecord {
  test_execution: string;
  transaction_name: string;
  script_name?: string;
  page_context?: string;
  zone?: string;
  row_key?: string; // dedup key, not displayed
  count?: number | string;
  fail_count?: number | string;
  avg_dur_ms?: number | string;
  min_dur_ms?: number | string;
  max_dur_ms?: number | string;
  p25_dur_ms?: number | string;
  p50_dur_ms?: number | string;
  p75_dur_ms?: number | string;
  p90_dur_ms?: number | string;
  p95_dur_ms?: number | string;
  p99_dur_ms?: number | string;
}

// ── Flattened display row: primary values + per-step comparison averages ─────

interface DisplayRow {
  transaction_name: string;
  script_name: string;
  page_context: string;
  zone: string;
  count: number | null;
  cmp_count: number | null;
  avg_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  p25_ms: number | null;
  p50_ms: number | null;
  p75_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  cmp_avg_ms: number | null;
  cmp_min_ms: number | null;
  cmp_max_ms: number | null;
  cmp_p25_ms: number | null;
  cmp_p50_ms: number | null;
  cmp_p75_ms: number | null;
  cmp_p90_ms: number | null;
  cmp_p95_ms: number | null;
  cmp_p99_ms: number | null;
  iqr_ms: number | null;
  cmp_iqr_ms: number | null;
  iqr_pct_p99: number | null;
  cmp_iqr_pct_p99: number | null;
  fail_count: number | null;
  cmp_fail_count: number | null;
  fail_rate: number | null;
  cmp_fail_rate: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Values in testsummary_responsetime_detailed are already in ms (DQL divides before storage)
function parseMs(val: number | string | undefined): number | null {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function avgMs(records: RequestDetailRecord[], field: keyof RequestDetailRecord): number | null {
  const vals = records
    .map(r => parseMs(r[field] as number | string | undefined))
    .filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

interface AggMetrics {
  count:      number | null;
  fail_count: number | null;
  avg_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  p25_ms: number | null;
  p50_ms: number | null;
  p75_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
}

function aggregateMetrics(recs: RequestDetailRecord[]): AggMetrics {
  if (recs.length === 0) return { count: null, fail_count: null, avg_ms: null, min_ms: null, max_ms: null, p25_ms: null, p50_ms: null, p75_ms: null, p90_ms: null, p95_ms: null, p99_ms: null };

  const counts = recs.map(r => r.count != null ? Number(r.count) : null);
  const allCountsPresent = counts.every(c => c != null);
  const totalCount = allCountsPresent ? counts.reduce((a, b) => a! + b!, 0) : null;
  const totalFailCount = recs.every(r => r.fail_count != null)
    ? recs.reduce((sum, r) => sum + Number(r.fail_count), 0)
    : null;

  // Weighted average by count; falls back to simple average when counts are missing
  const wAvg = (field: keyof RequestDetailRecord): number | null => {
    if (recs.length === 1) return parseMs(recs[0][field] as number | string | undefined);
    if (totalCount == null || totalCount === 0) return avgMs(recs, field);
    const weighted = recs.reduce((sum, r, i) => {
      const v = parseMs(r[field] as number | string | undefined);
      const c = counts[i];
      return sum + (v != null && c != null ? v * c : 0);
    }, 0);
    return weighted / totalCount;
  };

  const minOf = (field: keyof RequestDetailRecord): number | null => {
    const vals = recs.map(r => parseMs(r[field] as number | string | undefined)).filter((v): v is number => v != null);
    return vals.length ? Math.min(...vals) : null;
  };

  const maxOf = (field: keyof RequestDetailRecord): number | null => {
    const vals = recs.map(r => parseMs(r[field] as number | string | undefined)).filter((v): v is number => v != null);
    return vals.length ? Math.max(...vals) : null;
  };

  return {
    count:      totalCount,
    fail_count: totalFailCount,
    avg_ms: wAvg('avg_dur_ms'),
    min_ms: minOf('min_dur_ms'),
    max_ms: maxOf('max_dur_ms'),
    p25_ms: wAvg('p25_dur_ms'),
    p50_ms: wAvg('p50_dur_ms'),
    p75_ms: wAvg('p75_dur_ms'),
    p90_ms: wAvg('p90_dur_ms'),
    p95_ms: wAvg('p95_dur_ms'),
    p99_ms: wAvg('p99_dur_ms'),
  };
}

// Map a raw record field name to the corresponding AggMetrics key for chart use
function aggMetricForField(agg: AggMetrics, field: keyof RequestDetailRecord): number | null {
  switch (field) {
    case 'avg_dur_ms': return agg.avg_ms;
    case 'min_dur_ms': return agg.min_ms;
    case 'max_dur_ms': return agg.max_ms;
    case 'p25_dur_ms': return agg.p25_ms;
    case 'p50_dur_ms': return agg.p50_ms;
    case 'p75_dur_ms': return agg.p75_ms;
    case 'p90_dur_ms': return agg.p90_ms;
    case 'p95_dur_ms': return agg.p95_ms;
    case 'p99_dur_ms': return agg.p99_ms;
    default: return null;
  }
}

function bizeventsQuery(teUuid: string): string {
  return `fetch bizevents, from: -365d | filter in(event.type, {"neoload.responsetime.detailed", "loadtest.responsetime.detailed"}) | filter te_uuid == "${teUuid}"`;
}

// ── Service-metrics helpers (for the in-panel service detail section) ─────────

const SVC_US_TO_MS = 0.001; // dt.service.request.response_time is in microseconds

interface SvcChartPanel { title: string; yLabel?: string; series: Timeseries[]; }

interface SvcRtMetricDef { id: string; label: string; field?: string; }
const SVC_RT_METRIC_DEFS: SvcRtMetricDef[] = [
  { id: 'avg_rt', label: 'Avg', field: 'avg_rt' },
  { id: 'min_rt', label: 'Min', field: 'min_rt' },
  { id: 'p25_rt', label: 'P25', field: 'p25_rt' },
  { id: 'p50_rt', label: 'P50', field: 'p50_rt' },
  { id: 'p75_rt', label: 'P75', field: 'p75_rt' },
  { id: 'p90_rt', label: 'P90', field: 'p90_rt' },
  { id: 'p95_rt', label: 'P95', field: 'p95_rt' },
  { id: 'p99_rt', label: 'P99', field: 'p99_rt' },
  { id: 'max_rt', label: 'Max', field: 'max_rt' },
  { id: 'iqr',    label: 'IQR' },
];
const DEFAULT_SVC_RT_METRICS = new Set(['avg_rt', 'p90_rt', 'p99_rt']);

interface SvcTestData { label: string; testStart: string; recs: Record<string, unknown>[]; }

function servicesBizeventsForRowDql(teUuid: string, transactionName: string, scriptName: string, pageContext: string): string {
  return [
    `fetch bizevents, from: -365d`,
    `| filter in(event.type, {"neoload.services.detailed", "loadtest.services.detailed"})`,
    `| filter te_uuid == "${teUuid}"`,
    `| filter transaction_name == "${transactionName}"`,
    `| filter script_name == "${scriptName}"`,
    `| filter page_context == "${pageContext}"`,
  ].join(' ');
}

function svcMetricsDql(serviceIds: string[], from: string, to: string): string {
  const list = serviceIds.map(id => `"${id}"`).join(', ');
  return (
    `timeseries { ` +
    `avg_rt = avg(dt.service.request.response_time), ` +
    `min_rt = min(dt.service.request.response_time), ` +
    `p25_rt = percentile(dt.service.request.response_time, 25), ` +
    `p50_rt = percentile(dt.service.request.response_time, 50), ` +
    `p75_rt = percentile(dt.service.request.response_time, 75), ` +
    `p90_rt = percentile(dt.service.request.response_time, 90), ` +
    `p95_rt = percentile(dt.service.request.response_time, 95), ` +
    `p99_rt = percentile(dt.service.request.response_time, 99), ` +
    `max_rt = max(dt.service.request.response_time), ` +
    `requests = sum(dt.service.request.count), ` +
    `errors = sum(dt.service.request.failure_count) ` +
    `}, from: "${from}", to: "${to}", interval: 1m, by: { dt.entity.service } ` +
    `| filter in(dt.entity.service, {${list}})`
  );
}

function toAbsSeries(rec: Record<string, unknown>, field: string, mult: number, testStart: string): { start: Date; value: number }[] {
  const arr = rec[field] as (number | null)[] | undefined;
  if (!arr) return [];
  const tf = rec["timeframe"] as { start?: string } | undefined;
  const origin = tf?.start ? new Date(tf.start).getTime() : new Date(testStart).getTime();
  const intMs = Number(rec["interval"]) / 1_000_000;
  return arr
    .map((v, i) => v != null ? { start: new Date(origin + i * intMs), value: v * mult } : null)
    .filter((p): p is { start: Date; value: number } => p != null);
}

function avgSeriesAcrossRecs(recs: Record<string, unknown>[], field: string, mult: number, testStart: string): { start: Date; value: number }[] {
  if (recs.length === 0) return [];
  if (recs.length === 1) return toAbsSeries(recs[0], field, mult, testStart);
  const all = recs.map(r => toAbsSeries(r, field, 1, testStart));
  const minLen = Math.min(...all.map(s => s.length));
  if (minLen === 0) return [];
  return all[0].slice(0, minLen).map((pt, i) => ({
    start: pt.start,
    value: (all.reduce((sum, s) => sum + (s[i]?.value ?? 0), 0) / all.length) * mult,
  }));
}

function avgErrorRateAcrossRecs(recs: Record<string, unknown>[], testStart: string): { start: Date; value: number }[] {
  const perSvc = recs.map(rec => {
    const reqArr = rec["requests"] as (number | null)[] | undefined ?? [];
    const errArr = rec["errors"] as (number | null)[] | undefined ?? [];
    const tf = rec["timeframe"] as { start?: string } | undefined;
    const origin = tf?.start ? new Date(tf.start).getTime() : new Date(testStart).getTime();
    const intMs = Number(rec["interval"]) / 1_000_000;
    return reqArr
      .map((req, i) => {
        if (req == null || req === 0) return null;
        return { start: new Date(origin + i * intMs), value: ((errArr[i] ?? 0) / req) * 100 };
      })
      .filter((p): p is { start: Date; value: number } => p != null);
  }).filter(s => s.length > 0);
  if (perSvc.length === 0) return [];
  const minLen = Math.min(...perSvc.map(s => s.length));
  if (minLen === 0) return [];
  return perSvc[0].slice(0, minLen).map((pt, i) => ({
    start: pt.start,
    value: perSvc.reduce((sum, s) => sum + (s[i]?.value ?? 0), 0) / perSvc.length,
  }));
}

function computeIqrSeries(recs: Record<string, unknown>[], testStart: string): { start: Date; value: number }[] {
  const p25 = avgSeriesAcrossRecs(recs, 'p25_rt', 1, testStart);
  const p75 = avgSeriesAcrossRecs(recs, 'p75_rt', 1, testStart);
  const minLen = Math.min(p25.length, p75.length);
  if (minLen === 0) return [];
  return p25.slice(0, minLen).map((pt, i) => ({ start: pt.start, value: (p75[i].value - pt.value) * SVC_US_TO_MS }));
}

function computeIqrPctSeries(recs: Record<string, unknown>[], testStart: string): { start: Date; value: number }[] {
  const p25 = avgSeriesAcrossRecs(recs, 'p25_rt', 1, testStart);
  const p75 = avgSeriesAcrossRecs(recs, 'p75_rt', 1, testStart);
  const p99 = avgSeriesAcrossRecs(recs, 'p99_rt', 1, testStart);
  const minLen = Math.min(p25.length, p75.length, p99.length);
  if (minLen === 0) return [];
  return p25.slice(0, minLen).map((pt, i) => {
    const iqrUs = p75[i].value - pt.value;
    const p99v  = p99[i].value;
    if (p99v <= 0) return null;
    return { start: pt.start, value: (iqrUs / p99v) * 100 };
  }).filter((p): p is { start: Date; value: number } => p != null);
}

// ── Delta cell ────────────────────────────────────────────────────────────────

const DeltaCell: React.FC<{ primaryMs: number | null; compareAvgMs: number | null; threshold: MetricThreshold }> = ({
  primaryMs,
  compareAvgMs,
  threshold,
}) => {
  if (primaryMs == null) return <span>—</span>;
  const delta = compareAvgMs != null ? primaryMs - compareAvgMs : null;
  const worse = isWorse(primaryMs, compareAvgMs, true, threshold);
  const deltaColor = delta != null ? (worse ? COLOR_WORSE : delta < 0 ? COLOR_BETTER : undefined) : undefined;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      <span style={{ whiteSpace: "nowrap" }}>{primaryMs.toFixed(2)} ms</span>
      {delta != null && (
        <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap", color: deltaColor }}>
          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
        </span>
      )}
    </div>
  );
};

// ── Column picker ─────────────────────────────────────────────────────────────

interface ColPickerDef { id: string; label: string; locked?: boolean; }

function ColumnPicker({ defs, hidden, onChange }: { defs: ColPickerDef[]; hidden: Set<string>; onChange: (v: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggleable = defs.filter(d => !d.locked);
  const hiddenCount = toggleable.filter(d => hidden.has(d.id)).length;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{
        background: open ? "rgba(110,145,230,0.15)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${hiddenCount > 0 ? "rgba(110,145,230,0.5)" : "rgba(255,255,255,0.15)"}`,
        borderRadius: "4px", color: hiddenCount > 0 ? "#6e91e6" : "#8e9099",
        fontSize: "0.78em", padding: "4px 10px", cursor: "pointer", whiteSpace: "nowrap",
      }}>
        Columns{hiddenCount > 0 ? ` (${toggleable.length - hiddenCount}/${toggleable.length})` : ""} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 200,
          background: "#1a1d24", border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: "6px", padding: "6px 0", minWidth: "160px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)", maxHeight: "340px", overflowY: "auto",
        }}>
          {defs.map(def => {
            const checked = !!def.locked || !hidden.has(def.id);
            return (
              <label key={def.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 12px", cursor: def.locked ? "default" : "pointer", opacity: def.locked ? 0.4 : 1 }}>
                <input type="checkbox" checked={checked} disabled={!!def.locked}
                  onChange={e => { const n = new Set(hidden); e.target.checked ? n.delete(def.id) : n.add(def.id); onChange(n); }}
                  style={{ margin: 0 }} />
                <span style={{ fontSize: "0.84em", color: "#c8ccd4", userSelect: "none" }}>{def.label}</span>
              </label>
            );
          })}
          {hiddenCount > 0 && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", margin: "4px 0 0", padding: "5px 12px 3px" }}>
              <button onClick={() => onChange(new Set())}
                style={{ background: "none", border: "none", color: "#6e91e6", fontSize: "0.75em", cursor: "pointer", padding: 0 }}>
                Show all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const RD_COL_DEFS: ColPickerDef[] = [
  { id: "na_keptn",    label: "Test Step", locked: true },  // id kept for localStorage compat
  { id: "script_name", label: "Script" },
  { id: "request",     label: "Request",  locked: true },  // id kept for localStorage compat
  { id: "zone",        label: "Zone" },
  { id: "count",       label: "Count" },
  { id: "fail_rate",   label: "Fail Rate" },
  { id: "avg_ms",      label: "Avg" },
  { id: "min_ms",      label: "Min" },
  { id: "max_ms",      label: "Max" },
  { id: "p25_ms",      label: "P25" },
  { id: "p50_ms",      label: "P50" },
  { id: "p75_ms",      label: "P75" },
  { id: "p90_ms",      label: "P90" },
  { id: "p95_ms",      label: "P95" },
  { id: "p99_ms",      label: "P99" },
  { id: "iqr_ms",      label: "IQR" },
  { id: "iqr_pct",     label: "%IQR/P99" },
  { id: "slo",         label: "vs SLO" },
];
const RD_HIDDEN_KEY = "dt-neoload:hidden-cols:request-detail";

// ── Panel ─────────────────────────────────────────────────────────────────────

export const RequestDetailPanel: React.FC = () => {
  const { primaryTest, compareTests } = useSelectedTest();
  const { settings } = useSettings();
  const { thresholds } = settings;
  const { entries: sloEntries } = useSlos();
  const [compareRecordsByTest, setCompareRecordsByTest] = useState<Map<string, RequestDetailRecord[]>>(new Map());
  const [missingTests, setMissingTests] = useState<{ id: string; query: string }[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const { filterSteps, filterRequests, filterScripts, filterZones, setFilterSteps, setFilterRequests, setFilterScripts, setFilterZones, clearFilters } = useFilters();
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [svcRawData, setSvcRawData] = useState<SvcTestData[]>([]);
  const [svcChartsLoading, setSvcChartsLoading] = useState(false);
  const [svcNormalizeTime, setSvcNormalizeTime] = useState(true);
  const [selectedSvcRtMetrics, setSelectedSvcRtMetrics] = useState<Set<string>>(DEFAULT_SVC_RT_METRICS);
  const [hiddenCols, setHiddenColsState] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem(RD_HIDDEN_KEY); if (s) return new Set(JSON.parse(s) as string[]); } catch {}
    return new Set<string>();
  });
  const setHiddenCols = (next: Set<string>) => {
    setHiddenColsState(next);
    try { localStorage.setItem(RD_HIDDEN_KEY, JSON.stringify([...next])); } catch {}
  };

  useEffect(() => {
    setActiveRow(null);
    setSvcRawData([]);
  }, [primaryTest?.te_uuid]);

  // Load service DT metrics for the selected row
  useEffect(() => {
    if (!activeRow || !primaryTest) {
      setSvcRawData([]);
      setSvcChartsLoading(false);
      return;
    }
    const [transaction_name, script_name, page_context] = activeRow.split("|||");
    setSvcChartsLoading(true);

    queryExecutionClient
      .queryExecute({ body: { query: servicesBizeventsForRowDql(primaryTest.te_uuid, transaction_name, script_name, page_context), requestTimeoutMilliseconds: 30000 } })
      .then(res => {
        const records = (res.result?.records ?? []) as Record<string, unknown>[];
        const serviceIds = [...new Set(records.flatMap(rec => {
          try {
            const arr = JSON.parse(rec["services"] as string ?? "[]");
            return Array.isArray(arr) ? (arr as { service_id?: string }[]).map(s => s.service_id).filter((id): id is string => !!id) : [];
          } catch { return []; }
        }))];
        if (serviceIds.length === 0) { setSvcRawData([]); setSvcChartsLoading(false); return; }

        const allTests = [primaryTest, ...compareTests];
        const labelFor = (t: typeof primaryTest, i: number) => i === 0 ? "Primary" : new Date(t.test_start).toLocaleDateString();

        return Promise.all(allTests.map(async (test, i) => {
          const label = labelFor(test, i);
          const result = await queryExecutionClient
            .queryExecute({ body: { query: svcMetricsDql(serviceIds, test.test_start, test.test_end), requestTimeoutMilliseconds: 30000 } })
            .catch(() => null);
          const recs = (result?.result?.records ?? []) as Record<string, unknown>[];
          return { label, test, recs };
        })).then(results => {
          setSvcRawData(results.map(({ label, test, recs }) => ({ label, testStart: test.test_start, recs })));
          setSvcChartsLoading(false);
        });
      })
      .catch(() => { setSvcRawData([]); setSvcChartsLoading(false); });
  }, [activeRow, primaryTest?.te_uuid, compareTests.map(t => t.te_uuid).join(',')]);

  // Build service charts from raw data; recomputes when selection or normalize changes (no re-fetch needed)
  const displaySvcCharts = useMemo<SvcChartPanel[]>(() => {
    if (svcRawData.length === 0) return [];

    const refMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    const normalizeTs = (pts: { start: Date; value: number }[]) => {
      if (!svcNormalizeTime || pts.length === 0) return pts;
      const shift = refMs - pts[0].start.getTime();
      return pts.map(pt => ({ start: new Date(pt.start.getTime() + shift), value: pt.value }));
    };

    const rtSeries:     Timeseries[] = [];
    const reqSeries:    Timeseries[] = [];
    const errSeries:    Timeseries[] = [];
    const iqrPctSeries: Timeseries[] = [];

    for (const { label, testStart, recs } of svcRawData) {
      if (recs.length === 0) continue;

      for (const def of SVC_RT_METRIC_DEFS) {
        if (!selectedSvcRtMetrics.has(def.id)) continue;
        const pts = def.id === 'iqr'
          ? computeIqrSeries(recs, testStart)
          : avgSeriesAcrossRecs(recs, def.field!, SVC_US_TO_MS, testStart);
        const norm = normalizeTs(pts);
        if (norm.length) rtSeries.push({ name: `${label} – ${def.label}`, unit: 'ms', datapoints: norm });
      }

      const reqNorm = normalizeTs(avgSeriesAcrossRecs(recs, 'requests', 1, testStart));
      if (reqNorm.length) reqSeries.push({ name: label, datapoints: reqNorm });

      const errNorm = normalizeTs(avgErrorRateAcrossRecs(recs, testStart));
      if (errNorm.length) errSeries.push({ name: label, unit: '%', datapoints: errNorm });

      const iqrPctNorm = normalizeTs(computeIqrPctSeries(recs, testStart));
      if (iqrPctNorm.length) iqrPctSeries.push({ name: label, unit: '%', datapoints: iqrPctNorm });
    }

    const charts: SvcChartPanel[] = [];
    if (rtSeries.length     > 0) charts.push({ title: 'Service Response Time', yLabel: 'ms', series: rtSeries });
    if (iqrPctSeries.length > 0) charts.push({ title: 'IQR % vs P99',          yLabel: '%',  series: iqrPctSeries });
    if (reqSeries.length    > 0) charts.push({ title: 'Service Throughput',                   series: reqSeries });
    if (errSeries.length    > 0) charts.push({ title: 'Service Error Rate',     yLabel: '%',  series: errSeries });
    return charts;
  }, [svcRawData, selectedSvcRtMetrics, svcNormalizeTime]);

  // Hooks must run unconditionally — use a no-op query when there's no primary
  const primaryQuery = primaryTest
    ? bizeventsQuery(primaryTest.te_uuid)
    : "fetch logs | limit 0";
  const { data: primaryData, isLoading: primaryLoading } = useDql<RequestDetailRecord>(primaryQuery);
  const primaryRecords = primaryData?.records ?? [];

  // Load all comparison test tables; track which ones have no data
  useEffect(() => {
    if (!primaryTest || compareTests.length === 0) {
      setCompareRecordsByTest(new Map());
      setMissingTests([]);
      return;
    }
    setCompareLoading(true);
    Promise.all(
      compareTests.map(t => {
        const query = bizeventsQuery(t.te_uuid);
        return queryExecutionClient
          .queryExecute({ body: { query, requestTimeoutMilliseconds: 30000 } })
          .then(r => ({ records: (r.result?.records ?? []) as unknown as RequestDetailRecord[], id: t.te_uuid, query, missing: false }))
          .catch(() => ({ records: [] as RequestDetailRecord[], id: t.te_uuid, query, missing: true }));
      })
    ).then(results => {
      const byTest = new Map<string, RequestDetailRecord[]>();
      for (const r of results) byTest.set(r.id, r.records);
      setCompareRecordsByTest(byTest);
      setMissingTests(
        results
          .filter(r => r.missing || r.records.length === 0)
          .map(r => ({ id: r.id, query: r.query }))
      );
      setCompareLoading(false);
    });
  }, [primaryTest, compareTests]);

  // Must be before any early return — clears selected requests/scripts that no longer belong to
  // the selected steps, using the raw primary records which are always available at this point.
  useEffect(() => {
    if (filterRequests.length === 0 || filterSteps.length === 0) return;
    const validRequests = new Set(
      primaryRecords
        .filter(r => filterSteps.includes(r.transaction_name))
        .map(r => r.page_context ?? "—")
        .filter(r => r !== "—")
    );
    const stillValid = filterRequests.filter(r => validRequests.has(r));
    if (stillValid.length !== filterRequests.length) setFilterRequests(stillValid);
  }, [filterSteps, primaryRecords]);

  if (!primaryTest) return null;

  const compareRecords = [...compareRecordsByTest.values()].flat();

  // Group primary records by composite key (na_keptn + request + zone), then aggregate.
  // Multiple events with the same key occur when the workflow emits one event per virtual
  // user population or per load-generation interval — they must be merged into one row.
  const primaryByKey = new Map<string, RequestDetailRecord[]>();
  for (const p of primaryRecords) {
    const key = `${p.transaction_name}|||${p.script_name ?? ""}|||${p.page_context ?? "—"}|||${p.zone ?? "—"}`;
    const group = primaryByKey.get(key) ?? [];
    group.push(p);
    primaryByKey.set(key, group);
  }

  // Index comparison records by the same composite key for accurate per-request deltas
  const cmpByKey = new Map<string, RequestDetailRecord[]>();
  for (const r of compareRecords) {
    const key = `${r.transaction_name}|||${r.script_name ?? ""}|||${r.page_context ?? "—"}|||${r.zone ?? "—"}`;
    const group = cmpByKey.get(key) ?? [];
    group.push(r);
    cmpByKey.set(key, group);
  }

  const hasCompare = compareTests.length > 0;

  const rows: DisplayRow[] = [...primaryByKey.entries()].map(([key, primGroup]) => {
    const [transaction_name, script_name, page_context, zone] = key.split("|||");
    const p = aggregateMetrics(primGroup);
    const cmpGroup = cmpByKey.get(key) ?? [];
    const c = cmpGroup.length ? aggregateMetrics(cmpGroup) : null;
    const iqr_ms      = p.p75_ms != null && p.p25_ms != null ? p.p75_ms - p.p25_ms : null;
    const cmp_iqr_ms  = c?.p75_ms != null && c?.p25_ms != null ? c.p75_ms - c.p25_ms : null;
    const iqr_pct_p99     = iqr_ms != null && p.p99_ms != null && p.p99_ms !== 0 ? (iqr_ms / p.p99_ms) * 100 : null;
    const cmp_iqr_pct_p99 = cmp_iqr_ms != null && c?.p99_ms != null && c.p99_ms !== 0 ? (cmp_iqr_ms / c.p99_ms) * 100 : null;
    const fail_count     = p.fail_count;
    const cmp_fail_count = c?.fail_count ?? null;
    const fail_rate     = fail_count != null && p.count != null && p.count > 0 ? (fail_count / p.count) * 100 : null;
    const cmp_fail_rate = cmp_fail_count != null && c?.count != null && c.count > 0 ? (cmp_fail_count / c.count) * 100 : null;
    return {
      transaction_name,
      script_name,
      page_context,
      zone,
      count:      p.count,
      cmp_count:  c?.count ?? null,
      avg_ms:     p.avg_ms,
      min_ms:     p.min_ms,
      max_ms:     p.max_ms,
      p25_ms:     p.p25_ms,
      p50_ms:     p.p50_ms,
      p75_ms:     p.p75_ms,
      p90_ms:     p.p90_ms,
      p95_ms:     p.p95_ms,
      p99_ms:     p.p99_ms,
      cmp_avg_ms: c?.avg_ms ?? null,
      cmp_min_ms: c?.min_ms ?? null,
      cmp_max_ms: c?.max_ms ?? null,
      cmp_p25_ms: c?.p25_ms ?? null,
      cmp_p50_ms: c?.p50_ms ?? null,
      cmp_p75_ms: c?.p75_ms ?? null,
      cmp_p90_ms: c?.p90_ms ?? null,
      cmp_p95_ms: c?.p95_ms ?? null,
      cmp_p99_ms: c?.p99_ms ?? null,
      iqr_ms,
      cmp_iqr_ms,
      iqr_pct_p99,
      cmp_iqr_pct_p99,
      fail_count,
      cmp_fail_count,
      fail_rate,
      cmp_fail_rate,
    };
  });

  const uniqueSteps = [...new Set(rows.map(r => r.transaction_name))].sort();
  const uniqueRequests = [...new Set(
    rows
      .filter(r => filterSteps.length === 0 || filterSteps.includes(r.transaction_name))
      .map(r => r.page_context)
      .filter(r => r !== "—")
  )].sort();
  const uniqueScripts = [...new Set(
    rows
      .filter(r => filterSteps.length === 0 || filterSteps.includes(r.transaction_name))
      .map(r => r.script_name)
      .filter(s => s !== "")
  )].sort();
  const uniqueZones = [...new Set(rows.map(r => r.zone).filter(z => z !== "—"))].sort();

  const filteredRows = rows.filter(r =>
    (filterSteps.length    === 0 || filterSteps.includes(r.transaction_name)) &&
    (filterRequests.length === 0 || filterRequests.includes(r.page_context)) &&
    (filterScripts.length  === 0 || filterScripts.includes(r.script_name)) &&
    (filterZones.length    === 0 || filterZones.includes(r.zone))
  );

  const rowKey = (r: DisplayRow) => `${r.transaction_name}|||${r.script_name}|||${r.page_context}|||${r.zone}`;
  const selectedRow = activeRow ? (rows.find(r => rowKey(r) === activeRow) ?? null) : null;

  const CHART_METRICS: Array<{ name: string; field: keyof RequestDetailRecord }> = [
    { name: "Avg", field: "avg_dur_ms" },
    { name: "Min", field: "min_dur_ms" },
    { name: "Max", field: "max_dur_ms" },
    { name: "P25", field: "p25_dur_ms" },
    { name: "P50", field: "p50_dur_ms" },
    { name: "P75", field: "p75_dur_ms" },
    { name: "P90", field: "p90_dur_ms" },
    { name: "P95", field: "p95_dur_ms" },
    { name: "P99", field: "p99_dur_ms" },
  ];

  const chartSeries: Timeseries[] = selectedRow ? (() => {
    const matchStep = (r: RequestDetailRecord) =>
      r.transaction_name === selectedRow.transaction_name &&
      (r.script_name ?? "") === selectedRow.script_name &&
      (r.page_context ?? "—") === selectedRow.page_context &&
      (r.zone ?? "—") === selectedRow.zone;

    const allPoints = [
      { start: new Date(primaryTest.test_start), agg: aggregateMetrics(primaryRecords.filter(matchStep)) },
      ...compareTests.map(ct => ({
        start: new Date(ct.test_start),
        agg: aggregateMetrics((compareRecordsByTest.get(ct.te_uuid) ?? []).filter(matchStep)),
      })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    return CHART_METRICS.map(m => ({
      name: m.name,
      unit: "ms",
      datapoints: allPoints
        .map(p => {
          const val = aggMetricForField(p.agg, m.field);
          return val != null ? { start: p.start, value: val } : null;
        })
        .filter((dp): dp is { start: Date; value: number } => dp != null),
    })).filter(s => s.datapoints.length > 0);
  })() : [];

  const currentProject = parseProjectFromTestExecution(primaryTest.test_execution);

  // Column factory — uses rowData to access per-step comparison average
  function metricCol(
    id: string,
    header: string,
    valField: keyof DisplayRow,
    cmpField: keyof DisplayRow
  ): DataTableColumnDef<DisplayRow> {
    return {
      id,
      header,
      accessor: valField,
      width: "content",
      sortType: 'number',
      cell: ({ value, rowData }) => (
        <div style={{ paddingLeft: "12px", paddingRight: "12px" }}>
          <DeltaCell
            primaryMs={value as number | null}
            compareAvgMs={hasCompare ? (rowData[cmpField] as number | null) : null}
            threshold={thresholds.responseTime}
          />
        </div>
      ),
    };
  }

  const columns: DataTableColumnDef<DisplayRow>[] = [
    {
      id: "trend",
      header: "",
      accessor: rowKey,
      width: "content",
      disableSorting: true,
      cell: ({ rowData }) => {
        const key = rowKey(rowData);
        const isSelected = activeRow === key;
        return (
          <button
            onClick={() => setActiveRow(isSelected ? null : key)}
            title={isSelected ? "Hide trend chart" : "Show response time trend"}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              color: isSelected ? "#6e91e6" : "#636670",
              fontSize: "0.9em",
            }}
          >
            {isSelected ? "▼" : "▶"}
          </button>
        );
      },
    },
    { id: "na_keptn",    header: "Test Step", accessor: (row: DisplayRow) => normalizeNaKeptn(row.transaction_name), width: "auto" },
    { id: "script_name", header: "Script",    accessor: "script_name", width: "content" },
    { id: "request",     header: "Request",   accessor: "page_context", width: "auto" },
    { id: "zone",        header: "Zone",      accessor: "zone",         width: "content" },
    {
      id: "count",
      header: "Count",
      accessor: "count",
      width: "content",
      sortType: 'number',
      cell: ({ value, rowData }) => {
        const primary = value as number | null;
        const compare = hasCompare ? rowData.cmp_count : null;
        const delta = primary != null && compare != null ? primary - compare : null;
        const worse = isWorse(primary, compare, false, thresholds.requestCount);
        const better = primary != null && compare != null && primary > compare;
        return (
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span style={{ whiteSpace: "nowrap" }}>{primary ?? "—"}</span>
            {delta != null && (
              <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap", color: worse ? COLOR_WORSE : better ? COLOR_BETTER : undefined }}>
                {delta >= 0 ? "+" : ""}{Math.round(delta)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "fail_rate",
      header: "Fail Rate",
      accessor: "fail_rate" as keyof DisplayRow,
      width: "content",
      sortType: 'number',
      cell: ({ value, rowData }: { value: unknown; rowData: DisplayRow }) => {
        const primary = value as number | null;
        const compare = hasCompare ? rowData.cmp_fail_rate : null;
        if (primary == null) return <span style={{ color: "#636670", paddingLeft: "12px", paddingRight: "12px" }}>—</span>;
        const delta = compare != null ? primary - compare : null;
        const deltaColor = delta != null ? (delta > 0 ? COLOR_WORSE : delta < 0 ? COLOR_BETTER : undefined) : undefined;
        const valColor = primary > 5 ? COLOR_WORSE : primary > 0 ? "#f5a623" : undefined;
        return (
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px", paddingLeft: "12px", paddingRight: "12px" }}>
            <span style={{ whiteSpace: "nowrap", color: valColor }}>{primary.toFixed(2)}%</span>
            {delta != null && (
              <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap", color: deltaColor }}>
                {delta >= 0 ? "+" : ""}{delta.toFixed(2)}pp
              </span>
            )}
          </div>
        );
      },
    },
    metricCol("avg_ms", "Avg", "avg_ms", "cmp_avg_ms"),
    metricCol("min_ms", "Min", "min_ms", "cmp_min_ms"),
    metricCol("max_ms", "Max", "max_ms", "cmp_max_ms"),
    metricCol("p25_ms", "P25", "p25_ms", "cmp_p25_ms"),
    metricCol("p50_ms", "P50", "p50_ms", "cmp_p50_ms"),
    metricCol("p75_ms", "P75", "p75_ms", "cmp_p75_ms"),
    metricCol("p90_ms", "P90", "p90_ms", "cmp_p90_ms"),
    metricCol("p95_ms", "P95", "p95_ms", "cmp_p95_ms"),
    metricCol("p99_ms", "P99", "p99_ms", "cmp_p99_ms"),
    // IQR = P75 - P25 (spread of the middle 50% of requests)
    {
      id: "iqr_ms",
      header: "IQR",
      accessor: "iqr_ms" as keyof DisplayRow,
      width: "content",
      sortType: 'number',
      cell: ({ value, rowData }: { value: unknown; rowData: DisplayRow }) => (
        <div style={{ paddingLeft: "12px", paddingRight: "12px" }}>
          <DeltaCell
            primaryMs={value as number | null}
            compareAvgMs={hasCompare ? rowData.cmp_iqr_ms : null}
            threshold={thresholds.responseTime}
          />
        </div>
      ),
    },
    // %IQR vs P99 = IQR / P99 × 100 (how wide the middle band is relative to the tail)
    {
      id: "iqr_pct",
      header: "%IQR/P99",
      accessor: (row: DisplayRow) => row.iqr_pct_p99,
      width: "content",
      sortType: 'number',
      cell: ({ rowData }: { rowData: DisplayRow }) => {
        const primary = rowData.iqr_pct_p99;
        const compare = hasCompare ? rowData.cmp_iqr_pct_p99 : null;
        if (primary == null) return <span style={{ color: "#636670", paddingLeft: "12px", paddingRight: "12px" }}>—</span>;
        const delta = compare != null ? primary - compare : null;
        const worse = isWorse(primary, compare, true, thresholds.responseTime);
        const deltaColor = delta != null ? (worse ? COLOR_WORSE : delta < 0 ? COLOR_BETTER : undefined) : undefined;
        return (
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px", paddingLeft: "12px", paddingRight: "12px" }}>
            <span style={{ whiteSpace: "nowrap" }}>{primary.toFixed(1)}%</span>
            {delta != null && (
              <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap", color: deltaColor }}>
                {delta >= 0 ? "+" : ""}{delta.toFixed(1)}pp
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "slo",
      header: "vs SLO",
      accessor: (row: DisplayRow) => lookupSlo(sloEntries, row.transaction_name, row.page_context, currentProject),
      width: "content",
      sortType: 'number',
      cell: ({ rowData }: { rowData: DisplayRow }) => {
        const sloMs = lookupSlo(sloEntries, rowData.transaction_name, rowData.page_context, currentProject);
        if (sloMs == null) return <span style={{ color: "#3a3d45", paddingLeft: "12px", paddingRight: "12px" }}>—</span>;
        const avgMs = rowData.avg_ms;
        if (avgMs == null) return <span style={{ color: "#555a65", paddingLeft: "12px", paddingRight: "12px" }}>N/A</span>;
        const pass = avgMs <= sloMs;
        const pct = ((avgMs - sloMs) / sloMs) * 100;
        const sign = pct >= 0 ? "+" : "";
        return (
          <div style={{ paddingLeft: "12px", paddingRight: "12px", display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{
              fontSize: "0.7em", fontWeight: 700, padding: "1px 5px", borderRadius: "3px", letterSpacing: "0.04em",
              background: pass ? "rgba(0,177,64,0.15)" : "rgba(232,50,62,0.15)",
              color: pass ? "#00b140" : "#e8323e",
              border: `1px solid ${pass ? "rgba(0,177,64,0.35)" : "rgba(232,50,62,0.35)"}`,
            }}>
              {pass ? "✓" : "✗"}
            </span>
            <span style={{ fontSize: "0.78em", color: pass ? "#00b140" : "#e8323e", whiteSpace: "nowrap" }}>
              {sign}{pct.toFixed(1)}%
            </span>
          </div>
        );
      },
    },
  ];

  const visibleColumns = columns.filter(c => c.id === "trend" || !hiddenCols.has(c.id));

  // Pairs of [primaryField, compareField] for regression detection
  const METRIC_PAIRS: Array<[keyof DisplayRow, keyof DisplayRow]> = [
    ["avg_ms", "cmp_avg_ms"], ["min_ms", "cmp_min_ms"], ["max_ms", "cmp_max_ms"],
    ["p25_ms", "cmp_p25_ms"], ["p50_ms", "cmp_p50_ms"], ["p75_ms", "cmp_p75_ms"],
    ["p90_ms", "cmp_p90_ms"], ["p95_ms", "cmp_p95_ms"], ["p99_ms", "cmp_p99_ms"],
    ["iqr_ms", "cmp_iqr_ms"],
  ];

  const rowThresholds = [
    ...(activeRow ? [{
      comparator: (row: DisplayRow) => rowKey(row) === activeRow,
      type: "highlight" as const,
      backgroundColor: "rgba(110, 145, 230, 0.15)",
    }] : []),
    ...(hasCompare ? [{
      comparator: (row: DisplayRow) =>
        rowKey(row) !== activeRow &&
        METRIC_PAIRS.some(([val, cmp]) => {
          const v = row[val] as number | null;
          const c = row[cmp] as number | null;
          return isWorse(v, c, true, thresholds.responseTime);
        }),
      type: "highlight" as const,
      backgroundColor: "rgba(232, 50, 62, 0.08)",
    }] : []),
  ] as { comparator: (row: DisplayRow) => boolean; type: "highlight"; backgroundColor: string }[] | undefined;

  // Normalise: pass undefined when nothing to highlight so DataTable doesn't process an empty array
  const activeRowThresholds = rowThresholds?.length ? rowThresholds : undefined;

  const isLoading = primaryLoading || compareLoading;

  return (
    <Surface as="section" style={{ margin: "16px" }}>
      <Tabs>
        <Tab title="Request Details Performance">
          <Flex flexDirection="column" gap={12} style={{ padding: "16px" }}>
            {hasCompare && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span style={{ fontSize: "0.8em", color: "#8e9099" }}>
                  Delta vs {compareTests.length} comparison test{compareTests.length > 1 ? "s" : ""} —{" "}
                  <span style={{ color: COLOR_BETTER }}>green = improved</span>,{" "}
                  <span style={{ color: COLOR_WORSE }}>red = regression</span>
                </span>
              </div>
            )}

        {settings.showMissingTestsNotice && missingTests.length > 0 && !compareLoading && (
          <Accordion>
            <Accordion.Section id="missing-tests">
              <Accordion.SectionLabel>
                Missing Lookup Tables ({missingTests.length})
              </Accordion.SectionLabel>
              <Accordion.SectionContent>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.8em" }}>
                  <span style={{ color: "#8e9099", marginBottom: "4px" }}>
                    No request detail data for these comparison tests — run the workflow to ingest their performance business events:
                  </span>
                  {missingTests.map(t => (
                    <div key={t.id} style={{ fontFamily: "monospace", background: "rgba(255,255,255,0.05)", borderRadius: "4px", padding: "6px 10px" }}>
                      <div style={{ color: "#c5c8d1" }}>{t.id}</div>
                      <div style={{ color: "#636670", marginTop: "2px" }}>{t.query}</div>
                    </div>
                  ))}
                </div>
              </Accordion.SectionContent>
            </Accordion.Section>
          </Accordion>
        )}

        {isLoading ? (
          <span style={{ color: "#8e9099" }}>Loading request details…</span>
        ) : rows.length === 0 ? (
          <span style={{ color: "#8e9099" }}>
            No request detail data for this test execution. Run the workflow to ingest performance business events for this test.
          </span>
        ) : (
          <>
            <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
              <div style={{ width: "280px" }}>
                <Select<string, true>
                  multiple={true}
                  value={filterSteps}
                  onChange={v => setFilterSteps(v ?? [])}
                >
                  <Select.Trigger placeholder="All test steps" width="full" />
                  <Select.Content>
                    <Select.Filter />
                    {uniqueSteps.map(s => (
                      <Select.Option key={s} value={s}>{normalizeNaKeptn(s)}</Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div style={{ width: "200px" }}>
                <Select<string, true>
                  multiple={true}
                  value={filterScripts}
                  onChange={v => setFilterScripts(v ?? [])}
                >
                  <Select.Trigger placeholder="All scripts" width="full" />
                  <Select.Content>
                    <Select.Filter />
                    {uniqueScripts.map(s => (
                      <Select.Option key={s} value={s}>{s}</Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div style={{ width: "280px" }}>
                <Select<string, true>
                  multiple={true}
                  value={filterRequests}
                  onChange={v => setFilterRequests(v ?? [])}
                >
                  <Select.Trigger placeholder="All requests" width="full" />
                  <Select.Content>
                    <Select.Filter />
                    {uniqueRequests.map(r => (
                      <Select.Option key={r} value={r}>{r}</Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div style={{ width: "200px" }}>
                <Select<string, true>
                  multiple={true}
                  value={filterZones}
                  onChange={v => setFilterZones(v ?? [])}
                >
                  <Select.Trigger placeholder="All zones" width="full" />
                  <Select.Content>
                    <Select.Filter />
                    {uniqueZones.map(z => (
                      <Select.Option key={z} value={z}>{z}</Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              {(filterSteps.length > 0 || filterRequests.length > 0 || filterScripts.length > 0 || filterZones.length > 0) && (
                <span
                  style={{ fontSize: "0.8em", color: "#8e9099", cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={clearFilters}
                >
                  Clear filters ({filteredRows.length} / {rows.length})
                </span>
              )}
              <div style={{ marginLeft: "auto" }}>
                <ColumnPicker defs={RD_COL_DEFS} hidden={hiddenCols} onChange={setHiddenCols} />
              </div>
            </Flex>
            <DataTable
              data={filteredRows}
              columns={visibleColumns}
              fullWidth
              sortable
              rowThresholds={activeRowThresholds}
            >
              <DataTable.Pagination defaultPageSize={10} />
            </DataTable>

            {selectedRow && chartSeries.length > 0 && (
              <Surface style={{ padding: "16px" }}>
                <Flex flexDirection="column" gap={8}>
                  <Heading level={5}>
                    Response Time Trend — {normalizeNaKeptn(selectedRow.transaction_name)}
                    {selectedRow.script_name && ` [${selectedRow.script_name}]`}
                    {selectedRow.page_context !== "—" && ` / ${selectedRow.page_context}`}
                    {selectedRow.zone !== "—" && ` (${selectedRow.zone})`}
                  </Heading>
                  <TimeseriesChart height={280}>
                    {chartSeries.map(s => (
                      <TimeseriesChart.Line
                        key={Array.isArray(s.name) ? s.name.join("-") : s.name}
                        data={s}
                        pointsDisplay="always"
                        gapPolicy="connect"
                      />
                    ))}
                    <TimeseriesChart.Legend />
                    <TimeseriesChart.YAxis label="ms" />
                    <TimeseriesChart.Tooltip />
                  </TimeseriesChart>
                </Flex>
              </Surface>
            )}

            {selectedRow && (svcChartsLoading || svcRawData.length > 0) && (
              <Surface style={{ padding: "16px" }}>
                <Flex flexDirection="column" gap={12}>
                  <Flex alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={8}>
                    <Heading level={5} style={{ margin: 0 }}>
                      Service Metrics — {normalizeNaKeptn(selectedRow.transaction_name)}
                      {selectedRow.script_name && ` [${selectedRow.script_name}]`}
                      {selectedRow.page_context !== "—" && ` / ${selectedRow.page_context}`}
                    </Heading>
                    <Flex alignItems="center" gap={8}>
                      <Text textStyle="small" style={{ color: "#8e9099", whiteSpace: "nowrap" }}>Absolute time</Text>
                      <Switch value={!svcNormalizeTime} onChange={(v) => setSvcNormalizeTime(!v)} />
                    </Flex>
                  </Flex>

                  {/* RT metric picker */}
                  <Flex gap={6} alignItems="center" flexWrap="wrap">
                    <Text textStyle="small" style={{ color: "#8e9099", whiteSpace: "nowrap" }}>RT metrics:</Text>
                    {SVC_RT_METRIC_DEFS.map(def => {
                      const on = selectedSvcRtMetrics.has(def.id);
                      return (
                        <button
                          key={def.id}
                          onClick={() => setSelectedSvcRtMetrics(prev => {
                            const next = new Set(prev);
                            if (next.has(def.id)) next.delete(def.id); else next.add(def.id);
                            return next;
                          })}
                          style={{
                            fontSize: "0.78em",
                            padding: "2px 9px",
                            borderRadius: "11px",
                            border: `1px solid ${on ? "rgba(110,145,230,0.5)" : "rgba(255,255,255,0.12)"}`,
                            background: on ? "rgba(110,145,230,0.18)" : "transparent",
                            color: on ? "#6e91e6" : "#636670",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {def.label}
                        </button>
                      );
                    })}
                  </Flex>

                  <Text textStyle="small" style={{ color: "#8e9099" }}>
                    {svcNormalizeTime
                      ? "Elapsed time: tick marks are 1-minute intervals aligned to test start. Tests are overlaid for direct comparison."
                      : "Absolute timestamps — each test shows its own real-time window."}
                  </Text>

                  {svcChartsLoading && <span style={{ color: "#8e9099", fontSize: "0.85em" }}>Loading service metrics…</span>}

                  {!svcChartsLoading && displaySvcCharts.length === 0 && (
                    <span style={{ color: "#8e9099", fontSize: "0.85em" }}>No DT service data found for this transaction. Services may not have been instrumented or the time window produced no metrics.</span>
                  )}

                  {!svcChartsLoading && displaySvcCharts.length > 0 && (
                    <Flex flexDirection="column" gap={16}>
                      {/* Response Time + IQR% — full width */}
                      {displaySvcCharts.filter(c => c.title === "Service Response Time" || c.title === "IQR % vs P99").map(c => (
                        <div key={c.title}>
                          <Text style={{ fontSize: "0.75em", fontWeight: 600, color: "#8e9099", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                            {c.title}{c.yLabel ? ` (${c.yLabel})` : ""}
                          </Text>
                          <TimeseriesChart height={220}>
                            {c.series.map(s => (
                              <TimeseriesChart.Line key={Array.isArray(s.name) ? s.name.join("-") : s.name} data={s} gapPolicy="connect" />
                            ))}
                            <TimeseriesChart.Legend />
                            <TimeseriesChart.YAxis label={c.yLabel ?? ""} />
                            {svcNormalizeTime && <TimeseriesChart.XAxis label="Elapsed time (min)" />}
                            <TimeseriesChart.Tooltip />
                          </TimeseriesChart>
                        </div>
                      ))}
                      {/* Throughput + Error Rate — full width */}
                      {displaySvcCharts.filter(c => c.title !== "Service Response Time" && c.title !== "IQR % vs P99").map(c => (
                        <div key={c.title}>
                          <Text style={{ fontSize: "0.75em", fontWeight: 600, color: "#8e9099", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                            {c.title}{c.yLabel ? ` (${c.yLabel})` : ""}
                          </Text>
                          <TimeseriesChart height={200}>
                            {c.series.map(s => (
                              <TimeseriesChart.Line key={Array.isArray(s.name) ? s.name.join("-") : s.name} data={s} gapPolicy="connect" />
                            ))}
                            <TimeseriesChart.Legend />
                            {c.yLabel && <TimeseriesChart.YAxis label={c.yLabel} />}
                            {svcNormalizeTime && <TimeseriesChart.XAxis label="Elapsed time (min)" />}
                            <TimeseriesChart.Tooltip />
                          </TimeseriesChart>
                        </div>
                      ))}
                    </Flex>
                  )}
                </Flex>
              </Surface>
            )}
          </>
        )}
          </Flex>
        </Tab>

        <Tab title="Infrastructure Performance">
          <InfrastructurePanel />
        </Tab>
      </Tabs>
    </Surface>
  );
};
