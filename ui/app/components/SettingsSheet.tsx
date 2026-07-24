import React, { useState, useEffect } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { Button } from "@dynatrace/strato-components/buttons";
import { Switch } from "@dynatrace/strato-components/forms";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { useSettings } from "../context/SettingsContext";
import { METRIC_CATEGORY_DEFS, DEFAULT_THRESHOLDS, DEFAULT_TECH_THRESHOLDS, type MetricCategory, type MetricThreshold } from "../utils/thresholds";
import { TECH_METRIC_GROUPS, type TechMetricDef } from "../utils/infraMetricConfig";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

const numInputStyle = (enabled: boolean): React.CSSProperties => ({
  width: "64px",
  padding: "3px 6px",
  background: enabled ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
  border: `1px solid ${enabled ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)"}`,
  borderRadius: "4px",
  color: enabled ? "#c8ccd4" : "#555a65",
  fontSize: "0.85em",
  outline: "none",
});

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "0.72em",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#8e9099",
};

const thresholdColHeaders = ["Metric", "Relative (% worse)", "Static (absolute)", "Combine"];
const thresholdGrid = "110px 1fr 1fr 72px";

function ThresholdRow({
  label, unit, t,
  onRelEnabled, onRelPct, onStaticEnabled, onStaticValue, onCombination,
}: {
  label: string;
  unit?: string;
  t: MetricThreshold;
  onRelEnabled: (v: boolean) => void;
  onRelPct: (v: number) => void;
  onStaticEnabled: (v: boolean) => void;
  onStaticValue: (v: number) => void;
  onCombination: (v: 'or' | 'and') => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: thresholdGrid, gap: "0 8px", alignItems: "center", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ fontSize: "0.85em", color: "#c8ccd4" }}>{label}</span>

      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <Switch value={t.relEnabled} onChange={onRelEnabled} />
        <input type="number" min={0} max={1000} value={t.relPct} disabled={!t.relEnabled}
          onChange={(e) => onRelPct(Math.max(0, Number(e.target.value)))}
          style={numInputStyle(t.relEnabled)} />
        <span style={{ fontSize: "0.78em", color: t.relEnabled ? "#8e9099" : "#444" }}>%</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
        <Switch value={t.staticEnabled} onChange={onStaticEnabled} />
        <input type="number" min={0} value={t.staticValue} disabled={!t.staticEnabled}
          onChange={(e) => onStaticValue(Math.max(0, Number(e.target.value)))}
          style={numInputStyle(t.staticEnabled)} />
        {unit && <span style={{ fontSize: "0.78em", color: t.staticEnabled ? "#8e9099" : "#444" }}>{unit}</span>}
      </div>

      <div style={{ display: "flex", gap: "4px" }}>
        {t.relEnabled && t.staticEnabled ? (
          (['or', 'and'] as const).map(opt => (
            <button key={opt} onClick={() => onCombination(opt)}
              style={{ padding: "2px 7px", fontSize: "0.7em", fontWeight: 700, borderRadius: "3px", textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                border: `1px solid ${t.combination === opt ? "#6e91e6" : "rgba(255,255,255,0.12)"}`,
                background: t.combination === opt ? "rgba(110,145,230,0.2)" : "transparent",
                color: t.combination === opt ? "#6e91e6" : "#555a65",
              }}>{opt}</button>
          ))
        ) : (
          <span style={{ fontSize: "0.78em", color: "#3a3d45" }}>—</span>
        )}
      </div>
    </div>
  );
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({ open, onClose }) => {
  const { settings, updateSettings } = useSettings();
  const [pending, setPending] = useState(settings);

  useEffect(() => {
    if (open) setPending(settings);
  }, [open]);

  const handleSave = () => { updateSettings(pending); onClose(); };
  const handleCancel = () => onClose();

  const updateThreshold = (key: MetricCategory, patch: Partial<MetricThreshold>) =>
    setPending(prev => ({ ...prev, thresholds: { ...prev.thresholds, [key]: { ...prev.thresholds[key], ...patch } } }));

  const updateTechThreshold = (metricKey: string, patch: Partial<MetricThreshold>) =>
    setPending(prev => ({
      ...prev,
      techThresholds: {
        ...prev.techThresholds,
        [metricKey]: { ...(prev.techThresholds[metricKey] ?? DEFAULT_TECH_THRESHOLDS[metricKey]), ...patch },
      },
    }));

  const resetAll = () => setPending(prev => ({
    ...prev,
    thresholds: { ...DEFAULT_THRESHOLDS },
    techThresholds: { ...DEFAULT_TECH_THRESHOLDS },
  }));

  return (
    <Sheet
      show={open}
      onDismiss={handleCancel}
      topoffset={52}
      actions={<Button variant="emphasized" onClick={handleSave}>Save Settings</Button>}
    >
      <div style={{ background: "linear-gradient(135deg, #1c2b6e 0%, #0d1a4a 100%)", padding: "20px 24px 24px", margin: "-16px -16px 24px" }}>
        <Heading level={3} style={{ color: "#fff", marginBottom: "4px" }}>App Settings</Heading>
        <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.875em" }}>Configure display preferences and alert thresholds</Text>
      </div>

      <Flex flexDirection="column" gap={24}>

        {/* ── Request Detail ── */}
        <Flex flexDirection="column" gap={12}>
          <Text style={sectionLabelStyle}>Request Detail Panel</Text>
          <Flex justifyContent="space-between" alignItems="flex-start" gap={24}>
            <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
              <Text>Show missing lookup table notices</Text>
              <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">
                Display a notice for comparison tests that have no neoload.responsetime.detailed business events.
              </Text>
            </Flex>
            <Switch value={pending.showMissingTestsNotice} onChange={(checked) => setPending(prev => ({ ...prev, showMissingTestsNotice: checked }))} />
          </Flex>
        </Flex>

        {/* ── Golden Signal Thresholds ── */}
        <Flex flexDirection="column" gap={12}>
          <Flex justifyContent="space-between" alignItems="center">
            <Text style={sectionLabelStyle}>Comparison Thresholds</Text>
            <button onClick={resetAll}
              style={{ background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", color: "#8e9099", fontSize: "0.72em", padding: "2px 8px", cursor: "pointer" }}>
              Reset all to defaults
            </button>
          </Flex>
          <Text textStyle="small" style={{ color: "#636670" }}>
            Colours a delta red when the primary test is worse by the configured threshold.
            <br />
            <strong style={{ color: "#8e9099" }}>Relative</strong>: fires when value deviates from comparison by ≥X%.{" "}
            <strong style={{ color: "#8e9099" }}>Static</strong>: fires when value crosses a fixed limit.{" "}
            When both are on, <strong style={{ color: "#8e9099" }}>AND</strong> requires both; <strong style={{ color: "#8e9099" }}>OR</strong> requires either.
          </Text>

          <div style={{ display: "grid", gridTemplateColumns: thresholdGrid, gap: "0 8px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
            {thresholdColHeaders.map(h => (
              <span key={h} style={{ fontSize: "0.68em", color: "#555a65", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>
            ))}
          </div>

          {METRIC_CATEGORY_DEFS.map(({ key, label, unit }) => {
            const t = pending.thresholds[key];
            return (
              <ThresholdRow key={key} label={label} unit={unit} t={t}
                onRelEnabled={(v) => updateThreshold(key, { relEnabled: v })}
                onRelPct={(v) => updateThreshold(key, { relPct: v })}
                onStaticEnabled={(v) => updateThreshold(key, { staticEnabled: v })}
                onStaticValue={(v) => updateThreshold(key, { staticValue: v })}
                onCombination={(v) => updateThreshold(key, { combination: v })}
              />
            );
          })}
        </Flex>

        {/* ── Tech Metric Thresholds ── */}
        <Flex flexDirection="column" gap={12}>
          <Text style={sectionLabelStyle}>Tech-Specific Metric Thresholds</Text>
          <Text textStyle="small" style={{ color: "#636670" }}>
            These thresholds apply to runtime metrics in the Infrastructure Panel detail view and table columns.
            They use the same relative / static / AND-OR logic as the golden signal thresholds above.
          </Text>

          {TECH_METRIC_GROUPS.map((group) => (
            <div key={group.label}>
              {/* Group sub-header */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "8px 0 6px" }}>
                <span style={{ fontSize: "0.72em", fontWeight: 700, color: "#6e91e6", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                  {group.label}
                </span>
                <div style={{ flex: 1, height: "1px", background: "rgba(110,145,230,0.2)" }} />
              </div>

              {/* Column headers (only on first group, above the first row) */}
              {group === TECH_METRIC_GROUPS[0] && (
                <div style={{ display: "grid", gridTemplateColumns: thresholdGrid, gap: "0 8px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {thresholdColHeaders.map(h => (
                    <span key={h} style={{ fontSize: "0.68em", color: "#555a65", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>
                  ))}
                </div>
              )}

              {group.defs.map((def: TechMetricDef) => {
                const t = pending.techThresholds[def.metricKey] ?? DEFAULT_TECH_THRESHOLDS[def.metricKey];
                return (
                  <ThresholdRow key={def.metricKey} label={def.label} unit={def.unit} t={t}
                    onRelEnabled={(v) => updateTechThreshold(def.metricKey, { relEnabled: v })}
                    onRelPct={(v) => updateTechThreshold(def.metricKey, { relPct: v })}
                    onStaticEnabled={(v) => updateTechThreshold(def.metricKey, { staticEnabled: v })}
                    onStaticValue={(v) => updateTechThreshold(def.metricKey, { staticValue: v })}
                    onCombination={(v) => updateTechThreshold(def.metricKey, { combination: v })}
                  />
                );
              })}
            </div>
          ))}
        </Flex>

      </Flex>

      {/* Footer */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, borderTop: "1px solid rgba(255,255,255,0.1)", padding: "16px 24px", display: "flex", gap: "12px", background: "var(--dt-color-background-base-default, #1a1a2e)" }}>
        <Button variant="emphasized" onClick={handleSave} style={{ flex: 1 }}>Save Settings</Button>
        <Button variant="default" onClick={handleCancel}>Cancel</Button>
      </div>
    </Sheet>
  );
};
