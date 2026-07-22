import React, { useEffect, useMemo, useState } from "react";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components/forms";
import { TimeseriesChart } from "@dynatrace/strato-components/charts";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { useSelectedTest } from "../context/SelectedTestContext";
import type { TestExecution } from "../context/SelectedTestContext";
import { getKeySaturation, getExtraSaturation, type TechMetricDef } from "../utils/infraMetricConfig";

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
  na_keptn: string;
  request?: string;
  zone?: string;
  test_start: string;
  test_end: string;
  services: string; // JSON string of ServiceEntity[]
}

interface ParsedEntity extends ServiceEntity {
  na_keptn: string;
  request: string;
  zone: string;
  test_start: string;
  test_end: string;
}

interface EntityMetrics {
  avgRtMs: number | null;
  p90RtMs: number | null;
  requestCount: number | null;
  errorCount: number | null;
  cpuPct: number | null;
}

interface InfraRow {
  entityKey: string;
  service_id: string;
  process_id_classic: string;
  process_exe: string;
  tech_type: string;
  na_keptn: string;
  request: string;
  zone: string;
  test_start: string;
  test_end: string;
  primary: EntityMetrics;
  compareAvg: EntityMetrics;
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
  return { avgRtMs: null, p90RtMs: null, requestCount: null, errorCount: null, cpuPct: null };
}

function avgMetricsList(list: EntityMetrics[]): EntityMetrics {
  if (list.length === 0) return nullMetrics();
  const avg = (field: keyof EntityMetrics) => {
    const vals = list.map((m) => m[field]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    avgRtMs:      avg("avgRtMs"),
    p90RtMs:      avg("p90RtMs"),
    requestCount: avg("requestCount"),
    errorCount:   avg("errorCount"),
    cpuPct:       avg("cpuPct"),
  };
}

// Normalize timeseries datapoints to elapsed milliseconds from test_start.
// Charts are then displayed with x-axis representing "time into test".
function toNormalizedSeries(
  record: Record<string, unknown>,
  field: string,
  multiplier: number,
  testStart: string
): { start: Date; value: number }[] {
  const arr = record[field] as (number | null)[] | undefined;
  if (!arr) return [];
  const testStartMs = new Date(testStart).getTime();
  const timeframe = record["timeframe"] as { start?: string } | undefined;
  const recStart = timeframe?.start ? new Date(timeframe.start).getTime() : testStartMs;
  const intervalMs = Number(record["interval"]) / 1_000_000; // ns → ms
  return arr
    .map((v, i) =>
      v != null ? { start: new Date(recStart + i * intervalMs - testStartMs), value: v * multiplier } : null
    )
    .filter((p): p is { start: Date; value: number } => p != null);
}

// Build service-level timeseries DQL scoped to a test window
function svcTimeseriesDql(serviceId: string, from: string, to: string): string {
  return (
    `timeseries { p50 = percentile(dt.service.request.response_time, 50), ` +
    `p90 = percentile(dt.service.request.response_time, 90), ` +
    `p99 = percentile(dt.service.request.response_time, 99) }, ` +
    `from: "${from}", to: "${to}", by: { dt.entity.service } ` +
    `| filter dt.entity.service == "${serviceId}"`
  );
}

// Build CPU timeseries DQL scoped to a test window
function cpuTimeseriesDql(processId: string, from: string, to: string): string {
  return (
    `timeseries cpu = avg(dt.process.cpu.usage), ` +
    `from: "${from}", to: "${to}", by: { dt.entity.process_group_instance } ` +
    `| filter dt.entity.process_group_instance == "${processId}"`
  );
}

// Build tech-specific metric timeseries DQL
function techMetricDql(def: TechMetricDef, entityId: string, from: string, to: string): string {
  const agg = def.aggregation === "sum" ? "sum" : "avg";
  return (
    `timeseries val = ${agg}(\`${def.metricKey}\`), ` +
    `from: "${from}", to: "${to}", by: { ${def.entityDim} } ` +
    `| filter ${def.entityDim} == "${entityId}"`
  );
}

// Build services bizevents query for a test
function servicesBizeventsQuery(teUuid: string): string {
  return `fetch bizevents, from: -365d | filter event.type == "neoload.services.detailed" | filter te_uuid == "${teUuid}"`;
}

// ── Delta cell ────────────────────────────────────────────────────────────────

const DeltaCell: React.FC<{
  primary: number | null;
  compare: number | null;
  fmt: (v: number) => string;
  betterIsLower?: boolean;
}> = ({ primary, compare, fmt, betterIsLower = true }) => {
  if (primary == null) return <span style={{ color: "#636670" }}>—</span>;
  const delta = compare != null ? primary - compare : null;
  const isWorse = delta != null && (betterIsLower ? delta > 0 : delta < 0);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      <span style={{ whiteSpace: "nowrap" }}>{fmt(primary)}</span>
      {delta != null && (
        <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap", color: isWorse ? COLOR_WORSE : undefined }}>
          {delta >= 0 ? "+" : ""}{fmt(delta)}
        </span>
      )}
    </div>
  );
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export const InfrastructurePanel: React.FC = () => {
  const { primaryTest, compareTests } = useSelectedTest();

  const [filterStep,    setFilterStep]    = useState<string | null>(null);
  const [filterRequest, setFilterRequest] = useState<string | null>(null);
  const [filterZone,    setFilterZone]    = useState<string | null>(null);
  const [activeKey,     setActiveKey]     = useState<string | null>(null);
  const [detailSeries,  setDetailSeries]  = useState<Timeseries[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Metric scalars: "${te_uuid}:::${service_id}:::${process_id_classic}" → EntityMetrics
  const [metricsMap,    setMetricsMap]    = useState<Map<string, EntityMetrics>>(new Map());
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Reset on primary test change
  useEffect(() => {
    setFilterStep(null);
    setFilterRequest(null);
    setFilterZone(null);
    setActiveKey(null);
    setMetricsMap(new Map());
    setDetailSeries([]);
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
        na_keptn:   rec.na_keptn,
        request:    rec.request ?? "—",
        zone:       rec.zone    ?? "—",
        test_start: rec.test_start,
        test_end:   rec.test_end,
      }))
    );
  }, [primaryServicesData]);

  // Filter options
  const uniqueSteps    = useMemo(() => [...new Set(allParsedEntities.map((e) => e.na_keptn))].sort(), [allParsedEntities]);
  const uniqueRequests = useMemo(() => [...new Set(allParsedEntities.map((e) => e.request).filter((r) => r !== "—"))].sort(), [allParsedEntities]);
  const uniqueZones    = useMemo(() => [...new Set(allParsedEntities.map((e) => e.zone).filter((z) => z !== "—"))].sort(), [allParsedEntities]);

  // Apply filters + deduplicate by service_id + process_id_classic
  const filteredEntities = useMemo<ParsedEntity[]>(() => {
    const filtered = allParsedEntities.filter(
      (e) =>
        (!filterStep    || e.na_keptn === filterStep) &&
        (!filterRequest || e.request  === filterRequest) &&
        (!filterZone    || e.zone     === filterZone)
    );
    const seen = new Set<string>();
    return filtered.filter((e) => {
      const key = `${e.service_id}:::${e.process_id_classic}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allParsedEntities, filterStep, filterRequest, filterZone]);

  // Load scalar metrics for all tests when filteredEntities / tests change
  useEffect(() => {
    if (!primaryTest || filteredEntities.length === 0) {
      setMetricsMap(new Map());
      return;
    }

    setMetricsLoading(true);
    const allTests: TestExecution[] = [primaryTest, ...compareTests];
    const serviceIds  = [...new Set(filteredEntities.map((e) => e.service_id))];
    const processIds  = [...new Set(filteredEntities.map((e) => e.process_id_classic))];

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

      const [svcRes, cpuRes] = await Promise.allSettled([
        queryExecutionClient.queryExecute({ body: { query: svcDql, requestTimeoutMilliseconds: 30000 } }),
        queryExecutionClient.queryExecute({ body: { query: cpuDql, requestTimeoutMilliseconds: 30000 } }),
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

      return { test, svcByEntity, cpuByEntity };
    };

    Promise.all(allTests.map(loadTestMetrics)).then((results) => {
      const newMap = new Map<string, EntityMetrics>();
      for (const { test, svcByEntity, cpuByEntity } of results) {
        for (const entity of filteredEntities) {
          const key = `${test.te_uuid}:::${entity.service_id}:::${entity.process_id_classic}`;
          const svc = svcByEntity.get(entity.service_id);
          newMap.set(key, {
            avgRtMs:      svc?.avgRt    != null ? svc.avgRt    * US_TO_MS : null,
            p90RtMs:      svc?.p90Rt   != null ? svc.p90Rt    * US_TO_MS : null,
            requestCount: svc?.requests ?? null,
            errorCount:   svc?.errors   ?? null,
            cpuPct:       cpuByEntity.get(entity.process_id_classic) ?? null,
          });
        }
      }
      setMetricsMap(newMap);
      setMetricsLoading(false);
    });
  }, [filteredEntities, primaryTest, compareTests]);

  // Load detail timeseries when a row is selected
  useEffect(() => {
    if (!activeKey || !primaryTest) {
      setDetailSeries([]);
      return;
    }
    const entity = filteredEntities.find(
      (e) => `${e.service_id}:::${e.process_id_classic}` === activeKey
    );
    if (!entity) return;

    setDetailLoading(true);
    const allTests: TestExecution[] = [primaryTest, ...compareTests];

    const labelFor = (test: TestExecution, i: number) =>
      i === 0 ? "Primary" : new Date(test.test_start).toLocaleDateString();

    Promise.all(
      allTests.map(async (test, i) => {
        const res = await queryExecutionClient.queryExecute({
          body: { query: svcTimeseriesDql(entity.service_id, test.test_start, test.test_end), requestTimeoutMilliseconds: 30000 },
        }).catch(() => null);
        const rec = (res?.result?.records ?? [])[0] as Record<string, unknown> | undefined;
        if (!rec) return [] as Timeseries[];
        return (["p50", "p90", "p99"] as const).map((p) => ({
          name: `${labelFor(test, i)} – ${p.toUpperCase()}`,
          unit: "ms",
          datapoints: toNormalizedSeries(rec, p, US_TO_MS, test.test_start),
        })).filter((s) => s.datapoints.length > 0);
      })
    ).then((all) => {
      setDetailSeries(all.flat());
      setDetailLoading(false);
    });
  }, [activeKey, primaryTest, compareTests, filteredEntities]);

  // Build display rows
  const rows = useMemo<InfraRow[]>(() => {
    if (!primaryTest) return [];
    return filteredEntities.map((entity) => {
      const primaryKey = `${primaryTest.te_uuid}:::${entity.service_id}:::${entity.process_id_classic}`;
      const compareMets = compareTests
        .map((t) => metricsMap.get(`${t.te_uuid}:::${entity.service_id}:::${entity.process_id_classic}`))
        .filter(Boolean) as EntityMetrics[];
      return {
        entityKey: `${entity.service_id}:::${entity.process_id_classic}`,
        ...entity,
        primary:    metricsMap.get(primaryKey) ?? nullMetrics(),
        compareAvg: avgMetricsList(compareMets),
      };
    });
  }, [filteredEntities, metricsMap, primaryTest, compareTests]);

  const hasCompare = compareTests.length > 0;
  const fmtMs   = (v: number) => `${v.toFixed(1)} ms`;
  const fmtPct  = (v: number) => `${v.toFixed(1)}%`;
  const fmtCount = (v: number) => Math.round(v).toLocaleString();

  const columns: DataTableColumnDef<InfraRow>[] = [
    {
      id: "select",
      header: "",
      accessor: "entityKey",
      width: "content",
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
        <div>
          <div style={{ fontWeight: 500 }}>{String(value)}</div>
          <div style={{ fontSize: "0.72em", color: "#636670", fontFamily: "monospace" }}>
            {rowData.service_id.slice(-20)}
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
        <span style={{ fontSize: "0.75em", fontWeight: 600, padding: "2px 6px", background: "rgba(110,145,230,0.15)", borderRadius: "4px", whiteSpace: "nowrap" }}>
          {String(value)}
        </span>
      ),
    },
    {
      id: "avg_rt",
      header: "Avg RT",
      accessor: "primary",
      width: "content",
      cell: ({ rowData }) => (
        <DeltaCell primary={rowData.primary.avgRtMs} compare={hasCompare ? rowData.compareAvg.avgRtMs : null} fmt={fmtMs} />
      ),
    },
    {
      id: "p90_rt",
      header: "P90 RT",
      accessor: "primary",
      width: "content",
      cell: ({ rowData }) => (
        <DeltaCell primary={rowData.primary.p90RtMs} compare={hasCompare ? rowData.compareAvg.p90RtMs : null} fmt={fmtMs} />
      ),
    },
    {
      id: "cpu",
      header: "CPU %",
      accessor: "primary",
      width: "content",
      cell: ({ rowData }) => (
        <DeltaCell primary={rowData.primary.cpuPct} compare={hasCompare ? rowData.compareAvg.cpuPct : null} fmt={fmtPct} />
      ),
    },
    {
      id: "requests",
      header: "Requests",
      accessor: "primary",
      width: "content",
      cell: ({ rowData }) => (
        <DeltaCell primary={rowData.primary.requestCount} compare={hasCompare ? rowData.compareAvg.requestCount : null} fmt={fmtCount} betterIsLower={false} />
      ),
    },
    {
      id: "errors",
      header: "Errors",
      accessor: "primary",
      width: "content",
      cell: ({ rowData }) => (
        <DeltaCell primary={rowData.primary.errorCount} compare={hasCompare ? rowData.compareAvg.errorCount : null} fmt={fmtCount} />
      ),
    },
  ];

  const rowThresholds = rows.length > 0 && hasCompare
    ? [{
        comparator: (row: InfraRow) => {
          const p = row.primary;
          const c = row.compareAvg;
          return (
            (p.avgRtMs != null && c.avgRtMs != null && p.avgRtMs > c.avgRtMs * 1.2) ||
            (p.cpuPct  != null && c.cpuPct  != null && p.cpuPct  > c.cpuPct  * 1.2) ||
            (p.errorCount != null && c.errorCount != null && p.errorCount > c.errorCount * 1.2)
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
          <Select<string>
            value={filterStep}
            onChange={(v) => { setFilterStep(v ?? null); setActiveKey(null); }}
            disabled={servicesLoading}
          >
            <Select.Trigger placeholder="All test steps" width="full" />
            <Select.Content>
              <Select.Filter />
              {uniqueSteps.map((s) => <Select.Option key={s} value={s}>{s}</Select.Option>)}
            </Select.Content>
          </Select>
        </div>
        <div style={{ width: "280px" }}>
          <Select<string>
            value={filterRequest}
            onChange={(v) => { setFilterRequest(v ?? null); setActiveKey(null); }}
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
          <Select<string>
            value={filterZone}
            onChange={(v) => { setFilterZone(v ?? null); setActiveKey(null); }}
            disabled={servicesLoading}
          >
            <Select.Trigger placeholder="All zones" width="full" />
            <Select.Content>
              <Select.Filter />
              {uniqueZones.map((z) => <Select.Option key={z} value={z}>{z}</Select.Option>)}
            </Select.Content>
          </Select>
        </div>
        {(filterStep || filterRequest || filterZone) && (
          <span
            style={{ fontSize: "0.8em", color: "#8e9099", cursor: "pointer", whiteSpace: "nowrap" }}
            onClick={() => { setFilterStep(null); setFilterRequest(null); setFilterZone(null); setActiveKey(null); }}
          >
            Clear filters ({rows.length} service{rows.length !== 1 ? "s" : ""})
          </span>
        )}
        {hasCompare && (
          <span style={{ fontSize: "0.8em", color: "#8e9099", marginLeft: "auto" }}>
            Red delta = &gt;20% regression vs {compareTests.length} comparison test{compareTests.length > 1 ? "s" : ""}
          </span>
        )}
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
            columns={columns}
            fullWidth
            rowThresholds={rowThresholds}
          >
            <DataTable.Pagination defaultPageSize={10} />
          </DataTable>

          {/* Detail chart for selected row */}
          {activeRow && (
            <Surface style={{ padding: "16px" }}>
              <Flex flexDirection="column" gap={12}>
                <Heading level={5}>
                  Response Time During Test — {activeRow.process_exe} ({activeRow.tech_type})
                  <span style={{ fontSize: "0.8em", color: "#8e9099", marginLeft: "8px" }}>
                    {activeRow.service_id.slice(-24)}
                  </span>
                </Heading>
                <Text textStyle="small" style={{ color: "#8e9099" }}>
                  X-axis = elapsed time since test start. Comparison tests aligned for direct comparison.
                </Text>
                {detailLoading && <Text style={{ color: "#8e9099" }}>Loading metrics…</Text>}
                {!detailLoading && detailSeries.length > 0 && (
                  <TimeseriesChart height={280}>
                    {detailSeries.map((s) => (
                      <TimeseriesChart.Line
                        key={Array.isArray(s.name) ? s.name.join("-") : s.name}
                        data={s}
                        gapPolicy="connect"
                        pointsDisplay="always"
                      />
                    ))}
                    <TimeseriesChart.Legend />
                    <TimeseriesChart.YAxis label="ms" />
                    <TimeseriesChart.Tooltip />
                  </TimeseriesChart>
                )}
                {!detailLoading && detailSeries.length === 0 && (
                  <Text style={{ color: "#8e9099" }}>
                    No response time data found for this service during the test window. The service may not have been instrumented or active during the test.
                  </Text>
                )}
              </Flex>
            </Surface>
          )}
        </>
      )}
    </Flex>
  );
};
