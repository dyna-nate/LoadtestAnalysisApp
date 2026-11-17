import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import type { TestExecution } from "../context/SelectedTestContext";
import { TECH_TYPE_LABELS } from "../utils/infraMetricConfig";
import type { ReportTest, ResourceEntity, ResourceSnapshot, TxnAgg } from "./reportTypes";

type Rec = Record<string, unknown>;

const RT_TYPES = `"neoload.responsetime.detailed", "loadtest.responsetime.detailed"`;
const SVC_TYPES = `"neoload.services.detailed", "loadtest.services.detailed"`;

async function runDql(query: string): Promise<Rec[]> {
  const res = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 60000, maxResultRecords: 10000 },
  });
  return (res.result?.records ?? []) as Rec[];
}

/** Like runDql but a failure yields [] (so a missing metric never blocks the whole report). */
async function runDqlSafe(query: string): Promise<{ records: Rec[]; error?: string }> {
  try {
    return { records: await runDql(query) };
  } catch (e) {
    return { records: [], error: e instanceof Error ? e.message : String(e) };
  }
}

const str = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v) : "");
const q = (ids: string[]) => ids.map((id) => `"${id}"`).join(", ");
const toNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const avg = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs: (number | null | undefined)[]): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};
const arrAvg = (v: unknown) => avg((v as (number | null)[] | undefined) ?? []);
const arrSum = (v: unknown) => sum((v as (number | null)[] | undefined) ?? []);

export function toReportTest(t: TestExecution): ReportTest {
  const start = new Date(t.test_start).getTime();
  const end = new Date(t.test_end).getTime();
  const explicit = t.test_duration_ms != null ? Number(t.test_duration_ms) : NaN;
  return {
    te_uuid: t.te_uuid,
    test_execution: t.test_execution,
    test_start: t.test_start,
    test_end: t.test_end,
    durationMs: Number.isFinite(explicit) ? explicit : Number.isFinite(end - start) ? end - start : null,
  };
}

// ── Transactions ──────────────────────────────────────────────────────────────

/** Count-weighted aggregation by transaction, done in DQL so large tests stay within record limits. */
export async function loadTransactions(teUuid: string): Promise<TxnAgg[]> {
  const pcts = ["avg", "p50", "p90", "p95", "p99"];
  const weighted = pcts.map((p) => `${p}_w = sum(toDouble(${p}_dur_ms) * w)`).join(", ");
  const query = [
    `fetch bizevents, from: -365d`,
    `| filter in(event.type, {${RT_TYPES}}) | filter te_uuid == "${teUuid}" | fieldsAdd transaction_name = coalesce(transaction_name, na_keptn)`,
    `| fieldsAdd w = toDouble(count)`,
    `| summarize cnt = sum(w), fails = sum(toDouble(fail_count)), ${weighted}, by: { transaction_name }`,
  ].join(" ");
  const recs = await runDql(query);
  return recs
    .map((r) => {
      const cnt = toNum(r.cnt) ?? 0;
      const w = (k: string) => { const v = toNum(r[`${k}_w`]); return v != null && cnt > 0 ? v / cnt : null; };
      return {
        name: str(r.transaction_name),
        count: cnt,
        failCount: toNum(r.fails) ?? 0,
        avg: w("avg"), p50: w("p50"), p90: w("p90"), p95: w("p95"), p99: w("p99"),
      };
    })
    .filter((t) => t.name !== "");
}

// ── Services → processes → Kubernetes workloads ──────────────────────────────

interface TestServiceMap {
  /** service_id → { processIds, techType } */
  services: Map<string, { processIds: Set<string>; techType: string; exe: string }>;
}

async function loadServiceMap(teUuid: string): Promise<TestServiceMap> {
  const recs = await runDql(
    `fetch bizevents, from: -365d | filter in(event.type, {${SVC_TYPES}}) | filter te_uuid == "${teUuid}" | fields services`
  );
  const services = new Map<string, { processIds: Set<string>; techType: string; exe: string }>();
  for (const r of recs) {
    let arr: unknown;
    try { arr = typeof r.services === "string" ? JSON.parse(r.services) : r.services; } catch { continue; }
    if (!Array.isArray(arr)) continue;
    for (const e of arr as Rec[]) {
      const sid = e.service_id as string | undefined;
      if (!sid) continue;
      const entry = services.get(sid) ?? { processIds: new Set<string>(), techType: str(e.tech_type), exe: str(e.process_exe) };
      if (e.process_id_classic) entry.processIds.add(str(e.process_id_classic));
      services.set(sid, entry);
    }
  }
  return { services };
}

export interface TestResources {
  names: Map<string, string>;
  techTypes: Map<string, string>;
  snapshots: Map<string, ResourceSnapshot>;
  serviceRequests: number | null;
  notes: string[];
}

const EMPTY_SNAP: ResourceSnapshot = {
  cpuPct: null, memMiB: null, cpuRequestM: null, cpuLimitM: null, memRequestMiB: null, memLimitMiB: null, gcPct: null,
};

export async function loadTestResources(test: ReportTest): Promise<TestResources> {
  const notes: string[] = [];
  const { services } = await loadServiceMap(test.te_uuid);
  const serviceIds = [...services.keys()];
  const processIds = [...new Set([...services.values()].flatMap((s) => [...s.processIds]))];
  const out: TestResources = { names: new Map(), techTypes: new Map(), snapshots: new Map(), serviceRequests: null, notes };
  if (serviceIds.length === 0) { notes.push(`No service mapping found for test ${test.test_execution}.`); return out; }

  const { test_start: from, test_end: to } = test;
  const win = `from: "${from}", to: "${to}"`;
  const procFilter = processIds.length ? `| filter in(dt.entity.process_group_instance, {${q(processIds)}})` : "";

  const [names, pgis, cpu, mem, gc, reqs] = await Promise.all([
    runDqlSafe(`fetch dt.entity.service, from: now()-365d | filter in(id, {${q(serviceIds)}}) | fields id, entity.name`),
    processIds.length
      ? runDqlSafe(`fetch dt.entity.process_group_instance, from: now()-365d | filter in(id, {${q(processIds)}}) | fields id, belongs_to`)
      : Promise.resolve({ records: [] as Rec[], error: undefined as string | undefined }),
    runDqlSafe(`timeseries v = avg(dt.process.cpu.usage), ${win}, by: { dt.entity.process_group_instance } ${procFilter}`),
    runDqlSafe(`timeseries v = avg(dt.process.memory.usage), ${win}, by: { dt.entity.process_group_instance } ${procFilter}`),
    runDqlSafe(`timeseries v = sum(dt.runtime.jvm.gc.collection_time), ${win}, by: { dt.entity.process_group_instance } ${procFilter}`),
    runDqlSafe(`timeseries v = sum(dt.service.request.count), ${win}, by: { dt.entity.service } | filter in(dt.entity.service, {${q(serviceIds)}})`),
  ]);
  for (const [label, r] of [["names", names], ["processes", pgis], ["CPU", cpu], ["memory", mem], ["GC", gc], ["service requests", reqs]] as const) {
    if (r.error) notes.push(`Could not load ${label} for ${test.test_execution}: ${r.error}`);
  }

  for (const r of names.records) out.names.set(String(r.id), String(r["entity.name"] ?? r.id));
  const byProc = (res: { records: Rec[] }, f: (v: unknown) => number | null) => {
    const m = new Map<string, number | null>();
    for (const r of res.records) m.set(String(r["dt.entity.process_group_instance"]), f(r.v));
    return m;
  };
  const cpuBy = byProc(cpu, arrAvg), memBy = byProc(mem, arrAvg), gcBy = byProc(gc, arrSum);
  out.serviceRequests = sum(reqs.records.map((r) => arrSum(r.v)));

  // Process instance → container group instance → Kubernetes workload (cloud application)
  const cgiByProc = new Map<string, string>();
  for (const r of pgis.records) {
    const b = r.belongs_to as Rec | undefined;
    const cgi = b?.["dt.entity.container_group_instance"];
    if (cgi) cgiByProc.set(str(r.id), str(cgi));
  }
  const cgiIds = [...new Set(cgiByProc.values())];
  const cgiRes: { records: Rec[]; error?: string } = cgiIds.length
    ? await runDqlSafe(`fetch dt.entity.container_group_instance, from: now()-365d | filter in(id, {${q(cgiIds)}}) | fields id, belongs_to`)
    : { records: [] as Rec[] };
  if (cgiRes.error) notes.push(`Could not resolve Kubernetes workloads for ${test.test_execution}: ${cgiRes.error}`);
  const appByCgi = new Map<string, string>();
  for (const r of cgiRes.records) {
    const app = (r.belongs_to as Rec | undefined)?.["dt.entity.cloud_application"];
    if (app) appByCgi.set(str(r.id), str(app));
  }
  const appByProc = new Map<string, string>();
  for (const [pid, cgi] of cgiByProc) { const a = appByCgi.get(cgi); if (a) appByProc.set(pid, a); }
  const appIds = [...new Set(appByProc.values())];

  const k8s = appIds.length
    ? await runDqlSafe(
        `timeseries { rc = avg(dt.kubernetes.container.requests_cpu), lc = avg(dt.kubernetes.container.limits_cpu), ` +
        `rm = avg(dt.kubernetes.container.requests_memory), lm = avg(dt.kubernetes.container.limits_memory) }, ` +
        `${win}, by: { dt.entity.cloud_application } | filter in(dt.entity.cloud_application, {${q(appIds)}})`)
    : { records: [] as Rec[], error: undefined };
  if (k8s.error) notes.push(`Could not load Kubernetes requests/limits for ${test.test_execution}: ${k8s.error}`);
  const k8sByApp = new Map<string, { rc: number | null; lc: number | null; rm: number | null; lm: number | null }>();
  for (const r of k8s.records) {
    k8sByApp.set(String(r["dt.entity.cloud_application"]), { rc: arrAvg(r.rc), lc: arrAvg(r.lc), rm: arrAvg(r.rm), lm: arrAvg(r.lm) });
  }

  const MiB = 1024 * 1024;
  for (const [sid, svc] of services) {
    const pids = [...svc.processIds];
    const apps = [...new Set(pids.map((p) => appByProc.get(p)).filter((a): a is string => !!a))];
    const k = apps.map((a) => k8sByApp.get(a)).filter((x): x is NonNullable<typeof x> => !!x);
    const memAvg = avg(pids.map((p) => memBy.get(p)));
    const gcSums = pids.map((p) => gcBy.get(p)).filter((v): v is number => v != null);
    const windowMs = test.durationMs ?? (new Date(to).getTime() - new Date(from).getTime());
    out.names.set(sid, out.names.get(sid) ?? svc.exe ?? sid);
    out.techTypes.set(sid, svc.techType);
    out.snapshots.set(sid, {
      cpuPct: avg(pids.map((p) => cpuBy.get(p))),
      memMiB: memAvg != null ? memAvg / MiB : null,
      cpuRequestM: avg(k.map((x) => x.rc)),
      cpuLimitM: avg(k.map((x) => x.lc)),
      memRequestMiB: (() => { const v = avg(k.map((x) => x.rm)); return v != null ? v / MiB : null; })(),
      memLimitMiB: (() => { const v = avg(k.map((x) => x.lm)); return v != null ? v / MiB : null; })(),
      // GC overhead = total GC collection time (ms) ÷ test runtime (ms) × 100, averaged across the service's JVMs
      gcPct: gcSums.length && windowMs > 0 ? avg(gcSums.map((ms) => (ms / windowMs) * 100)) : null,
    });
  }
  return out;
}

export function mergeResources(baseline: TestResources, current: TestResources): ResourceEntity[] {
  const keys = new Set([...baseline.snapshots.keys(), ...current.snapshots.keys()]);
  return [...keys].map((key) => {
    const techType = current.techTypes.get(key) ?? baseline.techTypes.get(key) ?? "";
    return {
      key,
      name: current.names.get(key) ?? baseline.names.get(key) ?? key,
      techType: TECH_TYPE_LABELS[techType] ?? techType,
      baseline: baseline.snapshots.get(key) ?? { ...EMPTY_SNAP },
      current: current.snapshots.get(key) ?? { ...EMPTY_SNAP },
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
