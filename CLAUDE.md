# LoadtestAnalysisApp — Project Context for Claude Code

> This file provides Claude Code with full background on the LoadtestAnalysisApp project.
> Repo: https://github.com/kunzna/LoadtestAnalysisApp
> Owner: Nate Kunz — Senior Solutions Engineer, Dynatrace

---

## Project Overview

A **Dynatrace App Framework** application that ingests `X-Dynatrace-Test` request headers emitted
by load testing tools, correlates them with Dynatrace telemetry (service response times, error
rates, resource utilization), and produces a **release-over-release load test comparison** for
performance engineers.

The app's core value: instead of comparing raw load tool reports, performance engineers get a
unified analysis view in Dynatrace that correlates load generator context (which scenario, which
virtual user, which test run) with live APM data (traces, logs, infrastructure metrics) captured
during the test.

---

## Platform

- **Dynatrace App Framework** (TypeScript/React, deployed to Dynatrace tenant)
- **DQL (Dynatrace Query Language)** for all Grail data access
- **Grail** as the backend data store — request attributes, bizevents, metrics, logs
- **Dynatrace Gen 3 / Grail context** — do NOT use Gen 2 constructs (Management Zones,
  classic dashboards, etc.). Use Segments, Grail fieldsets, and DQL-native patterns.

---

## The `X-Dynatrace-Test` Header — Full Specification

This is the universal integration contract between load testing tools and Dynatrace.
It is an open Dynatrace-defined spec, not proprietary to any one tool.

### Standard Parameters (all tools)

| Key | Full Name        | Description                                                                 |
|-----|-----------------|-----------------------------------------------------------------------------|
| SI  | Source ID        | Identifies the load testing product (e.g., `NeoLoad`, `JMeter`, `GATLING`) |
| VU  | Virtual User ID  | Unique identifier for the virtual user who sent the request                 |
| TSN | Test Step Name   | Logical test step within the script (e.g., `Login`, `Add to Cart`)          |
| LSN | Load Script Name | Name of the script / transaction group                                      |
| LTN | Load Test Name   | Uniquely identifies a test execution run                                    |
| PC  | Page Context     | Document/page context for the current request                               |

### NeoLoad Extensions (NeoLoad only)

NeoLoad emits the standard set PLUS these additional fields:

| Key | Full Name        | Description                                                                        |
|-----|-----------------|------------------------------------------------------------------------------------|
| SN  | Scenario Name    | The NeoLoad scenario being executed (e.g., `AddGlobalMerchPayee`)                  |
| NA  | Named Action     | Action path (e.g., `Actions.01_Login.`)                                            |
| GR  | Generator/Zone   | Load generator zone (e.g., `Default zone`)                                         |
| ID  | Request ID       | Internal request sequence number                                                   |
| TE  | Test Execution   | **UUID uniquely identifying the test run** — primary correlation key for NeoLoad   |

**Example NeoLoad header value:**
```
SI=NeoLoad;VU=4;SN=AddGlobalMerchPayee;PC=/debugaccess;ID=251;NA=Actions.01_Login.;GR=Default zone;TE=Fusion-PaceBenchmark-7f0d20ec-a8e1-4e86-a16f-5bf22e6cfc72
```

### Header Name Variants — Normalize on Ingest

Different tools use slightly different header names. The app must normalize all of these:

- `X-Dynatrace-Test` (NeoLoad, LoadRunner standard)
- `x-dynatrace-test` (JMeter community convention)
- `x-dynaTrace` (Gatling official docs example — no hyphen before "Test")

---

## Tool-by-Tool Integration Reference

### NeoLoad (Tricentis)
- **Integration type:** Native, built-in
- **Header support:** Full standard set + NeoLoad extensions (`SN`, `NA`, `GR`, `ID`, `TE`)
- **Run correlation key:** `TE` (UUID, e.g., `Fusion-PaceBenchmark-7f0d20ec-...`)
- **SI value:** `NeoLoad`
- **Notes:** Richest header set of any tool. `TE` is the gold standard for test run identification.
  In 2025 NeoLoad added MCP support for natural-language-directed testing workflows.

### Apache JMeter
- **Integration type:** Manual — HTTP Header Manager + Groovy pre-processor script
- **Header support:** Standard set (SI, VU, TSN, LSN, LTN, PC)
- **Run correlation key:** `LTN` (set via JMeter User Defined Variable — requires test author discipline)
- **SI value:** `JMeter` or `JMeter5.x` (includes version)
- **Example value:** `SI=JMeter5.4;LSN=MyScript.jmx;TSN=HTTP Request 1;LTN=MyLoadTest;VU=ThreadGroup-0;`
- **Notes:** Most widely deployed tool. `LTN` quality varies — often left as a timestamp or default.

### Gatling / Gatling Enterprise
- **Integration type:** Native via `.sign()` on `HttpProtocol` — applied globally to all requests
- **Header support:** Standard set (VU, SI, TSN, LSN, LTN, PC)
- **Run correlation key:** `LTN` (typically `ClassName_ISO-timestamp`)
- **SI value:** `GATLING`
- **Header name used:** `x-dynaTrace` (note: no hyphen before "Test" — differs from other tools)
- **Notes:** Gatling Enterprise Edition also pushes metrics directly to Dynatrace via API
  (`metrics.ingest` + `events.ingest` scopes), emitting `CUSTOM_INFO` events for test
  `start` and `end` with `run_id`, `test`, `team`, `phase` dimensions.
- **Gatling Enterprise metric namespace:** `gatling_enterprise.*` (response time, user count,
  request count, group duration, DNS/TCP/TLS timing, bandwidth)

### OpenText LoadRunner
- **Integration type:** Native — LoadRunner Request Tagging plugin
- **Header support:** Standard set (TSN, LSN, LTN, VU, PC, SI)
- **Run correlation key:** `LTN` (set via `DynatraceLTN` runtime attribute in LoadRunner)
- **SI value:** `LoadRunner` (fixed)
- **Notes:** `TSN` concatenates nested transaction names. Most enterprise-compliant integration.

### Grafana k6
- **Integration type:** Manual — custom headers in script; no native X-Dynatrace-Test support
- **Header support:** Whatever the test author adds (often only SI, VU, TSN)
- **Run correlation key:** `LTN` (manually set)
- **SI value:** `k6` (by convention — not standardized)
- **Metric output:** `xk6-output-dynatrace` extension pushes k6 stats to Dynatrace metrics API
  (requires API token with `metrics.ingest` scope). Separate from request tagging.
- **Notes:** Header quality is highly variable. Treat k6 headers as best-effort.

### Locust / Artillery
- **Integration type:** Manual script injection — no native support
- **Header support:** Minimal, team-defined
- **Notes:** No standard convention for field mapping. Parse defensively.

---

## Run Correlation Strategy

The app uses a **unified Test Execution ID** concept that resolves from whichever field is present:

```
TestExecutionID = TE  (if NeoLoad)
               = LTN (if JMeter / Gatling / LoadRunner)
               = custom (if k6 / Locust — may need fallback to timestamp)
```

Use `SI` as the discriminator to know which resolution path to apply.

---

## Key Metrics for Release Comparison

These are the metrics performance engineers use to assess a release load test vs. previous runs.
The app should surface all of these in its comparison view.

### 1. Latency / Response Time Percentiles (most critical)
- P50, P90, P95, P99, P99.9, Max
- Evaluated per TSN (test step) and per service
- Regression threshold: configurable per-metric (e.g., >10% regression in P99 = flag)
- **Never use averages alone** — outliers matter

### 2. Throughput
- Requests per second (RPS) / Transactions per second (TPS)
- Concurrent virtual users supported at target latency thresholds

### 3. Error Rate
- HTTP 4xx / 5xx by endpoint
- Timeout counts (connection, read, upstream)
- Application-level error events

### 4. Resource Utilization (Saturation)
- CPU % (per pod/host and cluster level)
- Memory / heap utilization
- JVM GC pause time and frequency (critical for Java workloads)
- Thread pool saturation / queue depth
- DB connection pool utilization
- Disk I/O / network I/O

### 5. Infrastructure Scaling Behavior
- Auto-scaling events and pod count changes during ramp-up
- Time-to-scale
- Resources consumed per unit of throughput (efficiency ratio)

### 6. Downstream Service Performance
- DB query execution time (P95/P99)
- Slow query counts
- Cache hit/miss rates
- External API call latency and error rates

### 7. Apdex Score
- Dynatrace-native composite satisfaction score
- Useful as a single-number release health indicator

### 8. SLO Burn Rate During Test
- Error budget consumption during the test window
- Powerful release gate metric

### 9. Davis Anomaly/Problem Count
- Number of Davis problems fired during the test, by severity
- Comparing problem counts across releases is a clean qualitative signal

### 10. Regression Score (Derived)
- Calculated composite across all metrics
- Produces a single **Pass / Warn / Fail** verdict per release
- Core app differentiator

---

## DQL Patterns and Notes

- Header data may surface in Grail under three different field prefixes depending on customer
  configuration — see "Header Extraction Configuration" section for the full breakdown:
  - `request_attribute.<KEY>` — Classic Request Attributes (most common today)
  - `loadtest.<KEY>` — OpenPipeline DQL Processor (Gen 3 recommended)
  - `http.request.header.x-dynatrace-test` — raw, unparsed (fallback; parse inline)
- Always use `coalesce()` across all three sources — never assume a single extraction path
- Use `fetch dt.entity.service` + DQL joins to correlate load test dimensions with
  service topology
- Grail lookup tables are the recommended pattern for storing test run metadata
  (tool, scenario, VU count, duration, environment) keyed by `testId` (TE or LTN)
- For timeseries comparisons across runs, use `timeseries` DQL verb with `by:` on `testId`
- Bizevents are the recommended mechanism for storing test `start`/`end` events
  (especially for Gatling Enterprise which emits `CUSTOM_INFO` events natively with `run_id`)

---

## Header Extraction Configuration — Three Approaches

Customers may be in any of three configuration states. The app must handle all three without
requiring a migration prerequisite. Query defensively and coalesce across all sources.

---

### Approach 1: Classic Request Attributes (Current — Most Common)

**Location:** `Settings > Server-side service monitoring > Request attributes`

This is Gen 2 / Settings 1.0 configuration but still fully functional in Gen 3 tenants.
OneAgent extracts each semicolon-delimited key/value pair from the `X-Dynatrace-Test` header
and surfaces them in Grail as `request_attribute.<name>` fields on spans.

Each key requires a separate Request Attribute rule:
- Source: HTTP request header
- Header name: `X-Dynatrace-Test`
- Extraction: "Extract from string between" — e.g., `LTN=` and `;`

**DQL access:**
```dql
fetch spans
| filter isNotNull(request_attribute.LTN)
| fields endpoint.name, request_attribute.LTN, request_attribute.TSN,
         request_attribute.LSN, request_attribute.VU, request_attribute.SI,
         request_attribute.TE, trace.id
```

**Verdict:** Do NOT migrate away from this if it's working. It surfaces correctly in Grail.
The migration conversation is about the extraction *config mechanism*, not the data itself.

---

### Approach 2: OpenPipeline — Spans Scope (Recommended Gen 3 Path)

**Location:** `Settings > Process and contextualize > OpenPipeline > Spans > Pipelines`

This is the strategic Gen 3 approach. OneAgent automatically captures the raw header as
`http.request.header.x-dynatrace-test` on spans (OTel HTTP semantic conventions).
A DQL Processing processor in OpenPipeline then parses and explodes it into named fields.

**Step 1 — Prototype in a Notebook first:**
```dql
fetch spans
| filter isNotNull(`http.request.header.x-dynatrace-test`)
| fields endpoint.name, `http.request.header.x-dynatrace-test`, trace.id
| limit 20
```

**Step 2 — Configure a DQL Processor in OpenPipeline Spans pipeline:**

Matching condition:
```
isNotNull(`http.request.header.x-dynatrace-test`)
```

DQL script (parse into named fields — all NeoLoad extensions optional):
```dql
| parse `http.request.header.x-dynatrace-test`,
    "(LD 'SI=' LD:loadtest.SI ';')?"
    "(LD 'VU=' LD:loadtest.VU ';')?"
    "(LD 'TSN=' LD:loadtest.TSN ';')?"
    "(LD 'LSN=' LD:loadtest.LSN ';')?"
    "(LD 'LTN=' LD:loadtest.LTN ';')?"
    "(LD 'PC=' LD:loadtest.PC ';')?"
    "(LD 'SN=' LD:loadtest.SN ';')?"
    "(LD 'NA=' LD:loadtest.NA ';')?"
    "(LD 'GR=' LD:loadtest.GR ';')?"
    "(LD 'TE=' LD:loadtest.TE ';')?"
```

After the processor runs, spans carry `loadtest.SI`, `loadtest.LTN`, `loadtest.TSN`, etc.
as first-class Grail fields — queryable in DQL without `request_attribute.*` indirection.

**Step 3 — Optional: Add Metric Extraction stage**

In OpenPipeline's Metric Extraction stage, extract pre-aggregated metrics per test run:
- Metric key: e.g., `loadtest.response_time` 
- Dimensions: `loadtest.LTN`, `loadtest.TSN`, `loadtest.SI`, `dt.entity.service`
- This produces chartable time-series per test run and transaction, ready for the
  comparison view without DQL joins at query time — the performance-optimized path.

**Gatling Enterprise note:** Gatling Enterprise pushes metrics natively under the
`gatling_enterprise.*` metric namespace and emits `CUSTOM_INFO` events for test `start`/`end`
with `run_id`, `test`, `team`, `phase` dimensions. These arrive independently of header parsing.

---

### Approach 3: Settings 2.0 — `builtin:attribute-allow-list`

**Use case:** OTel SDK-instrumented services where the load test tool emits
`x-dynatrace-test` as an OTel span attribute (not as an HTTP request header via OneAgent).

Dynatrace automatically captures all OTel attributes but only persists values for keys
on the allow-list. Add the key via Settings 2.0 API:

```json
POST /api/v2/settings/objects
{
  "schemaId": "builtin:attribute-allow-list",
  "value": {
    "enabled": true,
    "key": "x-dynatrace-test"
  }
}
```

**Important:** This path is for OTel SDK span attributes only — NOT for HTTP request
headers captured by OneAgent. Do not conflate the two. If the header arrives via OneAgent
HTTP interception, use Approach 1 or 2.

**Deprecated schemas to avoid:**
- `builtin:span-attribute` — replaced by `builtin:attribute-allow-list`, being removed soon
- `builtin:resource-attribute` — same, replaced and being removed

---

### Resilient Query Pattern — Handle All Three Customer States

The app should coalesce across all three sources so it works regardless of customer
configuration, without requiring any migration prerequisite:

```dql
fetch spans
| filter isNotNull(`http.request.header.x-dynatrace-test`)
      or isNotNull(request_attribute.LTN)
      or isNotNull(`loadtest.LTN`)
| fieldsAdd ltn    = coalesce(`loadtest.LTN`,    request_attribute.LTN)
| fieldsAdd tsn    = coalesce(`loadtest.TSN`,    request_attribute.TSN)
| fieldsAdd lsn    = coalesce(`loadtest.LSN`,    request_attribute.LSN)
| fieldsAdd si     = coalesce(`loadtest.SI`,     request_attribute.SI)
| fieldsAdd vu     = coalesce(`loadtest.VU`,     request_attribute.VU)
| fieldsAdd te     = coalesce(`loadtest.TE`,     request_attribute.TE)
| fieldsAdd testId = coalesce(te, ltn)           -- unified run correlation key
| filter isNotNull(testId)
| fields endpoint.name, testId, ltn, tsn, lsn, si, vu, te, trace.id
```

When `loadtest.*` fields are absent (Approach 1 customer), the `coalesce()` falls back to
`request_attribute.*`. When both are absent (raw header only), parse inline in DQL using
the `parse` command on `http.request.header.x-dynatrace-test`.

---

### Configuration Decision Matrix

| Scenario | Recommended Approach |
|---|---|
| Customer already has Classic Request Attributes working | Keep — surfaces as `request_attribute.*` in DQL |
| New tenant / greenfield | OpenPipeline Spans DQL Processor (`loadtest.*` fields) |
| Need pre-aggregated metrics per test run for app charts | OpenPipeline Metric Extraction stage |
| OTel SDK emits header as a span attribute | `builtin:attribute-allow-list` |
| IaC / automation of extraction config | Settings 2.0 API (`builtin:openpipeline.system.spans`) |
| App query layer | Coalesce all three sources — tool-agnostic, migration-agnostic |

---

## App Design Considerations

### Header Normalization Layer
Normalize all header name variants. Different tools emit slightly different header names:
- `X-Dynatrace-Test` (NeoLoad, LoadRunner standard)
- `x-dynatrace-test` (JMeter community convention)
- `x-dynaTrace` (Gatling — no hyphen before "Test")

In OpenPipeline, the matching condition should account for all variants. In Classic Request
Attributes, configure the parameter name to match exactly what OneAgent sees on the wire
(typically lowercase after HTTP/2 normalization).

### SI-Based Tool Detection
Use `SI` field to branch parsing logic and UI labeling. Known SI values:
`NeoLoad`, `JMeter`, `JMeter5.x`, `GATLING`, `LoadRunner`, `k6`

### Missing Field Handling
All fields should be treated as optional. UI should degrade gracefully:
- Missing `VU` → hide VU-level analysis, show aggregate only
- Missing `TSN` → group at script level instead
- Missing `TE`/`LTN` → fall back to test timestamp for run identification

### Baseline Selection
Let users select a specific "baseline run" to compare against — don't hardcode "last run."
The comparison should support: current vs. baseline, current vs. N-run average, trend view.

### Test Window Overlay
Overlay test start/end markers on all metric timeseries charts so engineers can see
exactly which portion of the Dynatrace data corresponds to the load test window.

---

## Dynatrace Environment

- **Primary tenant:** `https://playground.apps.dynatrace.com`
- **Sprint tenant:** `https://suz7562h.sprint.apps.dynatracelabs.com`
- **Platform:** Dynatrace Gen 3 / Grail — all queries in DQL, no Classic API patterns

---

## Related Context

- NeoLoad is already deployed in Dynatrace customer environments (FIS, others)
- The `TE` UUID from NeoLoad headers has been used previously as a Grail lookup table
  correlation key in a NeoLoad ↔ Dynatrace Workflow integration
- Performance engineers at accounts like FIS use Dynatrace Workflows and DQL notebooks
  for load test analysis today — this app productizes that workflow
