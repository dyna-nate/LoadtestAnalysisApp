import React, { useEffect, useMemo, useRef, useState } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Select, TextInput, NumberInputV2, FormField, Label } from "@dynatrace/strato-components/forms";
import { useSelectedTest } from "../context/SelectedTestContext";
import { useSettings } from "../context/SettingsContext";
import { evaluateReport } from "../report/reportEngine";
import { loadTestResources, loadTransactions, mergeResources, toReportTest } from "../report/reportData";
import { downloadText, exportCsv, exportHtml, exportJson, reportFilename } from "../report/exporters";
import { listReports, loadReport, saveReport, type ReportIndexEntry } from "../report/reportStore";
import type { ReleaseReport, ReportConfig } from "../report/reportTypes";

const FIELD_STYLE: React.CSSProperties = { minWidth: 220 };

export const ReleaseReportPage: React.FC = () => {
  const { primaryTest, compareTests } = useSelectedTest();
  const { settings, updateSettings } = useSettings();

  const [application, setApplication] = useState("");
  const [environment, setEnvironment] = useState("");
  const [release, setRelease] = useState("");
  const [baselineRelease, setBaselineRelease] = useState("");
  const [baselineId, setBaselineId] = useState<string | null>(null);

  const [report, setReport] = useState<ReleaseReport | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [history, setHistory] = useState<ReportIndexEntry[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const baselineTest = useMemo(
    () => compareTests.find((t) => t.te_uuid === baselineId) ?? compareTests[0] ?? null,
    [compareTests, baselineId]
  );

  const refreshHistory = () => listReports().then(setHistory).catch(() => setHistory([]));
  useEffect(() => { void refreshHistory(); }, []);

  const rs = settings.report;
  const setRs = (patch: Partial<typeof rs>) => updateSettings({ report: { ...rs, ...patch } });

  const generate = async () => {
    if (!primaryTest || !baselineTest) return;
    setBusy("Generating report…"); setError(null); setSavedMsg(null); setNotes([]);
    try {
      const cur = toReportTest(primaryTest);
      const bas = toReportTest(baselineTest);
      const [curTxns, basTxns, curRes, basRes] = await Promise.all([
        loadTransactions(cur.te_uuid), loadTransactions(bas.te_uuid),
        loadTestResources(cur), loadTestResources(bas),
      ]);
      const config: ReportConfig = {
        thresholds: structuredClone(settings.thresholds),
        gcWarnPct: rs.gcWarnPct, gcFailPct: rs.gcFailPct,
        warnFraction: rs.warnFraction, durationMismatchPct: rs.durationMismatchPct, perfMetric: rs.perfMetric,
      };
      const r = evaluateReport({
        meta: {
          application, environment, release, baselineRelease,
          project: primaryTest.te_projectname, scenario: primaryTest.te_scenarioname,
          generatedAt: new Date().toISOString(),
        },
        current: cur, baseline: bas,
        currentTxns: curTxns, baselineTxns: basTxns,
        resources: mergeResources(basRes, curRes),
        serviceRequests: { baseline: basRes.serviceRequests, current: curRes.serviceRequests },
        config,
      });
      setNotes([...basRes.notes, ...curRes.notes]);
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!report) return;
    setBusy("Saving…"); setError(null);
    try {
      await saveReport(report);
      setSavedMsg(`Saved for audit as ${report.id}`);
      await refreshHistory();
    } catch (e) {
      setError(`Could not save report: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const openSaved = async (id: string) => {
    setBusy("Loading saved report…"); setError(null); setSavedMsg(null);
    try {
      const r = await loadReport(id);
      if (r) setReport(r); else setError("Saved report could not be read.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const html = useMemo(() => (report ? exportHtml(report) : ""), [report]);
  const ready = !!primaryTest && !!baselineTest && !busy;

  return (
    <Flex flexDirection="column" gap={16} padding={16}>
      <Heading level={2}>Release SRE Validation Report</Heading>
      <Text textStyle="small">
        Compares the primary test selected in the header against a historical (baseline) test and produces PASS / WARNING / FAIL
        evidence for a Change Request. Choose the primary test and one or more comparison tests above, then pick which one is the baseline.
      </Text>

      <Flex gap={12} flexWrap="wrap" alignItems="flex-end">
        <FormField style={FIELD_STYLE}><Label>Application</Label>
          <TextInput value={application} onChange={setApplication} placeholder="e.g. Fusion" /></FormField>
        <FormField style={FIELD_STYLE}><Label>Environment</Label>
          <TextInput value={environment} onChange={setEnvironment} placeholder="e.g. UAT" /></FormField>
        <FormField style={FIELD_STYLE}><Label>Release version</Label>
          <TextInput value={release} onChange={setRelease} placeholder="e.g. 2.5.0" /></FormField>
        <FormField style={FIELD_STYLE}><Label>Baseline release version</Label>
          <TextInput value={baselineRelease} onChange={setBaselineRelease} placeholder="e.g. 2.4.0" /></FormField>
        <FormField style={{ minWidth: 300 }}><Label>Baseline test</Label>
          <Select<string> value={baselineTest?.te_uuid ?? null} onChange={(v) => setBaselineId(v ?? null)} disabled={compareTests.length === 0}>
            <Select.Trigger placeholder="Select comparison tests in the header…" width="full" />
            <Select.Content>
              {compareTests.map((t) => (
                <Select.Option key={t.te_uuid} value={t.te_uuid}>{new Date(t.test_start).toLocaleString()}</Select.Option>
              ))}
            </Select.Content>
          </Select></FormField>
      </Flex>

      <details>
        <summary style={{ cursor: "pointer" }}>Report thresholds (response time, CPU, memory, error rate and throughput use the thresholds from Settings)</summary>
        <Flex gap={12} flexWrap="wrap" paddingTop={8}>
          <FormField style={{ width: 160 }}><Label>GC warning %</Label>
            <NumberInputV2 value={rs.gcWarnPct} onChange={(v) => v != null && setRs({ gcWarnPct: v })} /></FormField>
          <FormField style={{ width: 160 }}><Label>GC failure %</Label>
            <NumberInputV2 value={rs.gcFailPct} onChange={(v) => v != null && setRs({ gcFailPct: v })} /></FormField>
          <FormField style={{ width: 200 }}><Label>Warning level (fraction of threshold)</Label>
            <NumberInputV2 value={rs.warnFraction} min={0} max={1} step={0.1} onChange={(v) => v != null && setRs({ warnFraction: v })} /></FormField>
          <FormField style={{ width: 200 }}><Label>Duration mismatch warning %</Label>
            <NumberInputV2 value={rs.durationMismatchPct} onChange={(v) => v != null && setRs({ durationMismatchPct: v })} /></FormField>
          <FormField style={{ width: 200 }}><Label>Response time metric</Label>
            <Select<string> value={rs.perfMetric} onChange={(v) => v && setRs({ perfMetric: v as typeof rs.perfMetric })}>
              <Select.Trigger width="full" />
              <Select.Content>
                {["avg", "p50", "p90", "p95", "p99"].map((m) => <Select.Option key={m} value={m}>{m.toUpperCase()}</Select.Option>)}
              </Select.Content>
            </Select></FormField>
        </Flex>
      </details>

      <Flex gap={8} flexWrap="wrap" alignItems="center">
        <Button variant="accent" onClick={() => void generate()} disabled={!ready}>Generate report</Button>
        <Button onClick={() => void save()} disabled={!report || !!busy}>Save for audit</Button>
        <Button onClick={() => report && downloadText(reportFilename(report, "html"), exportHtml(report), "text/html")} disabled={!report}>Download HTML</Button>
        <Button onClick={() => iframeRef.current?.contentWindow?.print()} disabled={!report}>Print / Save as PDF</Button>
        <Button onClick={() => report && downloadText(reportFilename(report, "csv"), exportCsv(report), "text/csv")} disabled={!report}>Download CSV</Button>
        <Button onClick={() => report && downloadText(reportFilename(report, "json"), exportJson(report), "application/json")} disabled={!report}>Download JSON</Button>
        {busy && <Text>{busy}</Text>}
        {savedMsg && <Text>{savedMsg}</Text>}
      </Flex>
      {!primaryTest && <Text textStyle="small">Select a project, scenario and primary test in the header to begin.</Text>}
      {primaryTest && compareTests.length === 0 && <Text textStyle="small">Select at least one comparison test in the header to use as the baseline.</Text>}
      {error && <Text style={{ color: "#c62828" }}>{error}</Text>}
      {notes.length > 0 && (
        <details><summary>{notes.length} data note(s) — some metrics could not be loaded</summary>
          <ul>{notes.map((n, i) => <li key={i}><Text textStyle="small">{n}</Text></li>)}</ul></details>
      )}

      {report && (
        <iframe ref={iframeRef} title="Release validation report" srcDoc={html}
          style={{ width: "100%", height: "80vh", border: "1px solid #3a3d4a", borderRadius: 6, background: "#fff" }} />
      )}

      <Heading level={3}>Saved reports</Heading>
      {history.length === 0 ? <Text textStyle="small">No saved reports yet.</Text> : (
        <table style={{ borderCollapse: "collapse", fontSize: "0.9em" }}>
          <thead><tr>{["Generated", "Application", "Environment", "Release", "Baseline", "Result", ""].map((h) =>
            <th key={h} style={{ textAlign: "left", padding: "4px 12px" }}>{h}</th>)}</tr></thead>
          <tbody>{history.map((h) => (
            <tr key={h.id}>
              <td style={{ padding: "4px 12px" }}>{new Date(h.generatedAt).toLocaleString()}</td>
              <td style={{ padding: "4px 12px" }}>{h.application}</td>
              <td style={{ padding: "4px 12px" }}>{h.environment}</td>
              <td style={{ padding: "4px 12px" }}>{h.release}</td>
              <td style={{ padding: "4px 12px" }}>{h.baselineRelease}</td>
              <td style={{ padding: "4px 12px" }}><strong>{h.overall}</strong></td>
              <td style={{ padding: "4px 12px" }}><Button onClick={() => void openSaved(h.id)} disabled={!!busy}>Open</Button></td>
            </tr>))}
          </tbody>
        </table>
      )}
    </Flex>
  );
};
