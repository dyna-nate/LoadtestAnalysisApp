import React, { useState, useEffect, useMemo } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { Button } from "@dynatrace/strato-components/buttons";
import { Switch } from "@dynatrace/strato-components/forms";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { useSettings } from "../context/SettingsContext";
import {
  METRIC_CATEGORY_DEFS,
  DEFAULT_THRESHOLDS,
  DEFAULT_TECH_THRESHOLDS,
  type MetricCategory,
  type MetricThreshold,
  type ThresholdConfig,
} from "../utils/thresholds";
import { TECH_METRIC_GROUPS, type TechMetricDef } from "../utils/infraMetricConfig";
import { useSlos } from "../context/SloContext";
import { useAccess } from "../context/AccessContext";
import { parseSlosCsv, exportSlosCsv, DEFAULT_SLO_ENTRIES, type SloEntry } from "../utils/sloData";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

// ── Shared styles ──────────────────────────────────────────────────────────────

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

const textInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "3px 7px",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: "4px",
  color: "#c8ccd4",
  fontSize: "0.82em",
  outline: "none",
};

const ghostBtn = (color = "#8e9099"): React.CSSProperties => ({
  background: "none",
  border: `1px solid rgba(255,255,255,0.15)`,
  borderRadius: "4px",
  color,
  fontSize: "0.72em",
  padding: "2px 8px",
  cursor: "pointer",
});

// ── Tab save footer ────────────────────────────────────────────────────────────

function TabSaveFooter({
  onSave,
  saved,
  dirty,
  disabled,
}: {
  onSave: () => void;
  saved: boolean;
  dirty: boolean;
  disabled: boolean;
}) {
  return (
    <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: "12px" }}>
      {disabled ? (
        <div style={{ fontSize: "0.82em", color: "#555a65", padding: "6px 0" }}>
          Read-only — contact an admin to make changes
        </div>
      ) : (
        <>
          <Button variant="emphasized" onClick={onSave}>Save</Button>
          {dirty && !saved && (
            <span style={{ fontSize: "0.76em", color: "#e8a040" }}>Unsaved changes</span>
          )}
          {saved && (
            <span style={{ fontSize: "0.76em", color: "#00b140", fontWeight: 600 }}>✓ Saved</span>
          )}
        </>
      )}
    </div>
  );
}

// ── Threshold row ──────────────────────────────────────────────────────────────

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
  onCombination: (v: "or" | "and") => void;
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
          (["or", "and"] as const).map(opt => (
            <button key={opt} onClick={() => onCombination(opt)}
              style={{
                padding: "2px 7px", fontSize: "0.7em", fontWeight: 700, borderRadius: "3px",
                textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer",
                border: `1px solid ${t.combination === opt ? "#6e91e6" : "rgba(255,255,255,0.12)"}`,
                background: t.combination === opt ? "rgba(110,145,230,0.2)" : "transparent",
                color: t.combination === opt ? "#6e91e6" : "#555a65",
              }}>{opt}</button>
          ))
        ) : <span style={{ fontSize: "0.78em", color: "#3a3d45" }}>—</span>}
      </div>
    </div>
  );
}

// ── SLO table ──────────────────────────────────────────────────────────────────

const SLO_PAGE_SIZE = 20;
const sloGrid = "110px 1fr 1fr 90px 80px";
const sloColHeaders = ["Project", "Test Step", "Request", "SLO (ms)", ""];

function SloTable({ entries, onChange }: { entries: SloEntry[]; onChange: (e: SloEntry[]) => void }) {
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [page, setPage] = useState(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState({ project: "", step: "", request: "", sloMs: "" });
  const [addingNew, setAddingNew] = useState(false);
  const [newDraft, setNewDraft] = useState({ project: "", step: "", request: "", sloMs: "" });
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const entryKey = (e: SloEntry) => `${e.project ?? ""}|||${e.step}|||${e.request}`;

  const uniqueProjects = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entries) { if (e.project?.trim()) seen.add(e.project.trim()); }
    return Array.from(seen).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const sorted = [...entries].sort((a, b) =>
      (a.project ?? "").localeCompare(b.project ?? "") ||
      a.step.localeCompare(b.step) ||
      a.request.localeCompare(b.request)
    );
    return sorted.filter(e => {
      if (projectFilter && (e.project?.trim() ?? "") !== projectFilter) return false;
      if (q && !e.step.toLowerCase().includes(q) && !e.request.toLowerCase().includes(q) && !(e.project ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [entries, search, projectFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / SLO_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageEntries = filtered.slice(safePage * SLO_PAGE_SIZE, (safePage + 1) * SLO_PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, projectFilter]);

  const startEdit = (e: SloEntry) => {
    setEditingKey(entryKey(e));
    setDraft({ project: e.project ?? "", step: e.step, request: e.request, sloMs: String(e.sloMs) });
    setEditError(null);
  };

  const commitEdit = () => {
    const sloMs = parseInt(draft.sloMs, 10);
    if (!draft.step.trim() || !draft.request.trim()) { setEditError("Step and Request are required."); return; }
    if (isNaN(sloMs) || sloMs <= 0) { setEditError("SLO must be a positive integer (ms)."); return; }
    const key = editingKey!;
    const updated: SloEntry = { project: draft.project.trim() || undefined, step: draft.step.trim(), request: draft.request.trim(), sloMs };
    const newKey = entryKey(updated);
    if (newKey !== key && entries.some(e => entryKey(e) === newKey)) { setEditError("An entry for this Project + Step + Request already exists."); return; }
    onChange(entries.map(e => entryKey(e) === key ? updated : e));
    setEditingKey(null); setEditError(null);
  };

  const commitAdd = () => {
    const sloMs = parseInt(newDraft.sloMs, 10);
    if (!newDraft.step.trim() || !newDraft.request.trim()) { setAddError("Step and Request are required."); return; }
    if (isNaN(sloMs) || sloMs <= 0) { setAddError("SLO must be a positive integer (ms)."); return; }
    const newEntry: SloEntry = { project: newDraft.project.trim() || undefined, step: newDraft.step.trim(), request: newDraft.request.trim(), sloMs };
    if (entries.some(e => entryKey(e) === entryKey(newEntry))) { setAddError("An entry for this Project + Step + Request already exists."); return; }
    onChange([...entries, newEntry]);
    setNewDraft({ project: "", step: "", request: "", sloMs: "" }); setAddingNew(false); setAddError(null); setSearch("");
  };

  const rowStyle = (editing: boolean): React.CSSProperties => ({
    display: "grid", gridTemplateColumns: sloGrid, gap: "0 8px", alignItems: "center",
    padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
    background: editing ? "rgba(110,145,230,0.06)" : "transparent",
  });

  return (
    <div>
      <div style={{ display: "flex", gap: "8px", marginBottom: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <input type="text" placeholder="Search step or request…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ ...textInputStyle, flex: 1, minWidth: "120px" }} />
        {uniqueProjects.length > 0 && (
          <select value={projectFilter} onChange={e => { setProjectFilter(e.target.value); setPage(0); }}
            style={{ ...textInputStyle, flex: "0 0 auto", width: "auto", minWidth: "140px", cursor: "pointer" }}>
            <option value="">All projects</option>
            {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <button onClick={() => { setAddingNew(true); setNewDraft({ project: projectFilter, step: "", request: "", sloMs: "" }); setAddError(null); setEditingKey(null); }}
          disabled={addingNew}
          style={{ ...ghostBtn("#6e91e6"), border: "1px solid rgba(110,145,230,0.4)", padding: "3px 10px", fontSize: "0.78em" }}>
          + Add Entry
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: sloGrid, gap: "0 8px", paddingBottom: "5px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {sloColHeaders.map(h => <span key={h} style={{ fontSize: "0.68em", color: "#555a65", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>)}
      </div>

      {addingNew && (
        <div style={{ ...rowStyle(true), marginTop: "4px" }}>
          <input value={newDraft.project} onChange={e => setNewDraft(p => ({ ...p, project: e.target.value }))} placeholder="Project (opt)" style={textInputStyle} />
          <input value={newDraft.step} onChange={e => setNewDraft(p => ({ ...p, step: e.target.value }))} placeholder="Test step" style={textInputStyle} />
          <input value={newDraft.request} onChange={e => setNewDraft(p => ({ ...p, request: e.target.value }))} placeholder="Request" style={textInputStyle} />
          <input value={newDraft.sloMs} onChange={e => setNewDraft(p => ({ ...p, sloMs: e.target.value }))} placeholder="ms" type="number" min={1} style={textInputStyle} />
          <div style={{ display: "flex", gap: "4px" }}>
            <button onClick={commitAdd} title="Add entry" style={{ ...ghostBtn("#00b140"), border: "1px solid rgba(0,177,64,0.4)", padding: "3px 7px" }}>✓</button>
            <button onClick={() => { setAddingNew(false); setAddError(null); }} title="Cancel" style={{ ...ghostBtn("#e8323e"), border: "1px solid rgba(232,50,62,0.3)", padding: "3px 7px" }}>✕</button>
          </div>
        </div>
      )}
      {addError && <Text textStyle="small" style={{ color: "#e8323e", marginTop: "3px" }}>{addError}</Text>}

      {pageEntries.length === 0 && !addingNew && (
        <div style={{ padding: "16px 0", textAlign: "center", color: "#555a65", fontSize: "0.82em" }}>
          {search || projectFilter ? "No entries match your filter." : "No SLO entries. Add one above or import from CSV."}
        </div>
      )}

      {pageEntries.map(e => {
        const key = entryKey(e);
        const isEditing = editingKey === key;
        return (
          <div key={key} style={rowStyle(isEditing)}>
            {isEditing ? (
              <>
                <input value={draft.project} onChange={ev => setDraft(p => ({ ...p, project: ev.target.value }))} placeholder="Project (opt)" style={textInputStyle} />
                <input value={draft.step} onChange={ev => setDraft(p => ({ ...p, step: ev.target.value }))} style={textInputStyle} />
                <input value={draft.request} onChange={ev => setDraft(p => ({ ...p, request: ev.target.value }))} style={textInputStyle} />
                <input value={draft.sloMs} onChange={ev => setDraft(p => ({ ...p, sloMs: ev.target.value }))} type="number" min={1} style={textInputStyle} />
                <div style={{ display: "flex", gap: "4px" }}>
                  <button onClick={commitEdit} title="Save" style={{ ...ghostBtn("#00b140"), border: "1px solid rgba(0,177,64,0.4)", padding: "3px 7px" }}>✓</button>
                  <button onClick={() => { setEditingKey(null); setEditError(null); }} title="Cancel" style={{ ...ghostBtn("#8e9099"), padding: "3px 7px" }}>✕</button>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: "0.82em", color: e.project ? "#8e9099" : "#3a3d45", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: e.project ? "normal" : "italic" }} title={e.project ?? ""}>{e.project || "—"}</span>
                <span style={{ fontSize: "0.82em", color: "#c8ccd4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.step}>{e.step}</span>
                <span style={{ fontSize: "0.82em", color: "#c8ccd4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.request}>{e.request}</span>
                <span style={{ fontSize: "0.82em", color: "#8e9099" }}>{e.sloMs}</span>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button onClick={() => startEdit(e)} title="Edit" style={{ ...ghostBtn(), padding: "2px 7px", fontSize: "0.75em" }}>✎</button>
                  <button onClick={() => { onChange(entries.filter(x => entryKey(x) !== key)); if (editingKey === key) setEditingKey(null); }} title="Delete"
                    style={{ ...ghostBtn("#e8323e"), border: "1px solid rgba(232,50,62,0.2)", padding: "2px 7px", fontSize: "0.75em" }}>🗑</button>
                </div>
              </>
            )}
          </div>
        );
      })}
      {editError && <Text textStyle="small" style={{ color: "#e8323e", marginTop: "3px" }}>{editError}</Text>}

      {pageCount > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px", fontSize: "0.78em", color: "#636670" }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0} style={{ ...ghostBtn(), opacity: safePage === 0 ? 0.3 : 1 }}>← Prev</button>
          <span>{filtered.length} entries · page {safePage + 1} of {pageCount}</span>
          <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} style={{ ...ghostBtn(), opacity: safePage >= pageCount - 1 ? 0.3 : 1 }}>Next →</button>
        </div>
      )}
      {pageCount <= 1 && filtered.length > 0 && (
        <div style={{ marginTop: "6px", fontSize: "0.72em", color: "#3a3d45" }}>{filtered.length} entries</div>
      )}
    </div>
  );
}

// ── Main sheet ─────────────────────────────────────────────────────────────────

const TAB_GENERAL = 0;
const TAB_SLO = 1;
const TAB_THRESHOLDS = 2;

export const SettingsSheet: React.FC<SettingsSheetProps> = ({ open, onClose }) => {
  const { settings, updateSettings } = useSettings();
  const { entries: sloEntries, saveEntries: saveSloEntries } = useSlos();
  const { isAdmin, currentUserEmail, adminEmails, saveAdminEmails } = useAccess();

  // Tab state
  const [activeTab, setActiveTab] = useState(TAB_GENERAL);

  // General tab state
  const [pendingShowMissing, setPendingShowMissing] = useState(settings.showMissingTestsNotice);
  const [pendingBenchmarkFilter, setPendingBenchmarkFilter] = useState(settings.benchmarkScenarioFilter);
  const [pendingAdmins, setPendingAdmins] = useState<string[]>([]);
  const [newAdminEmail, setNewAdminEmail] = useState("");
  const [adminEmailError, setAdminEmailError] = useState<string | null>(null);

  // SLO tab state
  const [pendingSlos, setPendingSlos] = useState<SloEntry[]>([]);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);

  // Thresholds tab state
  const [pendingThresholds, setPendingThresholds] = useState<ThresholdConfig>(settings.thresholds);
  const [pendingTechThresholds, setPendingTechThresholds] = useState<Record<string, MetricThreshold>>(settings.techThresholds);

  // Per-tab save feedback
  const [savedTab, setSavedTab] = useState<number | null>(null);
  const showSavedFor = (tab: number) => { setSavedTab(tab); setTimeout(() => setSavedTab(t => t === tab ? null : t), 2000); };

  // Reset all pending state when sheet opens
  useEffect(() => {
    if (open) {
      setActiveTab(TAB_GENERAL);
      setPendingShowMissing(settings.showMissingTestsNotice);
      setPendingBenchmarkFilter(settings.benchmarkScenarioFilter);
      setPendingAdmins(adminEmails);
      setNewAdminEmail("");
      setAdminEmailError(null);
      setPendingSlos(sloEntries);
      setShowCsvImport(false);
      setCsvText("");
      setCsvError(null);
      setPendingThresholds(settings.thresholds);
      setPendingTechThresholds(settings.techThresholds);
      setSavedTab(null);
    }
  }, [open]);

  // ── Per-tab save handlers ──

  const saveGeneral = async () => {
    if (!isAdmin) return;
    updateSettings({ showMissingTestsNotice: pendingShowMissing, benchmarkScenarioFilter: pendingBenchmarkFilter });
    await saveAdminEmails(pendingAdmins);
    showSavedFor(TAB_GENERAL);
  };

  const saveSlos = async () => {
    if (!isAdmin) return;
    await saveSloEntries(pendingSlos);
    showSavedFor(TAB_SLO);
  };

  const saveThresholds = () => {
    if (!isAdmin) return;
    updateSettings({ thresholds: pendingThresholds, techThresholds: pendingTechThresholds });
    showSavedFor(TAB_THRESHOLDS);
  };

  // ── Threshold helpers ──

  const updateThreshold = (key: MetricCategory, patch: Partial<MetricThreshold>) =>
    setPendingThresholds(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const updateTechThreshold = (metricKey: string, patch: Partial<MetricThreshold>) =>
    setPendingTechThresholds(prev => ({
      ...prev,
      [metricKey]: { ...(prev[metricKey] ?? DEFAULT_TECH_THRESHOLDS[metricKey]), ...patch },
    }));

  // ── Access control helpers ──

  const addAdminEmail = () => {
    const email = newAdminEmail.trim().toLowerCase();
    if (!email) { setAdminEmailError("Enter an email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAdminEmailError("Enter a valid email address."); return; }
    if (pendingAdmins.includes(email)) { setAdminEmailError("This email is already in the list."); return; }
    setPendingAdmins(prev => [...prev, email]);
    setNewAdminEmail("");
    setAdminEmailError(null);
  };

  // ── CSV helpers ──

  const applyCsv = () => {
    const parsed = parseSlosCsv(csvText);
    if (parsed.length === 0) { setCsvError("No valid entries found. Format: step,request,slo_ms"); return; }
    setPendingSlos(parsed);
    setShowCsvImport(false); setCsvText(""); setCsvError(null);
  };

  // ── Dirty detection ──

  const generalDirty =
    pendingShowMissing !== settings.showMissingTestsNotice ||
    pendingBenchmarkFilter !== settings.benchmarkScenarioFilter ||
    JSON.stringify(pendingAdmins) !== JSON.stringify(adminEmails);

  const slosDirty = pendingSlos !== sloEntries;

  const thresholdsDirty =
    JSON.stringify(pendingThresholds) !== JSON.stringify(settings.thresholds) ||
    JSON.stringify(pendingTechThresholds) !== JSON.stringify(settings.techThresholds);

  // ── Read-only wrapper ──

  const readOnlyWrapper = (content: React.ReactNode) => (
    <div style={!isAdmin ? { pointerEvents: "none", opacity: 0.6, userSelect: "none" } : {}}>
      {content}
    </div>
  );

  return (
    <Sheet show={open} onDismiss={onClose} topoffset={52}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1c2b6e 0%, #0d1a4a 100%)", padding: "20px 24px 24px", margin: "-16px -16px 16px" }}>
        <Heading level={3} style={{ color: "#fff", marginBottom: "4px" }}>App Settings</Heading>
        <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.875em" }}>Configure display preferences, SLOs, and alert thresholds</Text>
      </div>

      {/* Read-only banner */}
      {!isAdmin && (
        <div style={{ background: "rgba(110,145,230,0.1)", border: "1px solid rgba(110,145,230,0.3)", borderRadius: "6px", padding: "10px 14px", marginBottom: "16px" }}>
          <Text style={{ color: "#c8ccd4", fontSize: "0.88em", fontWeight: 600 }}>Read-only access</Text>
          <Text textStyle="small" style={{ color: "#8e9099", marginTop: "2px" }}>
            Settings are restricted to specific users. Contact an admin to request edit access.
          </Text>
        </div>
      )}

      {/* Tabs */}
      <Tabs selectedIndex={activeTab} onChange={setActiveTab}>

        {/* ── General tab ── */}
        <Tab title="General">
          <Flex flexDirection="column" gap={20} style={{ paddingTop: "16px" }}>

            {readOnlyWrapper(
              <Flex flexDirection="column" gap={20}>

                <Flex flexDirection="column" gap={12}>
                  <Text style={sectionLabelStyle}>Scenario Filter</Text>
                  <Flex justifyContent="space-between" alignItems="flex-start" gap={24}>
                    <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
                      <Text>Benchmark scenarios only</Text>
                      <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">
                        When on, the Scenario dropdown in the header only shows scenarios whose name contains "benchmark" (case-insensitive). PaceBenchmark runs will be shown; Primer and Check runs will be hidden.
                      </Text>
                    </Flex>
                    <Switch value={pendingBenchmarkFilter} onChange={setPendingBenchmarkFilter} />
                  </Flex>
                </Flex>

                <Flex flexDirection="column" gap={12}>
                  <Text style={sectionLabelStyle}>Request Detail Panel</Text>
                  <Flex justifyContent="space-between" alignItems="flex-start" gap={24}>
                    <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
                      <Text>Show missing lookup table notices</Text>
                      <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">
                        Display a notice for comparison tests that have no load test business events.
                      </Text>
                    </Flex>
                    <Switch value={pendingShowMissing} onChange={setPendingShowMissing} />
                  </Flex>
                </Flex>

              </Flex>
            )}

            {/* Access Control — admin only, always interactive */}
            {isAdmin && (
              <Flex flexDirection="column" gap={8}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={sectionLabelStyle}>Access Control</span>
                  <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.08)" }} />
                </div>
                <Text textStyle="small" style={{ color: "#636670" }}>
                  Restrict settings editing to specific users by email. An empty list grants all users edit access.
                </Text>

                {pendingAdmins.length === 0 && (
                  <div style={{ fontSize: "0.82em", color: "#636670", fontStyle: "italic" }}>
                    No restrictions — all users can edit settings.
                  </div>
                )}

                {pendingAdmins.map(email => (
                  <div key={email} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 10px", background: "rgba(255,255,255,0.04)", borderRadius: "4px", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span style={{ fontSize: "0.84em", color: "#c8ccd4" }}>
                      {email}
                      {email === currentUserEmail && <span style={{ marginLeft: "8px", fontSize: "0.8em", color: "#6e91e6" }}>(you)</span>}
                    </span>
                    <button onClick={() => setPendingAdmins(prev => prev.filter(e => e !== email))}
                      style={{ ...ghostBtn("#e8323e"), border: "1px solid rgba(232,50,62,0.2)", padding: "2px 7px", fontSize: "0.72em" }}>
                      Remove
                    </button>
                  </div>
                ))}

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input type="email" value={newAdminEmail}
                    onChange={e => { setNewAdminEmail(e.target.value); setAdminEmailError(null); }}
                    onKeyDown={e => { if (e.key === "Enter") addAdminEmail(); }}
                    placeholder="user@example.com"
                    style={{ ...textInputStyle, flex: 1 }} />
                  <button onClick={addAdminEmail}
                    style={{ ...ghostBtn("#6e91e6"), border: "1px solid rgba(110,145,230,0.4)", padding: "3px 10px", fontSize: "0.78em", whiteSpace: "nowrap" }}>
                    + Add
                  </button>
                </div>
                {adminEmailError && <Text textStyle="small" style={{ color: "#e8323e" }}>{adminEmailError}</Text>}

                {pendingAdmins.length > 0 && !pendingAdmins.includes(currentUserEmail) && (
                  <div style={{ fontSize: "0.78em", color: "#e8a040", background: "rgba(232,160,64,0.08)", border: "1px solid rgba(232,160,64,0.25)", borderRadius: "4px", padding: "7px 10px" }}>
                    Warning: your email ({currentUserEmail}) is not in the admin list. You will lose edit access after saving.
                  </div>
                )}
              </Flex>
            )}

            <TabSaveFooter
              onSave={saveGeneral}
              saved={savedTab === TAB_GENERAL}
              dirty={generalDirty}
              disabled={!isAdmin}
            />
          </Flex>
        </Tab>

        {/* ── SLO Configuration tab ── */}
        <Tab title="SLO Configuration">
          <Flex flexDirection="column" gap={12} style={{ paddingTop: "16px" }}>

            <Text textStyle="small" style={{ color: "#636670" }}>
              SLOs are matched by <strong style={{ color: "#8e9099" }}>Test Step</strong> (na_keptn) and <strong style={{ color: "#8e9099" }}>Request</strong> name (case-insensitive).
              The <strong style={{ color: "#8e9099" }}>vs SLO</strong> column in Request Details shows pass/fail against avg response time.
            </Text>

            {readOnlyWrapper(
              <Flex flexDirection="column" gap={12}>
                <Flex justifyContent="flex-end" gap={8}>
                  <button onClick={() => { setCsvText(exportSlosCsv(pendingSlos)); setShowCsvImport(true); setCsvError(null); }} style={ghostBtn()}>
                    Export CSV
                  </button>
                  <button onClick={() => setPendingSlos(DEFAULT_SLO_ENTRIES)} style={ghostBtn()}>
                    Reset to defaults
                  </button>
                </Flex>

                <SloTable entries={pendingSlos} onChange={setPendingSlos} />

                {/* CSV import */}
                <button
                  onClick={() => { setShowCsvImport(v => !v); setCsvText(""); setCsvError(null); }}
                  style={{ alignSelf: "flex-start", ...ghostBtn("#6e91e6"), border: "1px solid rgba(110,145,230,0.35)", padding: "4px 10px", fontSize: "0.78em" }}>
                  {showCsvImport ? "▲ Hide CSV import" : "▼ Import from CSV"}
                </button>

                {showCsvImport && (
                  <Flex flexDirection="column" gap={8}>
                    <Text textStyle="small" style={{ color: "#636670" }}>
                      Paste CSV: <code style={{ color: "#c8ccd4" }}>step,request,slo_ms</code> or <code style={{ color: "#c8ccd4" }}>project,step,request,slo_ms</code>{" "}
                      (or <code style={{ color: "#c8ccd4" }}>slo_sec</code> — values ≤120 treated as seconds).
                      Lines starting with <code style={{ color: "#c8ccd4" }}>#</code> are ignored.{" "}
                      <strong style={{ color: "#e8a040" }}>Replaces</strong> all current entries.
                    </Text>
                    <textarea
                      value={csvText}
                      onChange={e => { setCsvText(e.target.value); setCsvError(null); }}
                      rows={10}
                      placeholder={"step,request,slo_ms\nAddFundProFlow_v4,01_GetAccessToken,900\nAddFundProFlow_v4,02_AddFundAcct,950"}
                      style={{ width: "100%", fontFamily: "monospace", fontSize: "0.78em", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", color: "#c8ccd4", padding: "8px", resize: "vertical", outline: "none" }}
                    />
                    {csvError && <Text textStyle="small" style={{ color: "#e8323e" }}>{csvError}</Text>}
                    <Flex gap={8}>
                      <button onClick={applyCsv}
                        style={{ background: "rgba(110,145,230,0.2)", border: "1px solid rgba(110,145,230,0.4)", borderRadius: "4px", color: "#6e91e6", fontSize: "0.78em", padding: "4px 12px", cursor: "pointer", fontWeight: 600 }}>
                        Apply ({csvText ? parseSlosCsv(csvText).length : 0} entries)
                      </button>
                      <button onClick={() => { setShowCsvImport(false); setCsvText(""); setCsvError(null); }} style={{ ...ghostBtn(), padding: "4px 10px" }}>
                        Cancel
                      </button>
                    </Flex>
                  </Flex>
                )}
              </Flex>
            )}

            <TabSaveFooter
              onSave={saveSlos}
              saved={savedTab === TAB_SLO}
              dirty={slosDirty}
              disabled={!isAdmin}
            />
          </Flex>
        </Tab>

        {/* ── Comparison Thresholds tab ── */}
        <Tab title="Comparison Thresholds">
          <Flex flexDirection="column" gap={20} style={{ paddingTop: "16px" }}>

            {readOnlyWrapper(
              <Flex flexDirection="column" gap={12}>

                {/* Request comparison thresholds */}
                <Flex justifyContent="space-between" alignItems="center">
                  <Text style={sectionLabelStyle}>Request Comparison Thresholds</Text>
                  <button
                    onClick={() => { setPendingThresholds({ ...DEFAULT_THRESHOLDS }); setPendingTechThresholds({ ...DEFAULT_TECH_THRESHOLDS }); }}
                    style={ghostBtn()}>Reset all to defaults</button>
                </Flex>
                <Text textStyle="small" style={{ color: "#636670" }}>
                  Colours a delta red when the primary test is worse by the configured threshold.
                  <br />
                  <strong style={{ color: "#8e9099" }}>Relative</strong>: fires when value deviates from comparison by ≥X%.{" "}
                  <strong style={{ color: "#8e9099" }}>Static</strong>: fires when value crosses a fixed limit.{" "}
                  When both are on, <strong style={{ color: "#8e9099" }}>AND</strong> requires both; <strong style={{ color: "#8e9099" }}>OR</strong> requires either.
                </Text>
                <div style={{ display: "grid", gridTemplateColumns: thresholdGrid, gap: "0 8px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  {thresholdColHeaders.map(h => <span key={h} style={{ fontSize: "0.68em", color: "#555a65", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>)}
                </div>
                {METRIC_CATEGORY_DEFS.map(({ key, label, unit }) => {
                  const t = pendingThresholds[key];
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

                {/* Tech metric thresholds */}
                <div style={{ marginTop: "16px" }}>
                  <Text style={{ ...sectionLabelStyle, marginBottom: "8px", display: "block" }}>Tech-Specific Metric Thresholds</Text>
                  <Text textStyle="small" style={{ color: "#636670", marginBottom: "12px", display: "block" }}>
                    These thresholds apply to runtime metrics in the Infrastructure Panel. Same relative / static / AND-OR logic as above.
                  </Text>
                  {TECH_METRIC_GROUPS.map((group, gi) => (
                    <div key={group.label}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "10px 0 6px" }}>
                        <span style={{ fontSize: "0.72em", fontWeight: 700, color: "#6e91e6", textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>
                          {group.label}
                        </span>
                        <div style={{ flex: 1, height: "1px", background: "rgba(110,145,230,0.2)" }} />
                      </div>
                      {gi === 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: thresholdGrid, gap: "0 8px", paddingBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                          {thresholdColHeaders.map(h => <span key={h} style={{ fontSize: "0.68em", color: "#555a65", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>)}
                        </div>
                      )}
                      {group.defs.map((def: TechMetricDef) => {
                        const t = pendingTechThresholds[def.metricKey] ?? DEFAULT_TECH_THRESHOLDS[def.metricKey];
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
                </div>
              </Flex>
            )}

            <TabSaveFooter
              onSave={saveThresholds}
              saved={savedTab === TAB_THRESHOLDS}
              dirty={thresholdsDirty}
              disabled={!isAdmin}
            />
          </Flex>
        </Tab>

      </Tabs>
    </Sheet>
  );
};
