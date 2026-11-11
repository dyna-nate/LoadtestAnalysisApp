import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { barChartSvg, escapeHtml, exportCsv, exportHtml, exportJson } from "../exporters";
import { evaluateReport } from "../reportEngine";
import { baseInputs, snap, txn } from "./fixtures";

const failing = () =>
  evaluateReport(baseInputs({
    currentTxns: [txn("Login", 205), txn("<script>alert(1)</script>", 700)],
    baselineTxns: [txn("Login", 200), txn("<script>alert(1)</script>", 400)],
    resources: [{ key: "k", name: "=cmd|' /C calc'!A0", techType: "SPRINGBOOT", baseline: snap(), current: snap({ gcPct: 7, cpuLimitM: 2000 }) }],
  }));

describe("exporters (integration of engine → report formats)", () => {
  it("HTML escapes user-controlled text", () => {
    const html = exportHtml(failing());
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
  });

  it("HTML contains executive summary, all sections, audit statement and print styles", () => {
    const html = exportHtml(failing());
    for (const s of ["Executive summary", "Performance comparison", "Throughput analysis", "Error rate analysis",
      "CPU", "Memory", "Java GC overhead", "Audit evidence statement", "Thresholds applied", "@media print"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain(">FAIL<");
    expect(html).toContain("<svg");
  });

  it("CSV has a header, a row per evaluated item, and neutralises formula injection", () => {
    const csv = exportCsv(failing());
    const lines = csv.split("\n");
    expect(lines[0]).toBe("section,item,metric,unit,baseline,current,delta_pct,status");
    expect(lines[1]).toBe("summary,overall,,,,,,FAIL");
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|,)=cmd/m);
  });

  it("JSON round-trips to an equal report", () => {
    const r = failing();
    expect(JSON.parse(exportJson(r))).toEqual(JSON.parse(JSON.stringify(r)));
  });

  it("bar chart returns empty string without data and truncates long labels", () => {
    expect(barChartSvg("t", "ms", [])).toBe("");
    expect(barChartSvg("t", "ms", [{ label: "x".repeat(80), baseline: 1, current: 2 }])).toContain("…");
  });

  it("writes a sample report when SAMPLE_OUT is set", () => {
    const out = process.env.SAMPLE_OUT;
    if (!out) return;
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}/sample-release-report.html`, exportHtml(failing()));
    writeFileSync(`${out}/sample-release-report.csv`, exportCsv(failing()));
    writeFileSync(`${out}/sample-release-report.json`, exportJson(failing()));
  });
});
