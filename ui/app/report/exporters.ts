import { fmtDuration } from "./reportEngine";
import type { ReleaseReport, Verdict } from "./reportTypes";

// ── Formatting ────────────────────────────────────────────────────────────────

export function escapeHtml(s: unknown): string {
  return (typeof s === "string" || typeof s === "number" ? String(s) : "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const num = (v: number | null, digits = 1): string =>
  v == null || isNaN(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits });
const pct = (v: number | null): string => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);

const VERDICT_COLOR: Record<Verdict, string> = {
  PASS: "#1a7f37", WARNING: "#b35900", FAIL: "#c62828", "N/A": "#6b7280",
};

const badge = (v: Verdict) =>
  `<span class="badge" style="background:${VERDICT_COLOR[v]}">${escapeHtml(v)}</span>`;

// ── SVG grouped bar chart (baseline vs current) ──────────────────────────────

export interface BarDatum { label: string; baseline: number | null; current: number | null }

export function barChartSvg(title: string, unit: string, data: BarDatum[], maxBars = 12): string {
  const rows = data.filter((d) => d.baseline != null || d.current != null).slice(0, maxBars);
  if (rows.length === 0) return "";
  const labelW = 220, chartW = 420, rowH = 30, top = 28;
  const max = Math.max(...rows.flatMap((d) => [d.baseline ?? 0, d.current ?? 0]), 1e-9);
  const h = top + rows.length * rowH + 8;
  const bar = (v: number | null, y: number, color: string) =>
    v == null ? "" : `<rect x="${labelW}" y="${y}" width="${Math.max(1, (v / max) * chartW)}" height="10" fill="${color}"/>` +
      `<text x="${labelW + Math.max(1, (v / max) * chartW) + 4}" y="${y + 9}" font-size="9" fill="#374151">${escapeHtml(num(v, 2))}</text>`;
  const body = rows.map((d, i) => {
    const y = top + i * rowH;
    const label = d.label.length > 34 ? d.label.slice(0, 33) + "…" : d.label;
    return `<text x="${labelW - 6}" y="${y + 14}" font-size="10" text-anchor="end" fill="#111827">${escapeHtml(label)}</text>` +
      bar(d.baseline, y + 2, "#9ca3af") + bar(d.current, y + 14, "#2563eb");
  }).join("");
  return `<figure><svg viewBox="0 0 ${labelW + chartW + 70} ${h}" width="100%" role="img" aria-label="${escapeHtml(title)}">` +
    `<text x="0" y="14" font-size="12" font-weight="600" fill="#111827">${escapeHtml(title)} (${escapeHtml(unit)})</text>` +
    `<rect x="${labelW + chartW - 150}" y="4" width="10" height="10" fill="#9ca3af"/><text x="${labelW + chartW - 136}" y="13" font-size="10">Baseline</text>` +
    `<rect x="${labelW + chartW - 80}" y="4" width="10" height="10" fill="#2563eb"/><text x="${labelW + chartW - 66}" y="13" font-size="10">Current</text>` +
    `${body}</svg></figure>`;
}

// ── HTML report (print-to-PDF friendly) ──────────────────────────────────────

function table(headers: string[], rows: (string | number)[][]): string {
  if (rows.length === 0) return `<p class="muted">No data.</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>` +
    rows.map((r) => `<tr>${r.map((c) => `<td>${String(c)}</td>`).join("")}</tr>`).join("") + `</tbody></table>`;
}

export function exportHtml(r: ReleaseReport): string {
  const m = r.meta;
  const perf = r.performance.rows;
  const metricLabel = r.performance.metric.toUpperCase();

  const cpuUsage = r.cpu.rows.filter((x) => x.metric === "CPU usage");
  const memUsage = r.memory.rows.filter((x) => x.metric === "Memory usage");

  const resourceTable = (rows: typeof r.cpu.rows) =>
    table(["Service / process", "Metric", "Baseline", "Current", "Δ %", "Status"],
      rows.map((x) => [escapeHtml(x.entity), escapeHtml(x.metric), `${num(x.baseline)} ${x.unit}`, `${num(x.current)} ${x.unit}`, pct(x.deltaPct), badge(x.status)]));

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>SRE Release Validation Report — ${escapeHtml(m.release || m.application)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color:#111827; max-width: 1000px; margin: 24px auto; padding: 0 16px; font-size: 13px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 28px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .muted { color:#6b7280; } .badge { color:#fff; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; white-space:nowrap; }
  .overall { display:inline-block; font-size:20px; padding:6px 18px; border-radius:6px; color:#fff; font-weight:700; }
  table { border-collapse: collapse; width:100%; margin: 6px 0 12px; } th, td { border:1px solid #e5e7eb; padding:4px 8px; text-align:left; vertical-align: top; }
  th { background:#f3f4f6; font-weight:600; } .meta td:first-child { width: 190px; font-weight:600; background:#f9fafb; }
  pre.audit { white-space: pre-wrap; background:#f9fafb; border:1px solid #e5e7eb; padding:12px; border-radius:4px; font-family: inherit; }
  .warn { background:#fff7ed; border:1px solid #fdba74; padding:8px 12px; border-radius:4px; margin:6px 0; }
  figure { margin: 8px 0; page-break-inside: avoid; } tr { page-break-inside: avoid; }
  @media print { body { margin: 0; max-width: none; } h2 { page-break-after: avoid; } .badge, .overall { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<h1>SRE Release Validation Report</h1>
<p class="muted">Evidence for Change Request attachment · Report ID ${escapeHtml(r.id)}</p>

<h2>Executive summary</h2>
<p><span class="overall" style="background:${VERDICT_COLOR[r.overall]}">${escapeHtml(r.overall)}</span></p>
<table class="meta"><tbody>
<tr><td>Application</td><td>${escapeHtml(m.application)}</td></tr>
<tr><td>Environment</td><td>${escapeHtml(m.environment)}</td></tr>
<tr><td>Current release</td><td>${escapeHtml(m.release)} — ${escapeHtml(r.current.test_execution)} (${escapeHtml(new Date(r.current.test_start).toUTCString())}, ${escapeHtml(fmtDuration(r.current.durationMs))})</td></tr>
<tr><td>Baseline release</td><td>${escapeHtml(m.baselineRelease)} — ${escapeHtml(r.baseline.test_execution)} (${escapeHtml(new Date(r.baseline.test_start).toUTCString())}, ${escapeHtml(fmtDuration(r.baseline.durationMs))})</td></tr>
<tr><td>Generated</td><td>${escapeHtml(new Date(m.generatedAt).toUTCString())}${m.generatedBy ? ` by ${escapeHtml(m.generatedBy)}` : ""}</td></tr>
</tbody></table>
${r.warnings.map((w) => `<div class="warn">⚠ ${escapeHtml(w)}</div>`).join("")}
${table(["SRE criterion", "Result", "Summary"], r.rules.map((x) => [escapeHtml(x.title), badge(x.verdict), escapeHtml(x.summary)]))}

<h2>Performance comparison (${escapeHtml(metricLabel)}, ms)</h2>
${barChartSvg(`Response time ${metricLabel}`, "ms", perf.map((x) => ({ label: x.transaction, baseline: x.baseline, current: x.current })))}
${table(["Transaction", "Baseline", "Current", "Δ %", "Status"],
    perf.map((x) => [escapeHtml(x.transaction), num(x.baseline), num(x.current), pct(x.deltaPct), badge(x.status)]))}

<h2>Throughput analysis</h2>
${barChartSvg("Throughput", "per metric", r.throughput.rows.map((x) => ({ label: `${x.metric} (${x.unit})`, baseline: x.baseline, current: x.current })))}
${table(["Metric", "Baseline", "Current", "Δ %", "Status"],
    r.throughput.rows.map((x) => [escapeHtml(x.metric), `${num(x.baseline, 2)} ${x.unit}`, `${num(x.current, 2)} ${x.unit}`, pct(x.deltaPct), badge(x.status)]))}

<h2>Error rate analysis</h2>
${barChartSvg("Error rate", "%", r.errors.rows.map((x) => ({ label: x.scope, baseline: x.baselineRatePct, current: x.currentRatePct })))}
${table(["Scope", "Baseline error rate", "Current error rate", "Failed (current / total)", "Status"],
    r.errors.rows.map((x) => [escapeHtml(x.scope) + (x.informational ? ' <span class="muted">(informational)</span>' : ""),
      x.baselineRatePct == null ? "—" : `${x.baselineRatePct.toFixed(2)}%`, x.currentRatePct == null ? "—" : `${x.currentRatePct.toFixed(2)}%`,
      `${x.currentFailed} / ${x.currentTotal}`, badge(x.status)]))}

<h2>CPU</h2>
${barChartSvg("CPU usage", "%", cpuUsage.map((x) => ({ label: x.entity, baseline: x.baseline, current: x.current })))}
${resourceTable(r.cpu.rows)}

<h2>Memory</h2>
${barChartSvg("Memory usage", "MiB", memUsage.map((x) => ({ label: x.entity, baseline: x.baseline, current: x.current })))}
${resourceTable(r.memory.rows)}

<h2>Java GC overhead</h2>
${r.gc.rows.length === 0 ? `<p>${badge("N/A")} Not applicable — no JVM GC metrics were found.</p>` : barChartSvg("GC overhead", "%", r.gc.rows.map((x) => ({ label: x.entity, baseline: x.baselinePct, current: x.currentPct }))) +
    table(["JVM process", "Baseline GC %", "Current GC %", "Status"],
      r.gc.rows.map((x) => [escapeHtml(x.entity), x.baselinePct == null ? "—" : `${x.baselinePct.toFixed(2)}%`, x.currentPct == null ? "—" : `${x.currentPct.toFixed(2)}%`, badge(x.status)]))}

<h2>Audit evidence statement</h2>
<pre class="audit">${escapeHtml(r.auditStatement)}</pre>

<h2>Thresholds applied</h2>
${table(["Setting", "Value"], [
  ["Response time (relative)", `${r.config.thresholds.responseTime.relPct}%${r.config.thresholds.responseTime.staticEnabled ? `, static ${r.config.thresholds.responseTime.staticValue} ms` : ""}`],
  ["Error rate (relative)", `${r.config.thresholds.errorRate.relPct}%${r.config.thresholds.errorRate.staticEnabled ? `, static ${r.config.thresholds.errorRate.staticValue}%` : ""}`],
  ["Throughput drop (relative)", `${r.config.thresholds.requestCount.relPct}%`],
  ["CPU (relative)", `${r.config.thresholds.cpu.relPct}%`],
  ["Memory (relative)", `${r.config.thresholds.memory.relPct}%`],
  ["GC overhead warning / failure", `${r.config.gcWarnPct}% / ${r.config.gcFailPct}%`],
  ["Warning level", `${Math.round(r.config.warnFraction * 100)}% of a relative threshold`],
].map((x) => x.map(escapeHtml)))}
<p class="muted">Print this page to PDF from your browser (Ctrl/Cmd+P → Save as PDF) to attach it to a Change Request.</p>
</body></html>`;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = typeof v === "string" || typeof v === "number" ? String(v) : "";
  // Neutralise spreadsheet formula injection from user-controlled text
  const safe = /^[=+\-@\t\r]/.test(s) && isNaN(Number(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function exportCsv(r: ReleaseReport): string {
  const rows: unknown[][] = [["section", "item", "metric", "unit", "baseline", "current", "delta_pct", "status"]];
  rows.push(["summary", "overall", "", "", "", "", "", r.overall]);
  for (const x of r.rules) rows.push(["rule", x.title, "", "", "", "", "", x.verdict]);
  for (const x of r.performance.rows) rows.push(["performance", x.transaction, r.performance.metric, "ms", x.baseline, x.current, x.deltaPct?.toFixed(2), x.status]);
  for (const x of r.throughput.rows) rows.push(["throughput", x.metric, "", x.unit, x.baseline, x.current, x.deltaPct?.toFixed(2), x.status]);
  for (const x of r.errors.rows) rows.push(["errors", x.scope, "error_rate", "%", x.baselineRatePct?.toFixed(3), x.currentRatePct?.toFixed(3), "", x.status]);
  for (const x of r.cpu.rows) rows.push(["cpu", x.entity, x.metric, x.unit, x.baseline, x.current, x.deltaPct?.toFixed(2), x.status]);
  for (const x of r.memory.rows) rows.push(["memory", x.entity, x.metric, x.unit, x.baseline, x.current, x.deltaPct?.toFixed(2), x.status]);
  for (const x of r.gc.rows) rows.push(["gc", x.entity, "gc_overhead", "%", x.baselinePct?.toFixed(3), x.currentPct?.toFixed(3), "", x.status]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

// ── JSON (API response format) ────────────────────────────────────────────────

export function exportJson(r: ReleaseReport): string {
  return JSON.stringify(r, null, 2);
}

// ── Browser download helper ───────────────────────────────────────────────────

export function downloadText(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportFilename(r: ReleaseReport, ext: string): string {
  const slug = (r.meta.release || r.meta.application || "release").replace(/[^a-z0-9._-]+/gi, "_");
  return `sre-release-validation_${slug}_${r.id}.${ext}`;
}
