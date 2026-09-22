import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Select, Switch } from "@dynatrace/strato-components/forms";
import { TimeseriesChart } from "@dynatrace/strato-components/charts";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { useSelectedTest } from "../context/SelectedTestContext";
import type { TestExecution } from "../context/SelectedTestContext";
import { getTechMetrics, ALL_UNIQUE_TECH_DEFS, SIGNAL_ORDER, SIGNAL_LABELS, type TechMetricDef, type SignalType } from "../utils/infraMetricConfig";
import { useSettings } from "../context/SettingsContext";
import { useFilters } from "../context/FilterContext";
import { isWorse, type MetricThreshold } from "../utils/thresholds";
import { normalizeNaKeptn } from "../utils/sloData";

const COLOR_WORSE  = "#e8323e";
const US_TO_MS     = 0.001; // dt.service.request.response_time is in microseconds

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceEntity {
  service_id: string;
  process_id_classic: string;
  process_exe: string;
  tech_type: string;
}

interface ServicesBizEvent {
  te_uuid: string;
  transaction_name: string;
  script_name?: string;
  page_context?: string;
  zone?: string;
  test_start: string;
  test_end: string;
  services: string; // JSON string of ServiceEntity[]
  service_id?: string; // top-level convenience field, not used directly
  row_key?: string;    // dedup key, not displayed
}

interface ParsedEntity extends ServiceEntity {
  transaction_name: string;
  script_name: string;
  page_context: string;
  zone: string;
  test_start: string;
  test_end: string;
}

interface EntityMetrics {
  avgRtMs: number | null;
  p90RtMs: number | null;
  requestCount: number | null;
  errorCount: number | null;
  errorRatePct: number | null;
  cpuPct: number | null;
  memoryMb: number | null;
  techMetrics: Record<string, number | null>;
}

interface GroupedEntity {
  entityKey: string;
  service_id: string;
  process_ids: string[];
  process_exe: string;
  tech_type: string;
  transaction_name: string;
  script_name: string;
  page_context: string;
  zone: string;
  test_start: string;
  test_end: string;
}

interface InfraRow extends GroupedEntity {
  primary: EntityMetrics;
  compareAvg: EntityMetrics;
}

interface ChartPanel {
  signal: SignalType;
  title: string;
  yLabel?: string;
  series: Timeseries[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function arrAvg(arr: (number | null)[] | undefined): number | null {
  const nums = (arr ?? []).filter((v): v is number => v != null && !isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function arrSum(arr: (number | null)[] | undefined): number | null {
  const nums = (arr ?? []).filter((v): v is number => v != null && !isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function parseServicesJson(raw: unknown): ServiceEntity[] {
  if (typeof raw !== "string") return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((e) => e?.service_id) : [];
  } catch {
    return [];
  }
}

function nullMetrics(): EntityMetrics {
  return { avgRtMs: null, p90RtMs: null, requestCount: null, errorCount: null, errorRatePct: null, cpuPct: null, memoryMb: null, techMetrics: {} };
}

function avgMetricsList(list: EntityMetrics[]): EntityMetrics {
  if (list.length === 0) return nullMetrics();
  const avg = (field: keyof Omit<EntityMetrics, 'techMetrics'>) => {
    const vals = list.map((m) => m[field] as number | null).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const allTechKeys = [...new Set(list.flatMap((m) => Object.keys(m.techMetrics)))];
  const techMetrics: Record<string, number | null> = {};
  for (const key of allTechKeys) {
    const vals = list.map((m) => m.techMetrics[key]).filter((v): v is number => v != null);
    techMetrics[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return {
    avgRtMs:      avg("avgRtMs"),
    p90RtMs:      avg("p90RtMs"),
    requestCount: avg("requestCount"),
    errorCount:   avg("errorCount"),
    errorRatePct: avg("errorRatePct"),
    cpuPct:       avg("cpuPct"),
    memoryMb:     avg("memoryMb"),
    techMetrics,
  };
}

function toAbsoluteSeries(
  record: Record<string, unknown>,
  field: string,
  multiplier: number,
  testStart: string
): { start: Date; value: number }[] {
  const arr = record[field] as (number | null)[] | undefined;
  if (!arr) return [];
  const timeframe = record["timeframe"] as { start?: string } | undefined;
  const recStart = timeframe?.start
    ? new Date(timeframe.start).getTime()
    : new Date(testStart).getTime();
  const intervalMs = Number(record["interval"]) / 1_000_000; // ns → ms
  return arr
    .map((v, i) =>
      v != null ? { start: new Date(recStart + i * intervalMs), value: v * multiplier } : null
    )
    .filter((p): p is { start: Date; value: number } => p != null);
}

function averageSeriesRecords(
  records: Record<string, unknown>[],
  field: string,
  multiplier: number,
  testStart: string
): { start: Date; value: number }[] {
  if (records.length === 0) return [];
  if (records.length === 1) return toAbsoluteSeries(records[0], field, multiplier, testStart);
  const all = records.map((r) => toAbsoluteSeries(r, field, 1, testStart));
  const minLen = Math.min(...all.map((s) => s.length));
  if (minLen === 0) return [];
  return all[0].slice(0, minLen).map((pt, i) => ({
    start: pt.start,
    value: (all.reduce((sum, s) => sum + (s[i]?.value ?? 0), 0) / all.length) * multiplier,
  }));
}

function svcDetailDql(serviceId: string, from: string, to: string): string {
  return (
    `timeseries { ` +
    `avg_rt = avg(dt.service.request.response_time), ` +
    `p50 = percentile(dt.service.request.response_time, 50), ` +
    `p90 = percentile(dt.service.request.response_time, 90), ` +
    `p99 = percentile(dt.service.request.response_time, 99), ` +
    `requests = sum(dt.service.request.count), ` +
    `errors = sum(dt.service.request.failure_count) ` +
    `}, from: "${from}", to: "${to}", interval: 1m, by: { dt.entity.service } ` +
    `| filter dt.entity.service == "${serviceId}"`
  );
}

function memDetailDql(processIds: string[], from: string, to: string): string {
  const pidList = processIds.map((id) => `"${id}"`).join(", ");
  return (
    `timeseries mem = avg(dt.process.memory.usage), ` +
    `from: "${from}", to: "${to}", interval: 1m, by: { dt.entity.process_group_instance } ` +
    `| filter in(dt.entity.process_group_instance, {${pidList}})`
  );
}

function cpuDetailDql(processIds: string[], from: string, to: string): string {
  const pidList = processIds.map((id) => `"${id}"`).join(", ");
  return (
    `timeseries cpu = avg(dt.process.cpu.usage), ` +
    `from: "${from}", to: "${to}", interval: 1m, by: { dt.entity.process_group_instance } ` +
    `| filter in(dt.entity.process_group_instance, {${pidList}})`
  );
}

function techMetricDetailDql(def: TechMetricDef, entity: GroupedEntity, from: string, to: string): string {
  const agg = def.aggregation === "sum" ? "sum" : "avg";
  if (def.entityDim === "dt.entity.service") {
    return (
      `timeseries val = ${agg}(\`${def.metricKey}\`), ` +
      `from: "${from}", to: "${to}", interval: 1m, by: { dt.entity.service } ` +
      `| filter dt.entity.service == "${entity.service_id}"`
    );
  }
  const pidList = entity.process_ids.map((id) => `"${id}"`).join(", ");
  return (
    `timeseries val = ${agg}(\`${def.metricKey}\`), ` +
    `from: "${from}", to: "${to}", interval: 1m, by: { dt.entity.process_group_instance } ` +
    `| filter in(dt.entity.process_group_instance, {${pidList}})`
  );
}

function servicesBizeventsQuery(teUuid: string): string {
  return `fetch bizevents, from: -365d | filter event.type == "neoload.services.detailed" | filter te_uuid == "${teUuid}"`;
}

// ── Delta cell ────────────────────────────────────────────────────────────────

const DeltaCell: React.FC<{
  primary: number | null;
  compare: number | null;
  fmt: (v: number) => string;
  betterIsLower?: boolean;
  threshold: MetricThreshold;
}> = ({ primary, compare, fmt, betterIsLower = true, threshold }) => {
  if (primary == null) return <span style={{ color: "#636670" }}>—</span>;
  const delta = compare != null ? primary - compare : null;
  const worse = isWorse(primary, compare, betterIsLower, threshold);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      <span style={{ whiteSpace: "nowrap" }}>{fmt(primary)}</span>
      {delta != null && (
        <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap", color: worse ? COLOR_WORSE : undefined }}>
          {delta >= 0 ? "+" : ""}{fmt(delta)}
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
          borderRadius: "6px", padding: "6px 0", minWidth: "180px",
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

const INFRA_BASE_COL_DEFS: ColPickerDef[] = [
  { id: "entity",     label: "Service / Process", locked: true },
  { id: "tech_type",  label: "Tech" },
  { id: "avg_rt",     label: "Avg RT" },
  { id: "p90_rt",     label: "P90 RT" },
  { id: "cpu",        label: "CPU %" },
  { id: "requests",   label: "Requests" },
  { id: "errors",     label: "Errors" },
  { id: "error_rate", label: "Err %" },
  { id: "memory",     label: "Memory" },
];
const INFRA_HIDDEN_KEY = "dt-neoload:hidden-cols:infra";

// ── Panel ─────────────────────────────────────────────────────────────────────

export const InfrastructurePanel: React.FC = () => {
  const { primaryTest, compareTests } = useSelectedTest();
  const { settings } = useSettings();

  const { filterSteps, filterRequests, filterScripts, filterZones, setFilterSteps, setFilterRequests, setFilterScripts, setFilterZones, clearFilters } = useFilters();
  const [activeKey,      setActiveKey]      = useState<string | null>(null);
  const [detailCharts,   setDetailCharts]   = useState<ChartPanel[]>([]);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [normalizeTime,  setNormalizeTime]  = useState(true);
  const [processBreakdown, setProcessBreakdown] = useState<{ pid: string; cpuPct: number | null; memoryMb: number | null }[]>([]);
  const [testLabels,    setTestLabels]    = useState<string[]>([]);
  const [hiddenLabels,  setHiddenLabels]  = useState<Set<string>>(new Set());
  const [metricsMap,    setMetricsMap]    = useState<Map<string, EntityMetrics>>(new Map());
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [hiddenCols, setHiddenColsState] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem(INFRA_HIDDEN_KEY); if (s) return new Set(JSON.parse(s) as string[]); } catch {}
    return new Set<string>();
  });
  const setHiddenCols = (next: Set<string>) => {
    setHiddenColsState(next);
    try { localStorage.setItem(INFRA_HIDDEN_KEY, JSON.stringify([...next])); } catch {}
  };

  // Reset panel-local state on primary test change (filter state is reset by FilterContext)
  useEffect(() => {
    setActiveKey(null);
    setMetricsMap(new Map());
    setDetailCharts([]);
    setProcessBreakdown([]);
    setTestLabels([]);
    setHiddenLabels(new Set());
  }, [primaryTest?.te_uuid]);

  // Load services bizevents for primary test
  const primaryQuery = primaryTest
    ? servicesBizeventsQuery(primaryTest.te_uuid)
    : "fetch logs | limit 0";
  const { data: primaryServicesData, isLoading: servicesLoading } = useDql<ServicesBizEvent>(primaryQuery);

  // Parse all entities from primary services bizevents
  const allParsedEntities = useMemo<ParsedEntity[]>(() => {
    if (!primaryServicesData?.records) return [];
    return primaryServicesData.records.flatMap((rec) =>
      parseServicesJson(rec.services).map((svc) => ({
        ...svc,
        transaction_name: rec.transaction_name,
        script_name:      rec.script_name  ?? "",
        page_context:     rec.page_context ?? "—",
        zone:             rec.zone         ?? "—",
        test_start:       rec.test_start,
        test_end:         rec.test_end,
      }))
    );
  }, [primaryServicesData]);

  // Filter options
  const uniqueSteps    = useMemo(() => [...new Set(allParsedEntities.map((e) => e.transaction_name))].sort(), [allParsedEntities]);
  const uniqueRequests = useMemo(() => [...new Set(
    allParsedEntities
      .filter((e) => filterSteps.length === 0 || filterSteps.includes(e.transaction_name))
      .map((e) => e.page_context)
      .filter((r) => r !== "—")
  )].sort(), [allParsedEntities, filterSteps]);
  const uniqueScripts  = useMemo(() => [...new Set(
    allParsedEntities
      .filter((e) => filterSteps.length === 0 || filterSteps.includes(e.transaction_name))
      .map((e) => e.script_name)
      .filter((s) => s !== "")
  )].sort(), [allParsedEntities, filterSteps]);
  const uniqueZones    = useMemo(() => [...new Set(allParsedEntities.map((e) => e.zone).filter((z) => z !== "—"))].sort(), [allParsedEntities]);

  // Resolve service display names via DQL
  const entityNameQuery = useMemo(() => {
    const ids = [...new Set(allParsedEntities.map((e) => e.service_id))];
    if (ids.length === 0) return "fetch logs | limit 0";
    const idList = ids.map((id) => `"${id}"`).join(", ");
    return `fetch dt.entity.service, from: now()-365d | filter in(id, {${idList}}) | fields id, entity.name`;
  }, [allParsedEntities]);

  const { data: entityNameData } = useDql<Record<string, unknown>>(entityNameQuery);

  const serviceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const rec of entityNameData?.records ?? []) {
      const id = rec["id"] as string | undefined;
      const name = rec["entity.name"] as string | undefined;
      if (id && name) map.set(id, name);
    }
    return map;
  }, [entityNameData]);

  // Resolve process group instance display names via DQL
  const processNameQuery = useMemo(() => {
    const ids = [...new Set(allParsedEntities.map((e) => e.process_id_classic))];
    if (ids.length === 0) return "fetch logs | limit 0";
    const idList = ids.map((id) => `"${id}"`).join(", ");
    return `fetch dt.entity.process_group_instance, from: now()-365d | filter in(id, {${idList}}) | fields id, entity.name`;
  }, [allParsedEntities]);

  const { data: processNameData } = useDql<Record<string, unknown>>(processNameQuery);

  const processNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const rec of processNameData?.records ?? []) {
      const id = rec["id"] as string | undefined;
      const name = rec["entity.name"] as string | undefined;
      if (id && name) map.set(id, name);
    }
    return map;
  }, [processNameData]);

  // Apply filters + group by service_id, collecting all process IDs per service
  const filteredEntities = useMemo<GroupedEntity[]>(() => {
    const filtered = allParsedEntities.filter(
      (e) =>
        (filterSteps.length    === 0 || filterSteps.includes(e.transaction_name)) &&
        (filterRequests.length === 0 || filterRequests.includes(e.page_context)) &&
        (filterScripts.length  === 0 || filterScripts.includes(e.script_name)) &&
        (filterZones.length    === 0 || filterZones.includes(e.zone))
    );
    const grouped = new Map<string, GroupedEntity>();
    for (const e of filtered) {
      const existing = grouped.get(e.service_id);
      if (existing) {
        if (!existing.process_ids.includes(e.process_id_classic)) {
          existing.process_ids.push(e.process_id_classic);
        }
      } else {
        grouped.set(e.service_id, {
          entityKey:        e.service_id,
          service_id:       e.service_id,
          process_ids:      [e.process_id_classic],
          process_exe:      e.process_exe,
          tech_type:        e.tech_type,
          transaction_name: e.transaction_name,
          script_name:      e.script_name,
          page_context:     e.page_context,
          zone:             e.zone,
          test_start:       e.test_start,
          test_end:         e.test_end,
        });
      }
    }
    return [...grouped.values()];
  }, [allParsedEntities, filterSteps, filterRequests, filterZones]);

  // Load scalar metrics for all tests when filteredEntities / tests change
  useEffect(() => {
    if (!primaryTest || filteredEntities.length === 0) {
      setMetricsMap(new Map());
      return;
    }

    setMetricsLoading(true);
    const allTests: TestExecution[] = [primaryTest, ...compareTests];
    const serviceIds  = [...new Set(filteredEntities.map((e) => e.service_id))];
    const processIds  = [...new Set(filteredEntities.flatMap((e) => e.process_ids))];

    // Build deduplicated tech metric queries needed for the visible entities (keyed by metricKey)
    const techQueryDefs = new Map<string, { def: TechMetricDef; entityIds: string[] }>();
    for (const entity of filteredEntities) {
      for (const def of getTechMetrics(entity.tech_type)) {
        const ids = def.entityDim === "dt.entity.service"
          ? [entity.service_id]
          : entity.process_ids;
        const existing = techQueryDefs.get(def.metricKey);
        if (existing) {
          for (const id of ids) if (!existing.entityIds.includes(id)) existing.entityIds.push(id);
        } else {
          techQueryDefs.set(def.metricKey, { def, entityIds: [...ids] });
        }
      }
    }
    const techQueryEntries = [...techQueryDefs.entries()];

    const loadTestMetrics = async (test: TestExecution) => {
      const { test_start: from, test_end: to } = test;
      const svcList = serviceIds.map((id) => `"${id}"`).join(", ");
      const pidList = processIds.map((id) => `"${id}"`).join(", ");

      const svcDql = (
        `timeseries { avg_rt = avg(dt.service.request.response_time), ` +
        `p90_rt = percentile(dt.service.request.response_time, 90), ` +
        `requests = sum(dt.service.request.count), ` +
        `errors = sum(dt.service.request.failure_count) }, ` +
        `from: "${from}", to: "${to}", by: { dt.entity.service } ` +
        `| filter in(dt.entity.service, {${svcList}})`
      );
      const cpuDql = (
        `timeseries cpu = avg(dt.process.cpu.usage), ` +
        `from: "${from}", to: "${to}", by: { dt.entity.process_group_instance } ` +
        `| filter in(dt.entity.process_group_instance, {${pidList}})`
      );
      const memScalarDql = (
        `timeseries mem = avg(dt.process.memory.usage), ` +
        `from: "${from}", to: "${to}", by: { dt.entity.process_group_instance } ` +
        `| filter in(dt.entity.process_group_instance, {${pidList}})`
      );

      // Tech-specific scalar queries (one per unique metric key)
      const techDqls = techQueryEntries.map(([, { def, entityIds }]) => {
        const agg = def.aggregation === "sum" ? "sum" : "avg";
        const idList = entityIds.map((id) => `"${id}"`).join(", ");
        return (
          `timeseries val = ${agg}(\`${def.metricKey}\`), ` +
          `from: "${from}", to: "${to}", by: { ${def.entityDim} } ` +
          `| filter in(${def.entityDim}, {${idList}})`
        );
      });

      const [svcRes, cpuRes, memRes, ...techResults] = await Promise.allSettled([
        queryExecutionClient.queryExecute({ body: { query: svcDql, requestTimeoutMilliseconds: 30000 } }),
        queryExecutionClient.queryExecute({ body: { query: cpuDql, requestTimeoutMilliseconds: 30000 } }),
        queryExecutionClient.queryExecute({ body: { query: memScalarDql, requestTimeoutMilliseconds: 30000 } }),
        ...techDqls.map((q) => queryExecutionClient.queryExecute({ body: { query: q, requestTimeoutMilliseconds: 30000 } })),
      ]);

      const svcByEntity = new Map<string, { avgRt: number | null; p90Rt: number | null; requests: number | null; errors: number | null }>();
      if (svcRes.status === "fulfilled") {
        for (const rec of (svcRes.value.result?.records ?? []) as Record<string, unknown>[]) {
          const id = rec["dt.entity.service"] as string;
          svcByEntity.set(id, {
            avgRt:    arrAvg(rec["avg_rt"]   as (number | null)[]),
            p90Rt:    arrAvg(rec["p90_rt"]   as (number | null)[]),
            requests: arrSum(rec["requests"] as (number | null)[]),
            errors:   arrSum(rec["errors"]   as (number | null)[]),
          });
        }
      }

      const cpuByEntity = new Map<string, number | null>();
      if (cpuRes.status === "fulfilled") {
        for (const rec of (cpuRes.value.result?.records ?? []) as Record<string, unknown>[]) {
          const id = rec["dt.entity.process_group_instance"] as string;
          cpuByEntity.set(id, arrAvg(rec["cpu"] as (number | null)[]));
        }
      }

      const memByEntity = new Map<string, number | null>();
      if (memRes.status === "fulfilled") {
        for (const rec of (memRes.value.result?.records ?? []) as Record<string, unknown>[]) {
          const id = rec["dt.entity.process_group_instance"] as string;
          memByEntity.set(id, arrAvg(rec["mem"] as (number | null)[]));
        }
      }

      // Build tech metric value maps: metricKey → entityId → scalar average
      const techValueMaps = new Map<string, Map<string, number | null>>();
      techQueryEntries.forEach(([metricKey, { def }], i) => {
        const res = techResults[i];
        if (res.status !== "fulfilled") return;
        const valueMap = new Map<string, number | null>();
        for (const rec of (res.value.result?.records ?? []) as Record<string, unknown>[]) {
          const entityId = rec[def.entityDim] as string;
          const raw = arrAvg(rec["val"] as (number | null)[]);
          const converted = raw != null && def.bytesToMiB ? raw / (1024 * 1024) : raw;
          valueMap.set(entityId, converted);
        }
        techValueMaps.set(metricKey, valueMap);
      });

      return { test, svcByEntity, cpuByEntity, memByEntity, techValueMaps };
    };

    Promise.all(allTests.map(loadTestMetrics)).then((results) => {
      const newMap = new Map<string, EntityMetrics>();
      for (const { test, svcByEntity, cpuByEntity, memByEntity, techValueMaps } of results) {
        for (const entity of filteredEntities) {
          const key = `${test.te_uuid}:::${entity.service_id}`;
          const svc = svcByEntity.get(entity.service_id);
          const procAvg = (byEntity: Map<string, number | null>) => {
            const vals = entity.process_ids.map((pid) => byEntity.get(pid)).filter((v): v is number => v != null);
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          };
          const requests = svc?.requests ?? null;
          const errors   = svc?.errors   ?? null;

          // Compute tech metric scalars for this entity
          const techMetrics: Record<string, number | null> = {};
          for (const def of getTechMetrics(entity.tech_type)) {
            const valueMap = techValueMaps.get(def.metricKey);
            if (!valueMap) { techMetrics[def.metricKey] = null; continue; }
            if (def.entityDim === "dt.entity.service") {
              techMetrics[def.metricKey] = valueMap.get(entity.service_id) ?? null;
            } else {
              const vals = entity.process_ids.map((pid) => valueMap.get(pid)).filter((v): v is number => v != null);
              techMetrics[def.metricKey] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
            }
          }

          newMap.set(key, {
            avgRtMs:      svc?.avgRt != null ? svc.avgRt * US_TO_MS : null,
            p90RtMs:      svc?.p90Rt != null ? svc.p90Rt * US_TO_MS : null,
            requestCount: requests,
            errorCount:   errors,
            errorRatePct: requests != null && requests > 0 && errors != null ? (errors / requests) * 100 : null,
            cpuPct:       procAvg(cpuByEntity),
            memoryMb:     (() => { const v = procAvg(memByEntity); return v != null ? v / (1024 * 1024) : null; })(),
            techMetrics,
          });
        }
      }
      setMetricsMap(newMap);
      setMetricsLoading(false);
    });
  }, [filteredEntities, primaryTest, compareTests]);

  // Load all detail metric timeseries when a row is selected
  useEffect(() => {
    if (!activeKey || !primaryTest) {
      setDetailCharts([]);
      setProcessBreakdown([]);
      setTestLabels([]);
      setHiddenLabels(new Set());
      return;
    }
    const entity = filteredEntities.find((e) => e.entityKey === activeKey);
    if (!entity) return;

    setDetailLoading(true);
    setHiddenLabels(new Set());
    const allTests: TestExecution[] = [primaryTest, ...compareTests];
    const labelFor = (test: TestExecution, i: number) =>
      i === 0 ? "Primary" : new Date(test.test_start).toLocaleDateString();

    setTestLabels(allTests.map((t, i) => labelFor(t, i)));

    const techDefs = getTechMetrics(entity.tech_type);

    const loadTestDetail = async (test: TestExecution, testIdx: number) => {
      const { test_start: from, test_end: to } = test;
      const label = labelFor(test, testIdx);
      const exec = (q: string) =>
        queryExecutionClient.queryExecute({ body: { query: q, requestTimeoutMilliseconds: 30000 } }).catch(() => null);

      const [svcRes, cpuRes, memRes, ...techResults] = await Promise.all([
        exec(svcDetailDql(entity.service_id, from, to)),
        exec(cpuDetailDql(entity.process_ids, from, to)),
        exec(memDetailDql(entity.process_ids, from, to)),
        ...techDefs.map((def) => exec(techMetricDetailDql(def, entity, from, to))),
      ]);

      const svcRec  = (svcRes?.result?.records ?? [])[0] as Record<string, unknown> | undefined;
      const cpuRecs = (cpuRes?.result?.records ?? []) as Record<string, unknown>[];
      const memRecs = (memRes?.result?.records ?? []) as Record<string, unknown>[];

      return { label, test, svcRec, cpuRecs, memRecs, techResults };
    };

    Promise.all(allTests.map((t, i) => loadTestDetail(t, i))).then((results) => {
      const rtSeries:        Timeseries[] = [];
      const requestSeries:   Timeseries[] = [];
      const errorSeries:     Timeseries[] = [];
      const errorRateSeries: Timeseries[] = [];
      const cpuSeries:       Timeseries[] = [];
      const memorySeries:    Timeseries[] = [];
      const techSeriesMap:   Timeseries[][] = techDefs.map(() => []);

      for (const { label, test, svcRec, cpuRecs, memRecs, techResults } of results) {
        if (svcRec) {
          for (const [field, suffix] of [
            ["avg_rt", "Avg RT"], ["p50", "P50"], ["p90", "P90"], ["p99", "P99"],
          ] as [string, string][]) {
            const pts = toAbsoluteSeries(svcRec, field, US_TO_MS, test.test_start);
            if (pts.length) rtSeries.push({ name: `${label} – ${suffix}`, unit: "ms", datapoints: pts });
          }

          const reqArr = svcRec["requests"] as (number | null)[] | undefined ?? [];
          const errArr = svcRec["errors"]   as (number | null)[] | undefined ?? [];
          const tf     = svcRec["timeframe"] as { start?: string } | undefined;
          const origin = tf?.start ? new Date(tf.start).getTime() : new Date(test.test_start).getTime();
          const intMs  = Number(svcRec["interval"]) / 1_000_000;

          const reqPts = toAbsoluteSeries(svcRec, "requests", 1, test.test_start);
          if (reqPts.length) requestSeries.push({ name: label, datapoints: reqPts });

          const errPts = toAbsoluteSeries(svcRec, "errors", 1, test.test_start);
          if (errPts.length) errorSeries.push({ name: label, datapoints: errPts });

          const ratePts = reqArr
            .map((req, i) => {
              const err = errArr[i];
              if (req == null || req === 0) return null;
              return { start: new Date(origin + i * intMs), value: ((err ?? 0) / req) * 100 };
            })
            .filter((p): p is { start: Date; value: number } => p != null);
          if (ratePts.length) errorRateSeries.push({ name: label, unit: "%", datapoints: ratePts });
        }

        const cpuPts = averageSeriesRecords(cpuRecs, "cpu", 1, test.test_start);
        if (cpuPts.length) cpuSeries.push({ name: label, unit: "%", datapoints: cpuPts });

        const memPts = averageSeriesRecords(memRecs, "mem", 1 / (1024 * 1024), test.test_start);
        if (memPts.length) memorySeries.push({ name: label, unit: "MiB", datapoints: memPts });

        techResults.forEach((res, ti) => {
          const recs = (res?.result?.records ?? []) as Record<string, unknown>[];
          const def  = techDefs[ti];
          const mult = def.bytesToMiB ? 1 / (1024 * 1024) : 1;
          const pts  = averageSeriesRecords(recs, "val", mult, test.test_start);
          if (pts.length) techSeriesMap[ti].push({ name: label, unit: def.unit, datapoints: pts });
        });
      }

      const techCharts: ChartPanel[] = techDefs
        .map((def, i) => ({ signal: def.signal, title: def.label, yLabel: def.unit, series: techSeriesMap[i] }))
        .filter((c) => c.series.length > 0);

      const charts: ChartPanel[] = ([
        { signal: 'latency'    as const, title: "Response Time",  yLabel: "ms",  series: rtSeries },
        { signal: 'traffic'    as const, title: "Request Count",                 series: requestSeries },
        { signal: 'errors'     as const, title: "Error Count",                   series: errorSeries },
        { signal: 'errors'     as const, title: "Error Rate",     yLabel: "%",   series: errorRateSeries },
        { signal: 'saturation' as const, title: "CPU Usage",      yLabel: "%",   series: cpuSeries },
        { signal: 'saturation' as const, title: "Process Memory", yLabel: "MiB", series: memorySeries },
        ...techCharts,
      ] as ChartPanel[]).filter((c) => c.series.length > 0);

      setDetailCharts(charts);

      // Per-process breakdown from primary test (index 0)
      const pr = results[0];
      if (pr) {
        const breakdown = entity.process_ids.map((pid) => {
          const cpuRec = pr.cpuRecs.find((r) => (r["dt.entity.process_group_instance"] as string) === pid);
          const memRec = pr.memRecs.find((r) => (r["dt.entity.process_group_instance"] as string) === pid);
          const memVal = memRec ? arrAvg(memRec["mem"] as (number | null)[]) : null;
          return {
            pid,
            cpuPct:   cpuRec ? arrAvg(cpuRec["cpu"] as (number | null)[]) : null,
            memoryMb: memVal != null ? memVal / (1024 * 1024) : null,
          };
        });
        setProcessBreakdown(breakdown);
      } else {
        setProcessBreakdown([]);
      }

      setDetailLoading(false);
    });
  }, [activeKey, primaryTest, compareTests, filteredEntities]);

  // Build display rows
  const rows = useMemo<InfraRow[]>(() => {
    if (!primaryTest) return [];
    return filteredEntities.map((entity) => {
      const primaryKey = `${primaryTest.te_uuid}:::${entity.service_id}`;
      const compareMets = compareTests
        .map((t) => metricsMap.get(`${t.te_uuid}:::${entity.service_id}`))
        .filter(Boolean) as EntityMetrics[];
      return {
        ...entity,
        primary:    metricsMap.get(primaryKey) ?? nullMetrics(),
        compareAvg: avgMetricsList(compareMets),
      };
    });
  }, [filteredEntities, metricsMap, primaryTest, compareTests]);

  // Shift series so first datapoint = local midnight (elapsed time mode)
  const displayCharts = useMemo<ChartPanel[]>(() => {
    if (!normalizeTime || detailCharts.length === 0) return detailCharts;
    const refMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    return detailCharts.map((chart) => ({
      ...chart,
      series: chart.series.map((s) => {
        if (s.datapoints.length === 0) return s;
        const shift = refMs - s.datapoints[0].start.getTime();
        return {
          ...s,
          datapoints: s.datapoints.map((pt) => ({
            start: new Date(pt.start.getTime() + shift),
            value: pt.value,
          })),
        };
      }),
    }));
  }, [detailCharts, normalizeTime]);

  // Filter out hidden series (exact match for single-line charts, prefix match for RT sub-series)
  const filteredDisplayCharts = useMemo<ChartPanel[]>(() => {
    if (hiddenLabels.size === 0) return displayCharts;
    return displayCharts
      .map((chart) => ({
        ...chart,
        series: chart.series.filter((s) => {
          const name = Array.isArray(s.name) ? (s.name as string[]).join("") : (s.name as string);
          if (hiddenLabels.has(name)) return false;
          return ![...hiddenLabels].some((lbl) => name.startsWith(lbl + " –"));
        }),
      }))
      .filter((c) => c.series.length > 0);
  }, [displayCharts, hiddenLabels]);

  // Which unique tech metric defs have at least one non-null value in the current primary data
  const activeTechDefs = useMemo<TechMetricDef[]>(() => {
    if (rows.length === 0) return [];
    const activeKeys = new Set<string>();
    for (const row of rows) {
      for (const [key, val] of Object.entries(row.primary.techMetrics)) {
        if (val != null) activeKeys.add(key);
      }
    }
    return ALL_UNIQUE_TECH_DEFS.filter((def) => activeKeys.has(def.metricKey));
  }, [rows]);

  const hasCompare = compareTests.length > 0;
  const fmtMs     = (v: number) => `${v.toFixed(1)} ms`;
  const fmtPct    = (v: number) => `${v.toFixed(1)}%`;
  const fmtErrPct = (v: number) => `${v.toFixed(2)}%`;
  const fmtCount  = (v: number) => Math.round(v).toLocaleString();
  const fmtMiB    = (v: number) => `${v.toFixed(0)} MiB`;
  const fmtTech   = (v: number, def: TechMetricDef): string => {
    if (def.unit === "%")   return `${v.toFixed(1)}%`;
    if (def.unit === "ms")  return `${v.toFixed(1)} ms`;
    if (def.unit === "MiB") return `${v.toFixed(0)} MiB`;
    return v.toFixed(1);
  };

  const baseColumns: DataTableColumnDef<InfraRow>[] = [
    {
      id: "select",
      header: "",
      accessor: "entityKey",
      width: "content",
      disableSorting: true,
      cell: ({ value }) => (
        <button
          onClick={() => setActiveKey(activeKey === value ? null : value as string)}
          title={activeKey === value ? "Hide detail" : "Show detail chart"}
          style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px", color: activeKey === value ? "#6e91e6" : "#636670", fontSize: "0.9em" }}
        >
          {activeKey === value ? "▼" : "▶"}
        </button>
      ),
    },
    {
      id: "entity",
      header: "Service / Process",
      accessor: "process_exe",
      width: "auto",
      cell: ({ value, rowData }) => (
        <div style={{ padding: "4px 12px 4px 0" }}>
          <div style={{ fontWeight: 500 }}>
            {String(value)}
            {rowData.process_ids.length > 1 && (
              <span style={{ fontSize: "0.75em", color: "#8e9099", marginLeft: "6px" }}>
                ({rowData.process_ids.length} processes)
              </span>
            )}
          </div>
          {serviceNameMap.get(rowData.service_id) && (
            <div style={{ fontSize: "0.8em", color: "#c8ccd4" }}>
              {serviceNameMap.get(rowData.service_id)}
            </div>
          )}
          <div style={{ fontSize: "0.72em", color: "#636670", fontFamily: "monospace" }}>
            {rowData.service_id}
          </div>
        </div>
      ),
    },
    {
      id: "tech_type",
      header: "Tech",
      accessor: "tech_type",
      width: "content",
      cell: ({ value }) => (
        <div style={{ padding: "0 12px" }}>
          <span style={{ fontSize: "0.75em", fontWeight: 600, padding: "2px 6px", background: "rgba(110,145,230,0.15)", borderRadius: "4px", whiteSpace: "nowrap" }}>
            {String(value)}
          </span>
        </div>
      ),
    },
    {
      id: "avg_rt",
      header: "Avg RT",
      accessor: "primary",
      width: "content",
      minWidth: 100,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.avgRtMs,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.avgRtMs} compare={hasCompare ? rowData.compareAvg.avgRtMs : null} fmt={fmtMs} threshold={settings.thresholds.responseTime} />
        </div>
      ),
    },
    {
      id: "p90_rt",
      header: "P90 RT",
      accessor: "primary",
      width: "content",
      minWidth: 100,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.p90RtMs,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.p90RtMs} compare={hasCompare ? rowData.compareAvg.p90RtMs : null} fmt={fmtMs} threshold={settings.thresholds.responseTime} />
        </div>
      ),
    },
    {
      id: "cpu",
      header: "CPU %",
      accessor: "primary",
      width: "content",
      minWidth: 90,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.cpuPct,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.cpuPct} compare={hasCompare ? rowData.compareAvg.cpuPct : null} fmt={fmtPct} threshold={settings.thresholds.cpu} />
        </div>
      ),
    },
    {
      id: "requests",
      header: "Requests",
      accessor: "primary",
      width: "content",
      minWidth: 100,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.requestCount,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.requestCount} compare={hasCompare ? rowData.compareAvg.requestCount : null} fmt={fmtCount} betterIsLower={false} threshold={settings.thresholds.requestCount} />
        </div>
      ),
    },
    {
      id: "errors",
      header: "Errors",
      accessor: "primary",
      width: "content",
      minWidth: 90,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.errorCount,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.errorCount} compare={hasCompare ? rowData.compareAvg.errorCount : null} fmt={fmtCount} threshold={settings.thresholds.errorCount} />
        </div>
      ),
    },
    {
      id: "error_rate",
      header: "Err %",
      accessor: "primary",
      width: "content",
      minWidth: 90,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.errorRatePct,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.errorRatePct} compare={hasCompare ? rowData.compareAvg.errorRatePct : null} fmt={fmtErrPct} threshold={settings.thresholds.errorRate} />
        </div>
      ),
    },
    {
      id: "memory",
      header: "Memory",
      accessor: "primary",
      width: "content",
      minWidth: 100,
      sortType: 'number',
      sortAccessor: (row: InfraRow) => row.primary.memoryMb,
      cell: ({ rowData }) => (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={rowData.primary.memoryMb} compare={hasCompare ? rowData.compareAvg.memoryMb : null} fmt={fmtMiB} threshold={settings.thresholds.memory} />
        </div>
      ),
    },
  ];

  // Dynamic columns for tech-specific metrics that have data in the current view
  const techColumns: DataTableColumnDef<InfraRow>[] = activeTechDefs.map((def) => ({
    id: `tech_${def.metricKey}`,
    header: def.label + (def.unit ? ` (${def.unit})` : ""),
    accessor: "primary" as const,
    width: "content" as const,
    minWidth: 100,
    sortType: 'number' as const,
    sortAccessor: (row: InfraRow) => row.primary.techMetrics[def.metricKey] ?? null,
    cell: ({ rowData }: { rowData: InfraRow }) => {
      const primary = rowData.primary.techMetrics[def.metricKey] ?? null;
      const compare = hasCompare ? (rowData.compareAvg.techMetrics[def.metricKey] ?? null) : null;
      const betterIsLower = def.betterIsLower !== false;
      const threshold = settings.techThresholds[def.metricKey] ?? { relEnabled: true, relPct: 50, staticEnabled: false, staticValue: 0, combination: 'or' as const };
      return (
        <div style={{ padding: "0 12px" }}>
          <DeltaCell primary={primary} compare={compare} fmt={(v) => fmtTech(v, def)} betterIsLower={betterIsLower} threshold={threshold} />
        </div>
      );
    },
  }));

  const columns = [...baseColumns, ...techColumns];

  const infraColDefs: ColPickerDef[] = useMemo(() => [
    ...INFRA_BASE_COL_DEFS,
    ...activeTechDefs.map(def => ({ id: `tech_${def.metricKey}`, label: def.label + (def.unit ? ` (${def.unit})` : "") })),
  ], [activeTechDefs]);

  const visibleColumns = columns.filter(c => c.id === "select" || !hiddenCols.has(c.id));

  const rowThresholds = rows.length > 0 && hasCompare
    ? [{
        comparator: (row: InfraRow) => {
          const p = row.primary;
          const c = row.compareAvg;
          const { thresholds } = settings;
          return (
            isWorse(p.avgRtMs,     c.avgRtMs,     true, thresholds.responseTime) ||
            isWorse(p.cpuPct,      c.cpuPct,      true, thresholds.cpu) ||
            isWorse(p.errorRatePct, c.errorRatePct, true, thresholds.errorRate) ||
            isWorse(p.memoryMb,    c.memoryMb,    true, thresholds.memory)
          );
        },
        type: "highlight" as const,
        backgroundColor: "rgba(232,50,62,0.08)",
      }]
    : undefined;

  const activeRow = activeKey ? rows.find((r) => r.entityKey === activeKey) ?? null : null;

  if (!primaryTest) return null;

  const isLoading = servicesLoading || metricsLoading;

  return (
    <Flex flexDirection="column" gap={12} style={{ padding: "16px" }}>
      {/* Filters */}
      <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
        <div style={{ width: "280px" }}>
          <Select<string, true>
            multiple={true}
            value={filterSteps}
            onChange={(v) => { setFilterSteps(v ?? []); setActiveKey(null); }}
            disabled={servicesLoading}
          >
            <Select.Trigger placeholder="All test steps" width="full" />
            <Select.Content>
              <Select.Filter />
              {uniqueSteps.map((s) => <Select.Option key={s} value={s}>{normalizeNaKeptn(s)}</Select.Option>)}
            </Select.Content>
          </Select>
        </div>
        <div style={{ width: "200px" }}>
          <Select<string, true>
            multiple={true}
            value={filterScripts}
            onChange={(v) => { setFilterScripts(v ?? []); setActiveKey(null); }}
            disabled={servicesLoading}
          >
            <Select.Trigger placeholder="All scripts" width="full" />
            <Select.Content>
              <Select.Filter />
              {uniqueScripts.map((s) => <Select.Option key={s} value={s}>{s}</Select.Option>)}
            </Select.Content>
          </Select>
        </div>
        <div style={{ width: "280px" }}>
          <Select<string, true>
            multiple={true}
            value={filterRequests}
            onChange={(v) => { setFilterRequests(v ?? []); setActiveKey(null); }}
            disabled={servicesLoading}
          >
            <Select.Trigger placeholder="All requests" width="full" />
            <Select.Content>
              <Select.Filter />
              {uniqueRequests.map((r) => <Select.Option key={r} value={r}>{r}</Select.Option>)}
            </Select.Content>
          </Select>
        </div>
        <div style={{ width: "200px" }}>
          <Select<string, true>
            multiple={true}
            value={filterZones}
            onChange={(v) => { setFilterZones(v ?? []); setActiveKey(null); }}
            disabled={servicesLoading}
          >
            <Select.Trigger placeholder="All zones" width="full" />
            <Select.Content>
              <Select.Filter />
              {uniqueZones.map((z) => <Select.Option key={z} value={z}>{z}</Select.Option>)}
            </Select.Content>
          </Select>
        </div>
        {(filterSteps.length > 0 || filterRequests.length > 0 || filterScripts.length > 0 || filterZones.length > 0) && (
          <span
            style={{ fontSize: "0.8em", color: "#8e9099", cursor: "pointer", whiteSpace: "nowrap" }}
            onClick={() => { clearFilters(); setActiveKey(null); }}
          >
            Clear filters ({rows.length} service{rows.length !== 1 ? "s" : ""})
          </span>
        )}
        {hasCompare && (
          <span style={{ fontSize: "0.8em", color: "#8e9099", marginLeft: "auto" }}>
            Red delta = regression vs {compareTests.length} comparison test{compareTests.length > 1 ? "s" : ""}
          </span>
        )}
        <div style={{ marginLeft: hasCompare ? "0" : "auto" }}>
          <ColumnPicker defs={infraColDefs} hidden={hiddenCols} onChange={setHiddenCols} />
        </div>
      </Flex>

      {/* States */}
      {isLoading && <Text style={{ color: "#8e9099" }}>Loading infrastructure data…</Text>}

      {!isLoading && allParsedEntities.length === 0 && (
        <Text style={{ color: "#8e9099" }}>
          No infrastructure data for this test. Run the workflow to ingest service business events.
        </Text>
      )}

      {/* Main table */}
      {!isLoading && rows.length > 0 && (
        <>
          <DataTable
            data={rows}
            columns={visibleColumns}
            fullWidth
            sortable
            rowThresholds={rowThresholds}
          >
            <DataTable.Pagination defaultPageSize={10} />
          </DataTable>

          {/* Detail metric charts for selected row */}
          {activeRow && (
            <Surface style={{ padding: "16px" }}>
              <Flex flexDirection="column" gap={16}>
                <Flex alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={8}>
                  <Flex alignItems="baseline" gap={8} flexWrap="wrap">
                    <Heading level={5} style={{ margin: 0 }}>
                      {activeRow.process_exe} ({activeRow.tech_type})
                    </Heading>
                    {serviceNameMap.get(activeRow.service_id) && (
                      <span style={{ fontSize: "0.8em", color: "#c8ccd4" }}>
                        {serviceNameMap.get(activeRow.service_id)}
                      </span>
                    )}
                    <span style={{ fontSize: "0.8em", color: "#8e9099", fontFamily: "monospace" }}>
                      {activeRow.service_id}
                    </span>
                    {activeRow.process_ids.length > 1 && (
                      <span style={{ fontSize: "0.8em", color: "#8e9099" }}>
                        · {activeRow.process_ids.length} processes
                      </span>
                    )}
                  </Flex>
                  <Flex alignItems="center" gap={8}>
                    <Text textStyle="small" style={{ color: "#8e9099", whiteSpace: "nowrap" }}>
                      Absolute time
                    </Text>
                    <Switch value={!normalizeTime} onChange={(v) => setNormalizeTime(!v)} />
                  </Flex>
                </Flex>
                <Text textStyle="small" style={{ color: "#8e9099" }}>
                  {normalizeTime
                    ? "Elapsed time: tick marks are 1-minute intervals. All tests are shifted to overlap (12:00 AM = 0 min, 12:01 AM = 1 min, …)."
                    : `Primary window: ${new Date(activeRow.test_start).toLocaleString()} – ${new Date(activeRow.test_end).toLocaleString()}. Comparison tests show their own time windows.`}
                </Text>

                {/* Series selector */}
                {!detailLoading && testLabels.length > 1 && (
                  <Flex gap={8} alignItems="center" flexWrap="wrap">
                    <Text textStyle="small" style={{ color: "#8e9099", whiteSpace: "nowrap" }}>Show series:</Text>
                    {testLabels.map((label, i) => {
                      const visible = !hiddenLabels.has(label);
                      return (
                        <button
                          key={label}
                          onClick={() =>
                            setHiddenLabels((prev) => {
                              const next = new Set(prev);
                              if (next.has(label)) next.delete(label);
                              else next.add(label);
                              return next;
                            })
                          }
                          style={{
                            fontSize: "0.8em",
                            padding: "3px 10px",
                            borderRadius: "12px",
                            border: `1px solid ${visible ? (i === 0 ? "#6e91e6" : "rgba(255,255,255,0.3)") : "rgba(255,255,255,0.1)"}`,
                            background: visible ? (i === 0 ? "rgba(110,145,230,0.18)" : "rgba(255,255,255,0.07)") : "transparent",
                            color: visible ? (i === 0 ? "#6e91e6" : "#c8ccd4") : "#555a65",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            transition: "all 0.1s",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {hiddenLabels.size > 0 && (
                      <span
                        style={{ fontSize: "0.78em", color: "#8e9099", cursor: "pointer", userSelect: "none" }}
                        onClick={() => setHiddenLabels(new Set())}
                      >
                        Show all
                      </span>
                    )}
                  </Flex>
                )}

                {detailLoading && <Text style={{ color: "#8e9099" }}>Loading metrics…</Text>}

                {/* Per-process breakdown */}
                {!detailLoading && processBreakdown.length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "0.72em", fontWeight: 700, color: "#6e91e6", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Process Breakdown
                      </span>
                      <div style={{ flex: 1, height: "1px", background: "rgba(110,145,230,0.25)" }} />
                    </div>
                    <table style={{ borderCollapse: "collapse", fontSize: "0.85em" }}>
                      <thead>
                        <tr>
                          {["Process", "CPU %", "Memory"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "4px 24px 4px 0", color: "#8e9099", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: "0.85em" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {processBreakdown.map((p) => (
                          <tr key={p.pid}>
                            <td style={{ padding: "5px 24px 5px 0" }}>
                              {processNameMap.get(p.pid) && (
                                <div style={{ fontSize: "0.95em", color: "#c8ccd4" }}>
                                  {processNameMap.get(p.pid)}
                                </div>
                              )}
                              <div style={{ fontFamily: "monospace", fontSize: "0.88em", color: processNameMap.get(p.pid) ? "#636670" : "#c8ccd4" }}>
                                {p.pid}
                              </div>
                            </td>
                            <td style={{ padding: "5px 24px 5px 0" }}>
                              {p.cpuPct != null ? fmtPct(p.cpuPct) : "—"}
                            </td>
                            <td style={{ padding: "5px 0" }}>
                              {p.memoryMb != null ? fmtMiB(p.memoryMb) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!detailLoading && filteredDisplayCharts.length === 0 && (
                  <Text style={{ color: "#8e9099" }}>
                    {hiddenLabels.size > 0
                      ? "All series are hidden — click a series button above to show data."
                      : "No metric data found for this service during the test window."}
                  </Text>
                )}

                {!detailLoading && filteredDisplayCharts.length > 0 && (() => {
                  const bySignal = SIGNAL_ORDER.map((sig) => ({
                    sig,
                    charts: filteredDisplayCharts.filter((c) => c.signal === sig),
                  })).filter((g) => g.charts.length > 0);

                  return (
                    <Flex flexDirection="column" gap={24}>
                      {bySignal.map(({ sig, charts }) => (
                        <div key={sig}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <span style={{ fontSize: "0.72em", fontWeight: 700, color: "#6e91e6", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                              {SIGNAL_LABELS[sig]}
                            </span>
                            <div style={{ flex: 1, height: "1px", background: "rgba(110,145,230,0.25)" }} />
                          </div>

                          <Flex flexDirection="column" gap={12}>
                            {/* First Latency chart (Response Time) is full-width */}
                            {charts.map((chart, i) => {
                              const isFullWidth = sig === 'latency' && i === 0;
                              return isFullWidth ? (
                                <div key={i}>
                                  <Text style={{ fontSize: "0.75em", fontWeight: 600, color: "#8e9099", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                                    {chart.title}
                                  </Text>
                                  <TimeseriesChart height={240}>
                                    {chart.series.map((s) => (
                                      <TimeseriesChart.Line key={Array.isArray(s.name) ? s.name.join("-") : s.name} data={s} gapPolicy="connect" />
                                    ))}
                                    <TimeseriesChart.Legend />
                                    {chart.yLabel && <TimeseriesChart.YAxis label={chart.yLabel} />}
                                    {normalizeTime && <TimeseriesChart.XAxis label="Elapsed time (min)" />}
                                    <TimeseriesChart.Tooltip />
                                  </TimeseriesChart>
                                </div>
                              ) : null;
                            })}

                            {/* Remaining charts in a 2-column grid */}
                            {(() => {
                              const gridCharts = sig === 'latency' ? charts.slice(1) : charts;
                              if (gridCharts.length === 0) return null;
                              return (
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "12px" }}>
                                  {gridCharts.map((chart, i) => (
                                    <div key={i}>
                                      <Text style={{ fontSize: "0.75em", fontWeight: 600, color: "#8e9099", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                                        {chart.title}{chart.yLabel ? ` (${chart.yLabel})` : ""}
                                      </Text>
                                      <TimeseriesChart height={180}>
                                        {chart.series.map((s) => (
                                          <TimeseriesChart.Line key={Array.isArray(s.name) ? s.name.join("-") : s.name} data={s} gapPolicy="connect" />
                                        ))}
                                        <TimeseriesChart.Legend />
                                        {chart.yLabel && <TimeseriesChart.YAxis label={chart.yLabel} />}
                                        {normalizeTime && <TimeseriesChart.XAxis label="Elapsed time (min)" />}
                                        <TimeseriesChart.Tooltip />
                                      </TimeseriesChart>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </Flex>
                        </div>
                      ))}
                    </Flex>
                  );
                })()}
              </Flex>
            </Surface>
          )}
        </>
      )}
    </Flex>
  );
};
