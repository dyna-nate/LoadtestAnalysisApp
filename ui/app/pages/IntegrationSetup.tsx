import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text, Strong } from "@dynatrace/strato-components/typography";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";
import { useSelectedTest } from "../context/SelectedTestContext";

// ── Tool definitions ──────────────────────────────────────────────────────────

type Tool = "neoload" | "jmeter" | "loadrunner";

interface StepDef {
  title: string;
  body: React.ReactNode;
}

interface ToolDef {
  id: Tool;
  label: string;
  steps: StepDef[];
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const CODE_STYLE: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "0.82em",
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "6px",
  padding: "10px 14px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  color: "#c8d0e0",
  display: "block",
  margin: "8px 0 0",
};

const NOTE_STYLE: React.CSSProperties = {
  background: "rgba(97,175,255,0.08)",
  border: "1px solid rgba(97,175,255,0.25)",
  borderRadius: "6px",
  padding: "10px 14px",
  marginTop: "10px",
  fontSize: "0.88em",
  color: "#a8c8f0",
};

// ── Detection section ─────────────────────────────────────────────────────────

interface DetectionResult {
  si: string | null;
  extraction: string | null;
  span_count: number;
}

const DETECTION_DQL = `fetch spans, from: -2h, scanLimitGBytes: 5
| filter isNotNull(\`http.request.header.x-dynatrace-test\`)
      or isNotNull(request_attribute.LoadTest_TestExecution)
      or isNotNull(\`loadtest.LTN\`)
| fieldsAdd
    si = coalesce(\`loadtest.SI\`, request_attribute.LoadTest_SourceID),
    extraction = if(isNotNull(\`loadtest.LTN\`), "OpenPipeline",
                 else: if(isNotNull(request_attribute.LoadTest_TestExecution), "Request Attributes",
                 else: "Raw header (not yet extracted)"))
| summarize span_count = count(), by: { si, extraction }
| sort span_count desc
| limit 10`;

function SignalDetection() {
  const [status, setStatus] = useState<"idle" | "loading" | "found" | "none" | "error">("idle");
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const runDetection = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await queryExecutionClient.queryExecute({
        body: { query: DETECTION_DQL, requestTimeoutMilliseconds: 30000 },
      });
      const records = (res.result?.records ?? []) as unknown as DetectionResult[];
      setResults(records);
      setStatus(records.length > 0 ? "found" : "none");
      setCheckedAt(new Date());
    } catch {
      setStatus("error");
      setCheckedAt(new Date());
    }
  }, []);

  useEffect(() => { runDetection(); }, [runDetection]);

  const cardBase: React.CSSProperties = {
    borderRadius: "8px",
    padding: "18px 22px",
  };

  if (status === "idle" || status === "loading") {
    return (
      <div style={{ ...cardBase, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)" }}>
        <Flex gap={8} alignItems="center">
          <div style={{
            width: "10px", height: "10px", borderRadius: "50%",
            background: "#8e9099",
            boxShadow: "0 0 0 0 rgba(142,144,153,0.4)",
            animation: "pulse 1.5s infinite",
          }} />
          <Text color="var(--dt-color-text-subdued, #8e9099)">
            Checking for load test signals in the last 2 hours…
          </Text>
        </Flex>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={{ ...cardBase, background: "rgba(245,100,50,0.06)", border: "1px solid rgba(245,100,50,0.25)" }}>
        <Flex justifyContent="space-between" alignItems="center">
          <Text style={{ color: "#f06050" }}>Could not run detection query. Check your permissions.</Text>
          <button onClick={runDetection} style={btnStyle}>Retry</button>
        </Flex>
      </div>
    );
  }

  if (status === "none") {
    return (
      <div style={{ ...cardBase, background: "rgba(245,166,35,0.06)", border: "1px solid rgba(245,166,35,0.25)" }}>
        <Flex justifyContent="space-between" alignItems="flex-start">
          <Flex flexDirection="column" gap={8}>
            <Flex gap={8} alignItems="center">
              <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f5a623", flexShrink: 0 }} />
              <Strong style={{ color: "#f5c842" }}>No load test signals detected in the last 2 hours</Strong>
            </Flex>
            <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)" style={{ paddingLeft: "20px" }}>
              Dynatrace has not seen any spans carrying an <code>X-Dynatrace-Test</code> header or{" "}
              <code>LoadTest_TestExecution</code> request attribute recently. Follow the setup steps
              below to configure your load testing tool.
            </Text>
          </Flex>
          <Flex flexDirection="column" alignItems="flex-end" gap={4}>
            <button onClick={runDetection} style={btnStyle}>Refresh</button>
            {checkedAt && <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">Checked {checkedAt.toLocaleTimeString()}</Text>}
          </Flex>
        </Flex>
      </div>
    );
  }

  // status === "found"
  const totalSpans = results.reduce((s, r) => s + (r.span_count ?? 0), 0);
  return (
    <div style={{ ...cardBase, background: "rgba(80,220,120,0.06)", border: "1px solid rgba(80,220,120,0.3)" }}>
      <Flex justifyContent="space-between" alignItems="flex-start">
        <Flex flexDirection="column" gap={12}>
          <Flex gap={8} alignItems="center">
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#50dc78", flexShrink: 0, boxShadow: "0 0 6px rgba(80,220,120,0.6)" }} />
            <Strong style={{ color: "#80dc98" }}>
              Load test signals detected — {totalSpans.toLocaleString()} spans in the last 2 hours
            </Strong>
          </Flex>
          <div style={{ paddingLeft: "20px" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.85em", width: "100%" }}>
              <thead>
                <tr>
                  {["Tool (SI)", "Extraction Method", "Span Count"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "4px 16px 4px 0", color: "#8e9099", fontWeight: 600, fontSize: "0.85em", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td style={{ padding: "5px 16px 5px 0", color: "#c8ccd4" }}>{r.si ?? <em style={{ color: "#8e9099" }}>unknown</em>}</td>
                    <td style={{ padding: "5px 16px 5px 0" }}>
                      <span style={{
                        padding: "2px 8px",
                        borderRadius: "10px",
                        fontSize: "0.9em",
                        background: r.extraction === "OpenPipeline" ? "rgba(97,175,255,0.15)" : r.extraction === "Request Attributes" ? "rgba(80,220,120,0.12)" : "rgba(245,166,35,0.12)",
                        color: r.extraction === "OpenPipeline" ? "#61afff" : r.extraction === "Request Attributes" ? "#80dc78" : "#f5c842",
                        border: `1px solid ${r.extraction === "OpenPipeline" ? "rgba(97,175,255,0.3)" : r.extraction === "Request Attributes" ? "rgba(80,220,120,0.3)" : "rgba(245,166,35,0.3)"}`,
                      }}>
                        {r.extraction ?? "unknown"}
                      </span>
                    </td>
                    <td style={{ padding: "5px 0", color: "#c8ccd4", fontFamily: "monospace" }}>{(r.span_count ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {results.some(r => r.extraction === "Raw header (not yet extracted)") && (
              <div style={{ marginTop: "10px", ...NOTE_STYLE }}>
                Raw headers detected but not yet extracted. Complete Step 2 (Request Attributes) or
                configure an OpenPipeline DQL Processor to parse the fields into named attributes.
              </div>
            )}
            {results.some(r => r.extraction === "Request Attributes") && (
              <Text textStyle="small" style={{ marginTop: "8px", color: "#80dc98" }}>
                Integration working. Run a load test and select it in the header to begin analysis.
              </Text>
            )}
            {results.some(r => r.extraction === "OpenPipeline") && (
              <Text textStyle="small" style={{ marginTop: "8px", color: "#61afff" }}>
                Using OpenPipeline extraction (optimal). Run a load test and select it in the header.
              </Text>
            )}
          </div>
        </Flex>
        <Flex flexDirection="column" alignItems="flex-end" gap={4}>
          <button onClick={runDetection} style={btnStyle}>Refresh</button>
          {checkedAt && <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">Checked {checkedAt.toLocaleTimeString()}</Text>}
        </Flex>
      </Flex>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderRadius: "4px",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  color: "#c8ccd4",
  cursor: "pointer",
  fontSize: "0.82em",
  whiteSpace: "nowrap",
};

// ── Tool step content ─────────────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    id: "neoload",
    label: "NeoLoad",
    steps: [
      {
        title: "Enable the X-Dynatrace-Test header in NeoLoad",
        body: (
          <>
            <Text>
              NeoLoad automatically emits the <Strong>X-Dynatrace-Test</Strong> header when{" "}
              <Strong>Dynatrace AppMon integration</Strong> is enabled in your NeoLoad project settings.
            </Text>
            <Text style={{ marginTop: "8px" }}>
              Go to <Strong>Project &gt; Settings &gt; Dynatrace</Strong> and enable the Dynatrace
              integration. NeoLoad will inject the following fields into each request:
            </Text>
            <code style={CODE_STYLE}>{`X-Dynatrace-Test: SI=NeoLoad;NA=<transaction>;VU=<vu>;GR=<zone>;SN=<script>;TE=<project>-<scenario>-<uuid>`}</code>
            <div style={NOTE_STYLE}>
              The <Strong>TE</Strong> field contains a UUID suffix (last 36 characters) that uniquely
              identifies each test run. This becomes the <code>te_uuid</code> used throughout the app.
            </div>
          </>
        ),
      },
      {
        title: "Create Dynatrace Request Attributes",
        body: (
          <>
            <Text>
              In Dynatrace, go to <Strong>Settings &gt; Server-side service monitoring &gt; Request
              Attributes</Strong> and create the following attributes. Each one captures a field from the
              X-Dynatrace-Test header.
            </Text>
            {[
              ["LoadTest_SourceID", "SI", "The load tool name (NeoLoad)"],
              ["LoadTest_TestExecution", "TE", "Full test execution string including UUID"],
              ["LoadTest_Zone", "GR", "Load generator zone"],
              ["LoadTest_TransactionName", "NA", "Virtual user action / transaction name"],
              ["LoadTest_ScriptName", "SN", "Script/scenario name"],
              ["LoadTest_PageContext", "PC", "Page context (optional)"],
            ].map(([attr, field, desc]) => (
              <Flex key={attr} flexDirection="column" gap={2} style={{ marginTop: "12px" }}>
                <Text><Strong>{attr}</Strong> — {desc}</Text>
                <code style={CODE_STYLE}>{`Data source: HTTP request header\nHeader name: X-Dynatrace-Test\nCapture: Value after key=\nKey: ${field}`}</code>
              </Flex>
            ))}
          </>
        ),
      },
      {
        title: "Deploy the Load Test Analysis Workflow",
        body: (
          <>
            <Text>
              Import <Strong>misc/dt-loadtest-analysis-workflow.json</Strong> into your Dynatrace
              environment via <Strong>Automations &gt; Workflows &gt; Import</Strong>.
            </Text>
            <Text style={{ marginTop: "8px" }}>
              The workflow runs every 3 hours, finds tests whose last span is more than 10 minutes old (finished tests only) that are not yet recorded, queries each test over its own exact time window, and ingests:
            </Text>
            <ul style={{ paddingLeft: "20px", marginTop: "8px", color: "#c8ccd4" }}>
              <li>Per-step performance metrics (count, avg, p25–p99) as <code>loadtest.responsetime.detailed</code> business events</li>
              <li>Service associations as <code>loadtest.services.detailed</code> business events</li>
              <li>Test run summary (one <code>loadtest.summary</code> business event per finished test) for test discovery</li>
            </ul>
          </>
        ),
      },
      {
        title: "Verify with DQL",
        body: (
          <>
            <Text>After running a load test, verify business events are being generated:</Text>
            <code style={CODE_STYLE}>{`fetch bizevents, from: -24h
| filter event.type == "loadtest.responsetime.detailed"
| limit 5`}</code>
            <div style={{ ...NOTE_STYLE, marginTop: "12px" }}>
              Historical data under <code>neoload.responsetime.detailed</code> remains visible — the
              dual-query ensures backward compatibility.
            </div>
          </>
        ),
      },
    ],
  },
  {
    id: "jmeter",
    label: "JMeter",
    steps: [
      {
        title: "Add the X-Dynatrace-Test header to HTTP requests",
        body: (
          <>
            <Text>
              In JMeter, add a <Strong>HTTP Header Manager</Strong> to your Thread Group. Configure it to send:
            </Text>
            <code style={CODE_STYLE}>{`Header Name:  X-Dynatrace-Test
Header Value: SI=JMeter;LTN=\${__P(testName,MyTest)};LSN=\${__threadGroupName};VU=\${__threadNum}`}</code>
            <div style={NOTE_STYLE}>
              <Strong>Important:</Strong> JMeter does not generate a guaranteed unique run ID.
              Set <code>LTN</code> to a value unique per execution (e.g., build number or timestamp).
              The workflow generates <code>te_uuid</code> from a hash of SI + LTN + time window.
            </div>
          </>
        ),
      },
      {
        title: "Create Dynatrace Request Attributes",
        body: (
          <>
            <Text>Create these Request Attributes in <Strong>Settings &gt; Server-side service monitoring &gt; Request Attributes</Strong>:</Text>
            {[
              ["LoadTest_SourceID", "SI", "The load tool name (JMeter)"],
              ["LoadTest_TestExecution", "LTN", "Load Test Name — must be unique per run"],
              ["LoadTest_ScriptName", "LSN", "Load Script Name / thread group"],
              ["LoadTest_TransactionName", "TSN", "Test Step Name (transaction label)"],
            ].map(([attr, field, desc]) => (
              <Flex key={attr} flexDirection="column" gap={2} style={{ marginTop: "12px" }}>
                <Text><Strong>{attr}</Strong> — {desc}</Text>
                <code style={CODE_STYLE}>{`Data source: HTTP request header\nHeader name: X-Dynatrace-Test\nCapture: Value after key=\nKey: ${field}`}</code>
              </Flex>
            ))}
          </>
        ),
      },
      {
        title: "Deploy the Load Test Analysis Workflow",
        body: (
          <Text>
            Import <Strong>misc/dt-loadtest-analysis-workflow.json</Strong>. The workflow queries
            spans containing <code>request_attribute.LoadTest_TestExecution</code>, which maps to
            the JMeter <code>LTN</code> field.
          </Text>
        ),
      },
      {
        title: "Verify with DQL",
        body: (
          <>
            <Text>Confirm spans are being captured after a test run:</Text>
            <code style={CODE_STYLE}>{`fetch spans, from: -2h
| filter isNotNull(request_attribute.LoadTest_TestExecution)
| filter request_attribute.LoadTest_SourceID == "JMeter"
| limit 10`}</code>
          </>
        ),
      },
    ],
  },
  {
    id: "loadrunner",
    label: "LoadRunner",
    steps: [
      {
        title: "Inject the X-Dynatrace-Test header in your script",
        body: (
          <>
            <Text>
              In LoadRunner scripts, add a custom header using <code>web_add_header</code> before each action block:
            </Text>
            <code style={CODE_STYLE}>{`web_add_header("X-Dynatrace-Test",
  "SI=LoadRunner;"
  "LTN={pTestName};"
  "LSN={pScriptName};"
  "TSN={pTransactionName};"
  "VU={pVUCount}");`}</code>
            <div style={NOTE_STYLE}>
              <Strong>Important:</Strong> Set a unique <code>LTN</code> per run — use a build ID or
              timestamp parameter. The workflow derives <code>te_uuid</code> from SI + LTN + time window.
            </div>
          </>
        ),
      },
      {
        title: "Create Dynatrace Request Attributes",
        body: (
          <>
            <Text>Create these Request Attributes in <Strong>Settings &gt; Server-side service monitoring &gt; Request Attributes</Strong>:</Text>
            {[
              ["LoadTest_SourceID", "SI", "The load tool name (LoadRunner)"],
              ["LoadTest_TestExecution", "LTN", "Load Test Name — must be unique per run"],
              ["LoadTest_ScriptName", "LSN", "Script name"],
              ["LoadTest_TransactionName", "TSN", "Transaction name"],
            ].map(([attr, field, desc]) => (
              <Flex key={attr} flexDirection="column" gap={2} style={{ marginTop: "12px" }}>
                <Text><Strong>{attr}</Strong> — {desc}</Text>
                <code style={CODE_STYLE}>{`Data source: HTTP request header\nHeader name: X-Dynatrace-Test\nCapture: Value after key=\nKey: ${field}`}</code>
              </Flex>
            ))}
          </>
        ),
      },
      {
        title: "Deploy the Load Test Analysis Workflow",
        body: (
          <Text>
            Import <Strong>misc/dt-loadtest-analysis-workflow.json</Strong>. The workflow
            handles spans from any tool that populates <code>LoadTest_TestExecution</code>.
          </Text>
        ),
      },
      {
        title: "Verify with DQL",
        body: (
          <>
            <Text>Confirm spans are being captured after a test run:</Text>
            <code style={CODE_STYLE}>{`fetch spans, from: -2h
| filter isNotNull(request_attribute.LoadTest_TestExecution)
| filter request_attribute.LoadTest_SourceID == "LoadRunner"
| limit 10`}</code>
          </>
        ),
      },
    ],
  },
];

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({ index, step }: { index: number; step: StepDef }) {
  return (
    <Flex
      flexDirection="column"
      gap={8}
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: "8px",
        padding: "18px 22px",
      }}
    >
      <Flex gap={12} alignItems="center">
        <div
          style={{
            minWidth: "28px",
            height: "28px",
            borderRadius: "50%",
            background: "rgba(97,175,255,0.18)",
            border: "1px solid rgba(97,175,255,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.82em",
            fontWeight: 700,
            color: "#61afff",
          }}
        >
          {index + 1}
        </div>
        <Strong>{step.title}</Strong>
      </Flex>
      <div style={{ paddingLeft: "40px" }}>{step.body}</div>
    </Flex>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export const IntegrationSetup = () => {
  const navigate = useNavigate();
  const { primaryTest } = useSelectedTest();
  const [selectedTool, setSelectedTool] = useState<Tool>("neoload");
  const tool = TOOLS.find((t) => t.id === selectedTool)!;

  // Disappear as soon as the user selects a test run
  useEffect(() => {
    if (primaryTest) {
      navigate("/");
    }
  }, [primaryTest, navigate]);

  return (
    <Flex flexDirection="column" gap={24} style={{ padding: "32px 40px", maxWidth: "860px" }}>
      <Flex flexDirection="column" gap={6}>
        <Heading level={1}>Integration Setup</Heading>
        <Text color="var(--dt-color-text-subdued, #8e9099)">
          Configure your load testing tool to send test context to Dynatrace so the Load Test
          Analysis app can correlate performance data with your test runs.
        </Text>
      </Flex>

      {/* ── Live signal detection ── */}
      <Flex flexDirection="column" gap={8}>
        <Strong>Live Signal Detection</Strong>
        <SignalDetection />
      </Flex>

      {/* ── Tool selector ── */}
      <Flex flexDirection="column" gap={12}>
        <Text><Strong>Select your load testing tool:</Strong></Text>
        <Flex gap={8} flexWrap="wrap">
          {TOOLS.map((t) => (
            <div
              key={t.id}
              onClick={() => setSelectedTool(t.id)}
              style={{
                padding: "6px 16px",
                borderRadius: "20px",
                cursor: "pointer",
                fontSize: "0.9em",
                fontWeight: 500,
                background: selectedTool === t.id ? "rgba(97,175,255,0.18)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${selectedTool === t.id ? "rgba(97,175,255,0.5)" : "rgba(255,255,255,0.12)"}`,
                color: selectedTool === t.id ? "#61afff" : "#c8ccd4",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </div>
          ))}
        </Flex>
      </Flex>

      {/* ── Setup steps ── */}
      <Flex flexDirection="column" gap={12}>
        <Heading level={2}>{tool.label} Setup</Heading>
        {tool.steps.map((step, i) => (
          <StepCard key={i} index={i} step={step} />
        ))}
      </Flex>

      {/* ── How it works ── */}
      <Flex
        flexDirection="column"
        gap={8}
        style={{
          background: "rgba(80,220,120,0.06)",
          border: "1px solid rgba(80,220,120,0.2)",
          borderRadius: "8px",
          padding: "16px 20px",
        }}
      >
        <Strong style={{ color: "#80dc78" }}>How it works</Strong>
        <Text textStyle="small">
          Each HTTP request from your load tool carries an <code>X-Dynatrace-Test</code> header.
          Dynatrace OneAgent extracts fields from this header as Request Attributes on every span.
          The Load Test Analysis Workflow (running every 45 min) queries those spans, computes
          per-transaction percentiles, and stores the results as{" "}
          <code>loadtest.responsetime.detailed</code> business events — which the app then reads
          for analysis and comparison.
        </Text>
      </Flex>
    </Flex>
  );
};
