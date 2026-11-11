import { stateClient } from "@dynatrace-sdk/client-state";
import type { ReleaseReport, Verdict } from "./reportTypes";

const INDEX_KEY = "neoload-report-index";
const REPORT_KEY = (id: string) => `neoload-report-${id}`;
const MAX_INDEX = 200;

export interface ReportIndexEntry {
  id: string;
  generatedAt: string;
  application: string;
  environment: string;
  release: string;
  baselineRelease: string;
  overall: Verdict;
}

async function readValue(key: string): Promise<string | undefined> {
  const states = await stateClient.getAppStates({ filter: `key = '${key}'`, addFields: "value" });
  return states[0]?.value;
}

export async function listReports(): Promise<ReportIndexEntry[]> {
  const raw = await readValue(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReportIndexEntry[]) : [];
  } catch {
    return [];
  }
}

/** Persist a full report (immutable audit record) and add it to the index. */
export async function saveReport(report: ReleaseReport): Promise<void> {
  await stateClient.setAppState({ key: REPORT_KEY(report.id), body: { value: JSON.stringify(report) } });
  const index = (await listReports()).filter((e) => e.id !== report.id);
  index.unshift({
    id: report.id,
    generatedAt: report.meta.generatedAt,
    application: report.meta.application,
    environment: report.meta.environment,
    release: report.meta.release,
    baselineRelease: report.meta.baselineRelease,
    overall: report.overall,
  });
  await stateClient.setAppState({ key: INDEX_KEY, body: { value: JSON.stringify(index.slice(0, MAX_INDEX)) } });
}

export async function loadReport(id: string): Promise<ReleaseReport | null> {
  const raw = await readValue(REPORT_KEY(id));
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as ReleaseReport;
    return r?.schemaVersion === 1 ? r : null;
  } catch {
    return null;
  }
}
