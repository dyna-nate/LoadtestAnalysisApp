import type { ReleaseReport, Verdict } from "./reportTypes";

const RECOMMENDATION: Record<Verdict, string> = {
  PASS: "Based on the results above, the release meets the SRE release requirements and is RECOMMENDED FOR APPROVAL.",
  WARNING: "The release shows warnings against the SRE release requirements. APPROVAL IS CONDITIONAL on review of the flagged items by the release owner.",
  FAIL: "The release does NOT meet the SRE release requirements. APPROVAL IS NOT RECOMMENDED until the failed items are resolved or formally accepted.",
  "N/A": "Insufficient data was available to evaluate the release.",
};

/** Human-readable statement suitable for pasting into a Change Request. */
export function buildAuditStatement(r: ReleaseReport): string {
  const when = new Date(r.meta.generatedAt).toUTCString();
  const { current, baseline, meta } = r;
  const app = [meta.application, meta.environment].filter(Boolean).join(" / ") || "the application";
  const lines: string[] = [];

  lines.push(
    `SRE Release Validation for ${app}, release ${meta.release || "(unspecified)"}, generated ${when}.`
  );
  lines.push(
    `Release evaluated: load test "${current.test_execution}" run at ${new Date(current.test_start).toUTCString()}. ` +
    `Baseline compared: "${baseline.test_execution}" run at ${new Date(baseline.test_start).toUTCString()}` +
    (meta.baselineRelease ? ` (release ${meta.baselineRelease}).` : ".")
  );
  lines.push(
    "Metrics analysed: business transaction response time, CPU and memory usage with Kubernetes request/limit changes, " +
    "Java GC overhead, error rate and throughput."
  );
  lines.push("Validation results:");
  for (const rule of r.rules) {
    lines.push(`  - ${rule.title}: ${rule.verdict}. ${rule.summary}`);
  }
  lines.push(`Overall validation outcome: ${r.overall}.`);
  if (r.warnings.length) {
    lines.push("Caveats: " + r.warnings.join(" "));
  }
  lines.push(RECOMMENDATION[r.overall]);
  lines.push(
    `Thresholds applied: response time +${r.config.thresholds.responseTime.relPct}%, ` +
    `CPU +${r.config.thresholds.cpu.relPct}%, memory +${r.config.thresholds.memory.relPct}%, ` +
    `GC warning ${r.config.gcWarnPct}% / failure ${r.config.gcFailPct}%. ` +
    `Evidence source: Dynatrace Grail (NeoLoad business events and platform metrics); report id ${r.id}.`
  );
  return lines.join("\n");
}
