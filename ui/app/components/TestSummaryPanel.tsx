import React from "react";
import { Surface, Flex } from "@dynatrace/strato-components/layouts";
import { Heading } from "@dynatrace/strato-components/typography";
import { Accordion } from "@dynatrace/strato-components/content";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { type TestExecution, useSelectedTest } from "../context/SelectedTestContext";
import { useSettings } from "../context/SettingsContext";
import { isWorse } from "../utils/thresholds";

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

const COMPARE_COLUMNS: DataTableColumnDef<TestExecution>[] = [
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

// ── Panel ─────────────────────────────────────────────────────────────────────

export const TestSummaryPanel = () => {
  const { primaryTest, compareTests } = useSelectedTest();
  const { settings } = useSettings();
  if (!primaryTest) return null;

  const hasCompare = compareTests.length > 0;

  // Duration delta — values are already in ms; Number() guards against DQL returning strings
  const avgCompareDurationMs = hasCompare
    ? avgOf(compareTests.map((t) => t.test_duration_ms))
    : null;
  const primaryDurationMs = primaryTest.test_duration_ms != null ? Number(primaryTest.test_duration_ms) : null;
  const durationDelta =
    primaryDurationMs != null && avgCompareDurationMs != null
      ? primaryDurationMs - avgCompareDurationMs
      : null;

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
          <FieldCard label="Project"  value={primaryTest.te_projectname ?? "—"} />
          <FieldCard label="Scenario" value={primaryTest.te_scenarioname ?? "—"} />
          <FieldCard label="Start"    value={formatDate(primaryTest.test_start)} />
          <FieldCard label="End"      value={formatDate(primaryTest.test_end)} />
          <FieldCard
            label="Duration"
            value={formatDuration(primaryDurationMs ?? undefined)}
            delta={durationDelta != null ? formatDurationDelta(durationDelta) : null}
            deltaColor={durationDelta != null ? (durationDelta <= 0 ? COLOR_BETTER : COLOR_WORSE) : undefined}
          />
        </Flex>

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
                <DataTable data={compareTests} columns={COMPARE_COLUMNS} fullWidth />
              </Accordion.SectionContent>
            </Accordion.Section>
          </Accordion>
        )}

      </Flex>
    </Surface>
  );
};
