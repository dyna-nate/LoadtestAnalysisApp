import React, { useEffect, useState } from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { Select } from "@dynatrace/strato-components/forms";
import { TimeseriesChart } from "@dynatrace/strato-components/charts";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import { Accordion } from "@dynatrace/strato-components/content";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { useDql } from "@dynatrace-sdk/react-hooks";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { useSelectedTest } from "../context/SelectedTestContext";
import { useSettings } from "../context/SettingsContext";
import { InfrastructurePanel } from "./InfrastructurePanel";

const COLOR_BETTER = "#00b140";
const COLOR_WORSE  = "#e8323e";

// ── Raw record shape from lookup table ───────────────────────────────────────

interface RequestDetailRecord {
  test_execution: string;
  na_keptn: string;
  request?: string;
  zone?: string;
  count?: number | string;
  avg_dur_ms?: number | string;
  min_dur_ms?: number | string;
  max_dur_ms?: number | string;
  p50_dur_ms?: number | string;
  p90_dur_ms?: number | string;
  p95_dur_ms?: number | string;
  p99_dur_ms?: number | string;
}

// ── Flattened display row: primary values + per-step comparison averages ─────

interface DisplayRow {
  na_keptn: string;
  request: string;
  zone: string;
  count: number | null;
  cmp_count: number | null;
  avg_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  p50_ms: number | null;
  p90_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  cmp_avg_ms: number | null;
  cmp_min_ms: number | null;
  cmp_max_ms: number | null;
  cmp_p50_ms: number | null;
  cmp_p90_ms: number | null;
  cmp_p95_ms: number | null;
  cmp_p99_ms: number | null;
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

function bizeventsQuery(teUuid: string): string {
  return `fetch bizevents, from: -365d | filter event.type == "neoload.responsetime.detailed" | filter te_uuid == "${teUuid}"`;
}

// ── Delta cell ────────────────────────────────────────────────────────────────

const DeltaCell: React.FC<{ primaryMs: number | null; compareAvgMs: number | null }> = ({
  primaryMs,
  compareAvgMs,
}) => {
  if (primaryMs == null) return <span>—</span>;
  const delta = compareAvgMs != null ? primaryMs - compareAvgMs : null;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      <span style={{ whiteSpace: "nowrap" }}>{primaryMs.toFixed(2)} ms</span>
      {delta != null && (
        <span
          style={{
            fontSize: "0.75em",
            fontWeight: "bold",
            whiteSpace: "nowrap",
            color: delta <= 0 ? COLOR_BETTER : COLOR_WORSE,
          }}
        >
          {delta >= 0 ? "+" : ""}{delta.toFixed(1)}
        </span>
      )}
    </div>
  );
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export const RequestDetailPanel: React.FC = () => {
  const { primaryTest, compareTests } = useSelectedTest();
  const { settings } = useSettings();
  const [compareRecordsByTest, setCompareRecordsByTest] = useState<Map<string, RequestDetailRecord[]>>(new Map());
  const [missingTests, setMissingTests] = useState<{ id: string; query: string }[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [filterSteps, setFilterSteps] = useState<string[]>([]);
  const [filterRequests, setFilterRequests] = useState<string[]>([]);
  const [filterZones, setFilterZones] = useState<string[]>([]);
  const [activeRow, setActiveRow] = useState<string | null>(null);

  useEffect(() => {
    setFilterSteps([]);
    setFilterRequests([]);
    setFilterZones([]);
    setActiveRow(null);
  }, [primaryTest?.te_uuid]);

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

  if (!primaryTest) return null;

  // Flat list for na_keptn grouping; per-test map for chart lookups
  const compareRecords = [...compareRecordsByTest.values()].flat();

  // Index comparison records by na_keptn for per-step delta computation
  const cmpByStep = new Map<string, RequestDetailRecord[]>();
  for (const r of compareRecords) {
    const group = cmpByStep.get(r.na_keptn) ?? [];
    group.push(r);
    cmpByStep.set(r.na_keptn, group);
  }

  const hasCompare = compareTests.length > 0;

  const rows: DisplayRow[] = primaryRecords.map(p => {
    const cmp = cmpByStep.get(p.na_keptn) ?? [];
    return {
      na_keptn:   p.na_keptn,
      request:    p.request ?? "—",
      zone:       p.zone    ?? "—",
      count:      p.count != null ? Number(p.count) : null,
      cmp_count:  avgMs(cmp, "count"),
      avg_ms:     parseMs(p.avg_dur_ms),
      min_ms:     parseMs(p.min_dur_ms),
      max_ms:     parseMs(p.max_dur_ms),
      p50_ms:     parseMs(p.p50_dur_ms),
      p90_ms:     parseMs(p.p90_dur_ms),
      p95_ms:     parseMs(p.p95_dur_ms),
      p99_ms:     parseMs(p.p99_dur_ms),
      cmp_avg_ms: avgMs(cmp, "avg_dur_ms"),
      cmp_min_ms: avgMs(cmp, "min_dur_ms"),
      cmp_max_ms: avgMs(cmp, "max_dur_ms"),
      cmp_p50_ms: avgMs(cmp, "p50_dur_ms"),
      cmp_p90_ms: avgMs(cmp, "p90_dur_ms"),
      cmp_p95_ms: avgMs(cmp, "p95_dur_ms"),
      cmp_p99_ms: avgMs(cmp, "p99_dur_ms"),
    };
  });

  const uniqueSteps = [...new Set(rows.map(r => r.na_keptn))].sort();
  const uniqueRequests = [...new Set(rows.map(r => r.request).filter(r => r !== "—"))].sort();
  const uniqueZones = [...new Set(rows.map(r => r.zone).filter(z => z !== "—"))].sort();

  const filteredRows = rows.filter(r =>
    (filterSteps.length    === 0 || filterSteps.includes(r.na_keptn)) &&
    (filterRequests.length === 0 || filterRequests.includes(r.request)) &&
    (filterZones.length    === 0 || filterZones.includes(r.zone))
  );

  const rowKey = (r: DisplayRow) => `${r.na_keptn}|||${r.request}|||${r.zone}`;
  const selectedRow = activeRow ? (rows.find(r => rowKey(r) === activeRow) ?? null) : null;

  const CHART_METRICS: Array<{ name: string; field: keyof RequestDetailRecord }> = [
    { name: "Avg", field: "avg_dur_ms" },
    { name: "Min", field: "min_dur_ms" },
    { name: "Max", field: "max_dur_ms" },
    { name: "P50", field: "p50_dur_ms" },
    { name: "P90", field: "p90_dur_ms" },
    { name: "P95", field: "p95_dur_ms" },
    { name: "P99", field: "p99_dur_ms" },
  ];

  const chartSeries: Timeseries[] = selectedRow ? (() => {
    const matchStep = (r: RequestDetailRecord) =>
      r.na_keptn === selectedRow.na_keptn &&
      (r.request ?? "—") === selectedRow.request &&
      (r.zone ?? "—") === selectedRow.zone;

    const allPoints = [
      { start: new Date(primaryTest.test_start), record: primaryRecords.find(matchStep) ?? null },
      ...compareTests.map(ct => ({
        start: new Date(ct.test_start),
        record: (compareRecordsByTest.get(ct.te_uuid) ?? []).find(matchStep) ?? null,
      })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    return CHART_METRICS.map(m => ({
      name: m.name,
      unit: "ms",
      datapoints: allPoints
        .map(p => {
          const val = p.record ? parseMs(p.record[m.field] as number | string | undefined) : null;
          return val != null ? { start: p.start, value: val } : null;
        })
        .filter((dp): dp is { start: Date; value: number } => dp != null),
    })).filter(s => s.datapoints.length > 0);
  })() : [];

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
      cell: ({ value, rowData }) => (
        <div style={{ paddingLeft: "12px", paddingRight: "12px" }}>
        <DeltaCell
          primaryMs={value as number | null}
          compareAvgMs={hasCompare ? (rowData[cmpField] as number | null) : null}
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
    { id: "na_keptn", header: "Test Step", accessor: "na_keptn", width: "auto" },
    { id: "request",  header: "Request",   accessor: "request",  width: "auto" },
    { id: "zone",     header: "Zone",      accessor: "zone",     width: "content" },
    {
      id: "count",
      header: "Count",
      accessor: "count",
      width: "content",
      cell: ({ value, rowData }) => {
        const primary = value as number | null;
        const compare = hasCompare ? rowData.cmp_count : null;
        const delta = primary != null && compare != null ? primary - compare : null;
        return (
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span style={{ whiteSpace: "nowrap" }}>{primary ?? "—"}</span>
            {delta != null && (
              <span style={{ fontSize: "0.75em", fontWeight: "bold", whiteSpace: "nowrap" }}>
                {delta >= 0 ? "+" : ""}{Math.round(delta)}
              </span>
            )}
          </div>
        );
      },
    },
    metricCol("avg_ms", "Avg", "avg_ms", "cmp_avg_ms"),
    metricCol("min_ms", "Min", "min_ms", "cmp_min_ms"),
    metricCol("max_ms", "Max", "max_ms", "cmp_max_ms"),
    metricCol("p50_ms", "P50", "p50_ms", "cmp_p50_ms"),
    metricCol("p90_ms", "P90", "p90_ms", "cmp_p90_ms"),
    metricCol("p95_ms", "P95", "p95_ms", "cmp_p95_ms"),
    metricCol("p99_ms", "P99", "p99_ms", "cmp_p99_ms"),
  ];

  // Pairs of [primaryField, compareField] for regression detection
  const METRIC_PAIRS: Array<[keyof DisplayRow, keyof DisplayRow]> = [
    ["avg_ms", "cmp_avg_ms"], ["min_ms", "cmp_min_ms"], ["max_ms", "cmp_max_ms"],
    ["p50_ms", "cmp_p50_ms"], ["p90_ms", "cmp_p90_ms"], ["p95_ms", "cmp_p95_ms"],
    ["p99_ms", "cmp_p99_ms"],
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
          return v != null && c != null && v > c;
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
              {(filterSteps.length > 0 || filterRequests.length > 0 || filterZones.length > 0) && (
                <span
                  style={{ fontSize: "0.8em", color: "#8e9099", cursor: "pointer", whiteSpace: "nowrap" }}
                  onClick={() => { setFilterSteps([]); setFilterRequests([]); setFilterZones([]); }}
                >
                  Clear filters ({filteredRows.length} / {rows.length})
                </span>
              )}
            </Flex>
            <DataTable
              data={filteredRows}
              columns={columns}
              fullWidth
              rowThresholds={activeRowThresholds}
            >
              <DataTable.Pagination defaultPageSize={10} />
            </DataTable>

            {selectedRow && chartSeries.length > 0 && (
              <Surface style={{ padding: "16px" }}>
                <Flex flexDirection="column" gap={8}>
                  <Heading level={5}>
                    Response Time Trend — {selectedRow.na_keptn}
                    {selectedRow.request !== "—" && ` / ${selectedRow.request}`}
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
