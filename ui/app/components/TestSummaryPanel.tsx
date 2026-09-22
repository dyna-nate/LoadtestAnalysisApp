import React, { useEffect, useState } from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { Accordion } from "@dynatrace/strato-components/content";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { type TestExecution, useSelectedTest } from "../context/SelectedTestContext";
import { useSettings } from "../context/SettingsContext";
import { isWorse } from "../utils/thresholds";
import { parseProjectFromTestExecution, parseScenarioFromTestExecution } from "../utils/sloData";

const COMPARISON_DEVIATION_PCT = 20;

const COLOR_BETTER = "#00b140";
const COLOR_WORSE  = "#e8323e";

function formatDate(value: string | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatDurationDelta(deltaMs: number): string {
  const sign = deltaMs >= 0 ? "+" : "-";
  const absSec = Math.abs(deltaMs) / 1000;
  if (absSec < 1) return `${sign}${Math.abs(deltaMs).toFixed(0)} ms`;
  const totalSec = Math.floor(absSec);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${sign}${min}m ${sec}s`;
  return `${sign}${totalSec}s`;
}

function nsToMs(ns: number | string | undefined): number | null {
  return ns != null ? Number(ns) / 1_000_000 : null;
}

function formatNsAsMs(ns: number | undefined): string {
  const ms = nsToMs(ns);
  return ms != null ? `${ms.toFixed(2)} ms` : "—";
}

function avgOf(values: (number | string | null | undefined)[]): number | null {
  const nums = values.map((v) => (v != null ? Number(v) : null));
  const valid = nums.filter((v): v is number => v != null && !isNaN(v));
  if (valid.length === 0) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// ── Field card ────────────────────────────────────────────────────────────────

interface FieldCardProps {
  label: string;
  value: string;
  delta?: string | null;
  deltaColor?: string;
}

const FieldCard: React.FC<FieldCardProps> = ({ label, value, delta, deltaColor }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "4px",
      padding: "8px 14px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "6px",
      minWidth: "110px",
    }}
  >
    <span
      style={{
        fontSize: "0.70em",
        color: "#8e9099",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
    <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
      <span style={{ fontWeight: 500, fontSize: "0.95em", whiteSpace: "nowrap" }}>
        {value}
      </span>
      {delta != null && (
        <span
          style={{
            fontSize: "0.75em",
            fontWeight: "bold",
            color: deltaColor,
            whiteSpace: "nowrap",
          }}
        >
          {delta}
        </span>
      )}
    </div>
  </div>
);

// ── Metric field definitions ──────────────────────────────────────────────────

const METRIC_FIELDS: Array<{ label: string; field: keyof TestExecution }> = [
  { label: "Avg",  field: "avg_dur_ms" },
  { label: "Min",  field: "min_dur_ms" },
  { label: "Max",  field: "max_dur_ms" },
  { label: "P50",  field: "p50_dur_ms" },
  { label: "P90",  field: "p90_dur_ms" },
  { label: "P95",  field: "p95_dur_ms" },
  { label: "P99",  field: "p99_dur_ms" },
];

// ── Comparison table columns ──────────────────────────────────────────────────

interface TestCountData { count: number; failCount: number | null; }

function buildCompareColumns(testCountData: Map<string, TestCountData>, primaryCount: number | null): DataTableColumnDef<TestExecution>[] {
  return [
    {
      id: "test_start",
      header: "Start",
      accessor: (r) => formatDate(r.test_start),
      width: "auto",
    },
    {
      id: "test_end",
      header: "End",
      accessor: (r) => formatDate(r.test_end),
      width: "auto",
    },
    {
      id: "test_duration",
      header: "Duration",
      accessor: (r) => formatDuration(r.test_duration_ms),
      width: "content",
    },
    {
      id: "request_count",
      header: "Requests",
      accessor: (r) => testCountData.get(r.te_uuid)?.count ?? null,
      width: "content",
      cell: ({ rowData }) => {
        const count = testCountData.get(rowData.te_uuid)?.count ?? null;
        if (count == null) return <span style={{ color: "#636670" }}>—</span>;
        const delta = primaryCount != null ? count - primaryCount : null;
        const pct = primaryCount != null && primaryCount > 0 ? Math.abs(count - primaryCount) / primaryCount * 100 : 0;
        const isQuestionable = pct > COMPARISON_DEVIATION_PCT;
        return (
          <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
            <span>{count.toLocaleString()}</span>
            {delta != null && (
              <span style={{ fontSize: "0.75em", fontWeight: "bold", color: isQuestionable ? "#f5a623" : undefined }}>
                {delta >= 0 ? "+" : ""}{delta.toLocaleString()}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "fail_rate",
      header: "Fail Rate",
      accessor: (r) => {
        const d = testCountData.get(r.te_uuid);
        if (!d || d.count === 0 || d.failCount == null) return null;
        return (d.failCount / d.count) * 100;
      },
      width: "content",
      cell: ({ rowData }) => {
        const d = testCountData.get(rowData.te_uuid);
        if (!d || d.count === 0 || d.failCount == null) return <span style={{ color: "#636670" }}>—</span>;
        const rate = (d.failCount / d.count) * 100;
        return (
          <span style={{ color: rate > 5 ? "#e8323e" : rate > 0 ? "#f5a623" : undefined }}>
            {rate.toFixed(2)}%
          </span>
        );
      },
    },
    {
      id: "avg_dur_ms",
      header: "Avg",
      accessor: (r) => formatNsAsMs(r.avg_dur_ms),
      width: "content",
    },
    {
      id: "min_dur_ms",
      header: "Min",
      accessor: (r) => formatNsAsMs(r.min_dur_ms),
      width: "content",
    },
    {
      id: "max_dur_ms",
      header: "Max",
      accessor: (r) => formatNsAsMs(r.max_dur_ms),
      width: "content",
    },
    {
      id: "p50_dur_ms",
      header: "P50",
      accessor: (r) => formatNsAsMs(r.p50_dur_ms),
      width: "content",
    },
    {
      id: "p90_dur_ms",
      header: "P90",
      accessor: (r) => formatNsAsMs(r.p90_dur_ms),
      width: "content",
    },
    {
      id: "p95_dur_ms",
      header: "P95",
      accessor: (r) => formatNsAsMs(r.p95_dur_ms),
      width: "content",
    },
    {
      id: "p99_dur_ms",
      header: "P99",
      accessor: (r) => formatNsAsMs(r.p99_dur_ms),
      width: "content",
    },
  ];
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export const TestSummaryPanel = () => {
  const { primaryTest, compareTests } = useSelectedTest();
  const { settings } = useSettings();
  const [testCountData, setTestCountData] = useState<Map<string, TestCountData>>(new Map());

  useEffect(() => {
    if (!primaryTest) { setTestCountData(new Map()); return; }
    const allUuids = [primaryTest.te_uuid, ...compareTests.map(t => t.te_uuid)];
    const list = allUuids.map(id => `"${id}"`).join(', ');
    const query = `fetch bizevents, from: -365d | filter event.type == "neoload.responsetime.detailed" | filter in(te_uuid, {${list}}) | summarize total_count = sum(toLong(count)), total_fails = sum(toLong(fail_count)), by: { te_uuid }`;
    queryExecutionClient
      .queryExecute({ body: { query, requestTimeoutMilliseconds: 30000 } })
      .then(res => {
        const records = (res.result?.records ?? []) as { te_uuid?: string; total_count?: number | string; total_fails?: number | string | null }[];
        const map = new Map<string, TestCountData>();
        for (const rec of records) {
          if (rec.te_uuid && rec.total_count != null) {
            map.set(rec.te_uuid, {
              count:     Number(rec.total_count),
              failCount: rec.total_fails != null ? Number(rec.total_fails) : null,
            });
          }
        }
        setTestCountData(map);
      })
      .catch(() => {});
  }, [primaryTest?.te_uuid, compareTests.map(t => t.te_uuid).join(',')]);

  if (!primaryTest) return null;

  const hasCompare = compareTests.length > 0;

  // Duration — computed first so it's available for the questionable-deviation check
  const primaryDurationMs = primaryTest.test_duration_ms != null ? Number(primaryTest.test_duration_ms) : null;
  const avgCompareDurationMs = hasCompare ? avgOf(compareTests.map((t) => t.test_duration_ms)) : null;
  const durationDelta = primaryDurationMs != null && avgCompareDurationMs != null ? primaryDurationMs - avgCompareDurationMs : null;

  // Request counts & failure rates
  const primaryCountData  = testCountData.get(primaryTest.te_uuid);
  const primaryCount      = primaryCountData?.count ?? null;
  const primaryFailCount  = primaryCountData?.failCount ?? null;
  const primaryFailRate   = primaryCount != null && primaryCount > 0 && primaryFailCount != null
    ? (primaryFailCount / primaryCount) * 100 : null;

  const avgCompareCount = hasCompare ? avgOf(compareTests.map(t => testCountData.get(t.te_uuid)?.count ?? null)) : null;
  const countDelta = primaryCount != null && avgCompareCount != null ? primaryCount - avgCompareCount : null;

  const avgCompareFailRate = hasCompare ? avgOf(compareTests.map(t => {
    const d = testCountData.get(t.te_uuid);
    if (!d || d.count === 0 || d.failCount == null) return null;
    return (d.failCount / d.count) * 100;
  })) : null;
  const failRateDelta = primaryFailRate != null && avgCompareFailRate != null ? primaryFailRate - avgCompareFailRate : null;

  // Flag comparisons where count or duration differs by more than the threshold
  const questionableByCount = hasCompare ? compareTests.filter(t => {
    const c = testCountData.get(t.te_uuid)?.count;
    if (c == null || primaryCount == null || primaryCount === 0) return false;
    return Math.abs(c - primaryCount) / primaryCount * 100 > COMPARISON_DEVIATION_PCT;
  }) : [];
  const questionableByDuration = hasCompare ? compareTests.filter(t => {
    const d = t.test_duration_ms;
    if (d == null || primaryDurationMs == null || primaryDurationMs === 0) return false;
    return Math.abs(Number(d) - primaryDurationMs) / primaryDurationMs * 100 > COMPARISON_DEVIATION_PCT;
  }) : [];
  const questionableTests = [...new Set([...questionableByCount, ...questionableByDuration])];

  const compareColumns = buildCompareColumns(testCountData, primaryCount);

  return (
    <Surface as="section" style={{ margin: "16px", padding: "16px" }}>
      <Flex flexDirection="column" gap={12}>

        {/* Header */}
        <Flex justifyContent="space-between" alignItems="center">
          <Heading level={4}>Test Summary</Heading>
          {hasCompare && (
            <span style={{ fontSize: "0.8em", color: "#8e9099" }}>
              Delta vs {compareTests.length} comparison test{compareTests.length > 1 ? "s" : ""} —{" "}
              <span style={{ color: COLOR_BETTER }}>green = improved</span>,{" "}
              <span style={{ color: COLOR_WORSE }}>red = regression</span>
            </span>
          )}
        </Flex>

        {/* Identity cards */}
        <Flex gap={8} flexWrap="wrap">
          <FieldCard label="Project"  value={primaryTest.te_projectname ?? parseProjectFromTestExecution(primaryTest.test_execution)} />
          <FieldCard label="Scenario" value={primaryTest.te_scenarioname ?? parseScenarioFromTestExecution(primaryTest.test_execution)} />
          <FieldCard label="Start"    value={formatDate(primaryTest.test_start)} />
          <FieldCard label="End"      value={formatDate(primaryTest.test_end)} />
          <FieldCard
            label="Duration"
            value={formatDuration(primaryDurationMs ?? undefined)}
            delta={durationDelta != null ? formatDurationDelta(durationDelta) : null}
            deltaColor={questionableByDuration.length > 0 ? "#f5a623" : durationDelta != null ? (durationDelta <= 0 ? COLOR_BETTER : COLOR_WORSE) : undefined}
          />
          <FieldCard
            label="Requests"
            value={primaryCount != null ? primaryCount.toLocaleString() : "—"}
            delta={countDelta != null ? `${countDelta >= 0 ? "+" : ""}${Math.round(countDelta).toLocaleString()}` : null}
            deltaColor={questionableByCount.length > 0 ? "#f5a623" : countDelta != null ? (countDelta < 0 ? COLOR_WORSE : COLOR_BETTER) : undefined}
          />
          <FieldCard
            label="Fail Rate"
            value={primaryFailRate != null ? `${primaryFailRate.toFixed(2)}%` : "—"}
            delta={failRateDelta != null ? `${failRateDelta >= 0 ? "+" : ""}${failRateDelta.toFixed(2)} pp` : null}
            deltaColor={failRateDelta != null ? (failRateDelta > 0 ? COLOR_WORSE : failRateDelta < 0 ? COLOR_BETTER : undefined) : undefined}
          />
        </Flex>

        {/* Questionable comparison warning */}
        {questionableTests.length > 0 && (() => {
          const reasons: string[] = [];
          if (questionableByCount.length > 0) reasons.push("request count");
          if (questionableByDuration.length > 0) reasons.push("test duration");
          return (
            <div style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "10px 14px",
              background: "rgba(245,166,35,0.10)",
              border: "1px solid rgba(245,166,35,0.35)",
              borderRadius: "6px",
              fontSize: "0.85em",
            }}>
              <span style={{ fontSize: "1.1em", lineHeight: 1.4 }}>⚠</span>
              <span style={{ color: "#c9a030", lineHeight: 1.5 }}>
                <strong>Comparison may be unreliable.</strong>{" "}
                The {reasons.join(" and ")} differ{reasons.length > 1 ? "" : "s"} by more than {COMPARISON_DEVIATION_PCT}% between the primary test and {questionableTests.length === 1 ? "a comparison test" : `${questionableTests.length} comparison tests`} — this typically indicates one test was stopped early or encountered a throughput issue. Response time percentiles from an incomplete run may not be comparable to a full test.
              </span>
            </div>
          );
        })()}

        {/* Response time metric cards */}
        <Flex gap={8} flexWrap="wrap">
          {METRIC_FIELDS.map(({ label, field }) => {
            const valueMs = nsToMs(primaryTest[field] as number | undefined);
            const avgCompareMs = hasCompare
              ? avgOf(compareTests.map((t) => nsToMs(t[field] as number | undefined)))
              : null;
            const delta = valueMs != null && avgCompareMs != null ? valueMs - avgCompareMs : null;
            const worse = isWorse(valueMs, avgCompareMs, true, settings.thresholds.responseTime);
            const deltaColor = delta != null
              ? (worse ? COLOR_WORSE : delta < 0 ? COLOR_BETTER : undefined)
              : undefined;
            return (
              <FieldCard
                key={field}
                label={label}
                value={valueMs != null ? `${valueMs.toFixed(2)} ms` : "—"}
                delta={delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} ms` : null}
                deltaColor={deltaColor}
              />
            );
          })}
        </Flex>

        {/* Collapsible comparison table */}
        {hasCompare && (
          <Accordion>
            <Accordion.Section id="comparison">
              <Accordion.SectionLabel>
                Comparison Tests ({compareTests.length})
              </Accordion.SectionLabel>
              <Accordion.SectionContent>
                <DataTable data={compareTests} columns={compareColumns} fullWidth />
              </Accordion.SectionContent>
            </Accordion.Section>
          </Accordion>
        )}

      </Flex>
    </Surface>
  );
};
