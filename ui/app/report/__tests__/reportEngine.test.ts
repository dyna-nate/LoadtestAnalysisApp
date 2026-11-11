import { describe, expect, it } from "vitest";
import {
  configChangeVerdict, deltaPct, evaluateReport, gcVerdict, overallVerdict, thresholdVerdict, worstVerdict,
} from "../reportEngine";
import { DEFAULT_THRESHOLDS } from "../../utils/thresholds";
import { baseInputs, CONFIG, snap, txn } from "./fixtures";

describe("helpers", () => {
  it("computes delta percent per the spec formula", () => {
    expect(deltaPct(110, 100)).toBeCloseTo(10);
    expect(deltaPct(90, 100)).toBeCloseTo(-10);
    expect(deltaPct(10, 0)).toBeNull();
    expect(deltaPct(null, 5)).toBeNull();
  });

  it("worstVerdict / overallVerdict: any FAIL fails overall", () => {
    expect(worstVerdict(["PASS", "WARNING", "FAIL", "N/A"])).toBe("FAIL");
    expect(worstVerdict(["PASS", "N/A"])).toBe("PASS");
    const rule = (verdict: any) => ({ id: "cpu" as const, title: "", verdict, summary: "" });
    expect(overallVerdict([rule("PASS"), rule("WARNING"), rule("FAIL")])).toBe("FAIL");
    expect(overallVerdict([rule("PASS"), rule("WARNING")])).toBe("WARNING");
    expect(overallVerdict([rule("PASS"), rule("N/A")])).toBe("PASS");
    expect(overallVerdict([rule("N/A")])).toBe("WARNING"); // nothing evaluable is never a silent PASS
  });

  it("thresholdVerdict: FAIL past threshold, WARNING past half, PASS otherwise", () => {
    const t = DEFAULT_THRESHOLDS.responseTime; // +20%
    expect(thresholdVerdict(125, 100, true, t, 0.5)).toBe("FAIL");
    expect(thresholdVerdict(112, 100, true, t, 0.5)).toBe("WARNING");
    expect(thresholdVerdict(105, 100, true, t, 0.5)).toBe("PASS");
    expect(thresholdVerdict(null, 100, true, t, 0.5)).toBe("N/A");
    expect(thresholdVerdict(100, null, true, t, 0.5)).toBe("N/A");
  });

  it("thresholdVerdict respects betterIsLower=false (throughput drop)", () => {
    const t = DEFAULT_THRESHOLDS.requestCount; // -20%
    expect(thresholdVerdict(70, 100, false, t, 0.5)).toBe("FAIL");
    expect(thresholdVerdict(88, 100, false, t, 0.5)).toBe("WARNING");
    expect(thresholdVerdict(120, 100, false, t, 0.5)).toBe("PASS");
  });

  it("configChangeVerdict flags any change, fails past threshold", () => {
    expect(configChangeVerdict(500, 500, 50)).toBe("PASS");
    expect(configChangeVerdict(600, 500, 50)).toBe("WARNING");
    expect(configChangeVerdict(1000, 500, 50)).toBe("FAIL");
    expect(configChangeVerdict(200, 500, 50)).toBe("FAIL"); // decreases are changes too
    expect(configChangeVerdict(500, 0, 50)).toBe("WARNING");
    expect(configChangeVerdict(null, 500, 50)).toBe("N/A");
  });

  it("gcVerdict uses warning and failure thresholds", () => {
    expect(gcVerdict(2, 5, 10)).toBe("PASS");
    expect(gcVerdict(5, 5, 10)).toBe("WARNING");
    expect(gcVerdict(12, 5, 10)).toBe("FAIL");
    expect(gcVerdict(null, 5, 10)).toBe("N/A");
  });
});

describe("evaluateReport", () => {
  it("passes when current matches baseline", () => {
    const r = evaluateReport(baseInputs());
    expect(r.overall).toBe("PASS");
    expect(r.rules.map((x) => x.verdict)).toEqual(["PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
    expect(r.warnings).toHaveLength(0);
    expect(r.auditStatement).toContain("RECOMMENDED FOR APPROVAL");
  });

  it("fails overall when a single transaction regresses past the threshold", () => {
    const r = evaluateReport(baseInputs({ currentTxns: [txn("Login", 205), txn("Search", 600)] }));
    expect(r.overall).toBe("FAIL");
    expect(r.rules.find((x) => x.id === "performance")!.verdict).toBe("FAIL");
    expect(r.performance.rows[0].transaction).toBe("Search"); // worst first
    expect(r.performance.rows[0].deltaPct).toBeCloseTo(50);
    expect(r.auditStatement).toContain("NOT recommended".toUpperCase());
  });

  it("warns (not fails) for a moderate regression", () => {
    const r = evaluateReport(baseInputs({ currentTxns: [txn("Login", 224), txn("Search", 410)] })); // +12%
    expect(r.overall).toBe("WARNING");
  });

  it("flags error rate regression", () => {
    const r = evaluateReport(baseInputs({
      baselineTxns: [txn("Login", 200, 1000, 10)], // 1%
      currentTxns: [txn("Login", 200, 1000, 40)],  // 4%
    }));
    expect(r.errors.rows[0].scope).toBe("Overall");
    expect(r.errors.rows[0].currentRatePct).toBeCloseTo(4);
    expect(r.rules.find((x) => x.id === "errors")!.verdict).toBe("FAIL");
  });

  it("per-transaction error rows are informational and do not drive the rule", () => {
    const r = evaluateReport(baseInputs({
      baselineTxns: [txn("A", 100, 1000, 0), txn("B", 100, 5, 0)],
      currentTxns: [txn("A", 100, 1000, 0), txn("B", 100, 5, 5)],
    }));
    const b = r.errors.rows.find((x) => x.scope === "B")!;
    expect(b.informational).toBe(true);
    expect(r.errors.rows[0].scope).toBe("Overall");
  });

  it("detects throughput degradation using rates, not raw counts", () => {
    const r = evaluateReport(baseInputs({
      currentTxns: [txn("Login", 200, 600), txn("Search", 400, 600)], // 1200 vs 2000 over same duration
    }));
    const tps = r.throughput.rows.find((x) => x.unit === "tx/s")!;
    expect(tps.baseline).toBeCloseTo(2000 / 3600);
    expect(tps.current).toBeCloseTo(1200 / 3600);
    expect(tps.status).toBe("FAIL");
  });

  it("normalises throughput for different durations and warns about mismatch", () => {
    const inputs = baseInputs();
    inputs.current = { ...inputs.current, durationMs: 1800_000 }; // half as long, same counts => 2x TPS
    const r = evaluateReport(inputs);
    expect(r.throughput.rows[0].status).toBe("PASS");
    expect(r.warnings.join(" ")).toMatch(/durations differ by 50%/);
  });

  it("flags CPU/memory request and limit changes", () => {
    const r = evaluateReport(baseInputs({
      resources: [{ key: "k", name: "svc", techType: "SPRINGBOOT",
        baseline: snap(), current: snap({ cpuLimitM: 1100, memLimitMiB: 4096 }) }],
    }));
    const cpuLimit = r.cpu.rows.find((x) => x.metric === "CPU limit")!;
    const memLimit = r.memory.rows.find((x) => x.metric === "Memory limit")!;
    expect(cpuLimit.status).toBe("WARNING"); // +10% < 50%
    expect(memLimit.status).toBe("FAIL");    // +300%
    expect(r.overall).toBe("FAIL");
  });

  it("evaluates GC overhead and marks N/A without JVM metrics", () => {
    const high = evaluateReport(baseInputs({
      resources: [{ key: "k", name: "svc", techType: "TOMCAT", baseline: snap(), current: snap({ gcPct: 12 }) }],
    }));
    expect(high.rules.find((x) => x.id === "gc")!.verdict).toBe("FAIL");

    const none = evaluateReport(baseInputs({
      resources: [{ key: "k", name: "svc", techType: "NODE_JS", baseline: snap({ gcPct: null }), current: snap({ gcPct: null }) }],
    }));
    const gc = none.rules.find((x) => x.id === "gc")!;
    expect(gc.verdict).toBe("N/A");
    expect(gc.summary).toMatch(/Not applicable/);
    expect(none.overall).toBe("PASS"); // N/A does not fail the release
  });

  it("honours configurable thresholds", () => {
    const strict = structuredClone(CONFIG);
    strict.thresholds.responseTime.relPct = 1;
    const r = evaluateReport(baseInputs({ config: strict })); // +2.5% now exceeds 1%
    expect(r.rules.find((x) => x.id === "performance")!.verdict).toBe("FAIL");
  });

  it("snapshots the config used into the report", () => {
    const r = evaluateReport(baseInputs());
    expect(r.config.thresholds.responseTime.relPct).toBe(20);
    expect(r.schemaVersion).toBe(1);
    expect(r.id).toMatch(/^\d{14}-aaaaaaaa$/);
  });
});
