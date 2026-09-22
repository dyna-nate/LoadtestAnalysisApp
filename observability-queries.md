# Golden Signal DQL Queries — Dynatrace MCP

Paste this file into your workspace as `observability-queries.md`.
In Claude Code, reference it with: `Run all the DQL queries in observability-queries.md using the Dynatrace MCP and show me the results.`

Or paste individual sections into Claude Code chat prefixed with:
`@dynatrace Execute this DQL query: <query>`

---

## 🌐 Universal — Cross-Technology Golden Signals

### [Latency] Service Request Response Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Service Request Count — dt.service.request.count

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Errors] Service Failure Count — dt.service.request.failure_count

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service }
```

### [Errors] Service Error Rate %

```dql
timeseries {
  requests = sum(dt.service.request.count),
  errors   = sum(dt.service.request.failure_count)
},
by: { dt.entity.service }
| fieldsAdd error_rate_pct = errors[] / requests[] * 100
```

### [Saturation] Process CPU Usage — dt.process.cpu.usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Process Memory Usage — dt.process.memory.usage

```dql
timeseries mem = avg(dt.process.memory.usage),
  by: { dt.entity.process_group_instance }
```

### [Traffic] Active Network Sessions — dt.process.network.sessions.new

```dql
// Note: dt.process.network.* metrics dimension on dt.entity.host, not process_group_instance
timeseries sessions = sum(dt.process.network.sessions.new),
  by: { dt.entity.host }
```

## ⚡ ASP_DOT_NET_CORE — Golden Signals

### [Latency] HTTP Request Duration — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Errors] HTTP Error Count by Status Code

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service, http.response.status_code }
```

### [Saturation] CLR Heap Consumption by Generation (Gen0/1/2/LOH)

```dql
timeseries heap = avg(dt.runtime.clr.memory.consumption),
  by: { dt.entity.process_group_instance, clr.gc.generation }
```

### [Saturation] GC Collection Count by Generation

```dql
timeseries gc = sum(dt.runtime.clr.gc.collection_count),
  by: { dt.entity.process_group_instance, clr.gc.generation }
```

### [Saturation] GC Suspension / Pause Time

```dql
timeseries gc_pause = avg(dt.runtime.clr.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Time Percentage

```dql
timeseries gc_pct = avg(dt.runtime.clr.gc.time_percentage),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Thread Pool — Queued Work Items

```dql
timeseries queued = avg(dt.runtime.clr.threadpool.queued_work_items),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Thread Pool — Worker & IO Completion Threads

```dql
timeseries threads = avg(dt.runtime.clr.threadpool.threads),
  by: { dt.entity.process_group_instance, clr.threadpool.thread_type }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🟦 DOTNET (.NET Framework) — Golden Signals

### [Latency] Request Execution Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Errors] CLR Exceptions / Failed Requests

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service }
```

### [Saturation] CLR Heap by Generation (Gen0/1/2/LOH)

```dql
timeseries heap = avg(dt.runtime.clr.memory.consumption),
  by: { dt.entity.process_group_instance, clr.gc.generation }
```

### [Saturation] GC Collections/sec by Generation

```dql
timeseries gc = sum(dt.runtime.clr.gc.collection_count),
  by: { dt.entity.process_group_instance, clr.gc.generation }
```

### [Saturation] GC Pause / Suspension Time

```dql
timeseries pause = avg(dt.runtime.clr.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Time %

```dql
timeseries gc_pct = avg(dt.runtime.clr.gc.time_percentage),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Thread Pool — Worker & IO Completion Threads

```dql
timeseries threads = avg(dt.runtime.clr.threadpool.threads),
  by: { dt.entity.process_group_instance, clr.threadpool.thread_type }
```

### [Saturation] Thread Pool — Queued Work Items

```dql
timeseries queued = avg(dt.runtime.clr.threadpool.queued_work_items),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Active Managed Threads

```dql
timeseries threads = avg(dt.profiling.clr.threads.count),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🟩 NODE_JS — Golden Signals

### [Latency] HTTP Response Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Latency/Saturation] Event Loop Utilization (proxy for lag)

```dql
timeseries elu = avg(dt.runtime.nodejs.eventloop.utilization),
  by: { dt.entity.process_group_instance }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Traffic] Active Handles (connections)

```dql
timeseries handles = avg(dt.runtime.nodejs.eventloop.active_handles),
  by: { dt.entity.process_group_instance }
```

### [Errors] HTTP Error Rate

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service }
```

### [Saturation] V8 Heap Used

```dql
timeseries heap_used = avg(dt.runtime.nodejs.memory.used),
  by: { dt.entity.process_group_instance }
```

### [Saturation] V8 Heap Total

```dql
timeseries heap_total = avg(dt.runtime.nodejs.memory.total),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Collection Time

```dql
timeseries gc = avg(dt.runtime.nodejs.gc.collection_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Suspension Time

```dql
timeseries gc_pause = avg(dt.runtime.nodejs.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Active Threads

```dql
timeseries threads = avg(dt.process.nodejs.avg_number_of_active_threads),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🟫 WEB_SPHERE — Golden Signals

### [Latency] Servlet Response Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Servlet Request Count

```dql
timeseries requests = sum(dt.runtime.websphere.servlet.requests),
  by: { dt.entity.process_group_instance }
```

### [Traffic] Live HTTP Sessions

```dql
timeseries sessions = avg(dt.runtime.websphere.servlet.live_sessions),
  by: { dt.entity.process_group_instance }
```

### [Errors] Failed Requests

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service }
```

### [Saturation] JVM Heap — Used / Committed / Max

```dql
timeseries {
  used      = avg(dt.runtime.jvm.memory_pool.used),
  committed = avg(dt.runtime.jvm.memory_pool.committed),
  max       = avg(dt.runtime.jvm.memory_pool.max)
},
by: { dt.entity.process_group_instance }
```

### [Saturation] Thread Pool — Active Threads

```dql
timeseries active = avg(dt.runtime.websphere.threadpool.active_threads),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Thread Pool — Pool Size

```dql
timeseries pool_size = avg(dt.runtime.websphere.threadpool.pool_size),
  by: { dt.entity.process_group_instance }
```

### [Saturation] JDBC Connection Pool — Concurrent Waiters

```dql
timeseries waiters = avg(dt.runtime.websphere.connectionpool.concurrent_waiters),
  by: { dt.entity.process_group_instance }
```

### [Saturation] JDBC Connection Pool — Free Pool Size

```dql
timeseries free = avg(dt.runtime.websphere.connectionpool.free_pool_size),
  by: { dt.entity.process_group_instance }
```

### [Saturation] JDBC Connection Pool — % Used

```dql
timeseries pct_used = avg(dt.runtime.websphere.connectionpool.percent_used),
  by: { dt.entity.process_group_instance }
```

### [Saturation] JDBC Connection Pool — Wait Time

```dql
timeseries wait = avg(dt.runtime.websphere.connectionpool.wait_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Total Collection Time

```dql
timeseries gc = avg(dt.runtime.jvm.gc.total_collection_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Suspension Time

```dql
timeseries pause = avg(dt.runtime.jvm.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🔴 JBOSS — Golden Signals

### [Latency] HTTP/EJB Response Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Request Count

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Errors] Transaction Failures / Failed Requests

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service }
```

### [Saturation] JVM Heap — Used / Committed / Max

```dql
timeseries {
  used      = avg(dt.runtime.jvm.memory_pool.used),
  committed = avg(dt.runtime.jvm.memory_pool.committed),
  max       = avg(dt.runtime.jvm.memory_pool.max)
},
by: { dt.entity.process_group_instance }
```

### [Saturation] JVM Runtime Heap — Free / Total / Max

```dql
timeseries {
  free  = avg(dt.runtime.jvm.memory.free),
  total = avg(dt.runtime.jvm.memory.total),
  max   = avg(dt.runtime.jvm.memory.max)
},
by: { dt.entity.process_group_instance }
```

### [Saturation] JVM Thread Count

```dql
timeseries threads = avg(dt.runtime.jvm.threads.count),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Total Collection Time

```dql
timeseries gc = avg(dt.runtime.jvm.gc.total_collection_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Suspension / Pause Time

```dql
timeseries pause = avg(dt.runtime.jvm.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Activation Count

```dql
timeseries gc_count = sum(dt.runtime.jvm.gc.total_activation_count),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🌿 SPRINGBOOT — Golden Signals

### [Latency] HTTP Request Latency — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Errors] HTTP Error Rate %

```dql
timeseries {
  requests = sum(dt.service.request.count),
  errors   = sum(dt.service.request.failure_count)
},
by: { dt.entity.service }
| fieldsAdd error_rate_pct = errors[] / requests[] * 100
```

### [Saturation] JVM Heap — Used / Committed / Max (by pool)

```dql
timeseries {
  used      = avg(dt.runtime.jvm.memory_pool.used),
  committed = avg(dt.runtime.jvm.memory_pool.committed),
  max       = avg(dt.runtime.jvm.memory_pool.max)
},
by: { dt.entity.process_group_instance }
```

### [Saturation] GC Total Collection Time

```dql
timeseries gc = avg(dt.runtime.jvm.gc.total_collection_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Suspension / Pause Time

```dql
timeseries pause = avg(dt.runtime.jvm.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Collection Count

```dql
timeseries gc_count = sum(dt.runtime.jvm.gc.collection_count),
  by: { dt.entity.process_group_instance }
```

### [Saturation] JVM Live Thread Count

```dql
timeseries threads = avg(dt.runtime.jvm.threads.count),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🪟 IIS_APP_POOL — Golden Signals

### [Latency] Request Execution Time / Time-to-First-Byte — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.runtime.iis.requests),
  by: { dt.entity.process_group_instance }
```

### [Traffic] Bytes Sent/Received

```dql
timeseries traffic = sum(dt.runtime.iis.traffic),
  by: { dt.entity.process_group_instance }
```

### [Errors] Failed Requests / HTTP 5xx by Status Code

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service, http.response.status_code }
```

### [Saturation] Request Queue — Socket Waiting Time

```dql
timeseries queue = avg(dt.runtime.iis.connections.socket_waiting_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Threads — Active

```dql
timeseries active = avg(dt.runtime.iis.threads.active),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Threads — Idle

```dql
timeseries idle = avg(dt.runtime.iis.threads.idle),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Threads — Max

```dql
timeseries max_threads = avg(dt.runtime.iis.threads.max),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Process CPU

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Process Memory

```dql
timeseries mem = avg(dt.process.memory.usage),
  by: { dt.entity.process_group_instance }
```

## 🌐 APACHE — Golden Signals

### [Latency] Request Processing Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.runtime.apache.requests),
  by: { dt.entity.process_group_instance }
```

### [Traffic] Bytes Transferred/sec

```dql
timeseries traffic = sum(dt.runtime.apache.traffic),
  by: { dt.entity.process_group_instance }
```

### [Errors] HTTP 4xx / 5xx Rate

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service, http.response.status_code }
```

### [Saturation] Worker Scoreboard — Active (Busy) Threads

```dql
timeseries active = avg(dt.runtime.apache.threads.active),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Scoreboard — Idle Threads

```dql
timeseries idle = avg(dt.runtime.apache.threads.idle),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Worker Scoreboard — Max Threads

```dql
timeseries max_threads = avg(dt.runtime.apache.threads.max),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Async Connection Queue — Socket Waiting Time

```dql
timeseries queue = avg(dt.runtime.apache.connections.socket_waiting_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Load

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 🐱 TOMCAT — Golden Signals

### [Latency] HTTP Connector Request Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Request Count/sec

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Traffic] Bytes Sent / Received (process I/O)

```dql
timeseries {
  bytes_read    = sum(dt.process.io.bytes_read),
  bytes_written = sum(dt.process.io.bytes_written)
},
by: { dt.entity.process_group_instance }
```

### [Errors] HTTP Error Count / Session Rejection

```dql
timeseries errors = sum(dt.service.request.failure_count),
  by: { dt.entity.service }
```

### [Saturation] JVM Heap — Used / Committed / Max

```dql
timeseries {
  used      = avg(dt.runtime.jvm.memory_pool.used),
  committed = avg(dt.runtime.jvm.memory_pool.committed),
  max       = avg(dt.runtime.jvm.memory_pool.max)
},
by: { dt.entity.process_group_instance }
```

### [Saturation] JVM Thread Count

```dql
timeseries threads = avg(dt.runtime.jvm.threads.count),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Total Collection Time

```dql
timeseries gc = avg(dt.runtime.jvm.gc.total_collection_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] GC Suspension / Pause Time

```dql
timeseries pause = avg(dt.runtime.jvm.gc.suspension_time),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```

## 💎 RUBY — Golden Signals

### [Latency] Rack/Rails Request Response Time — p50/p90/p99

```dql
timeseries {
  avg = avg(dt.service.request.response_time),
  p50 = percentile(dt.service.request.response_time, 50),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
},
by: { dt.entity.service }
```

### [Traffic] Requests/sec

```dql
timeseries requests = sum(dt.service.request.count),
  by: { dt.entity.service }
```

### [Errors] HTTP 5xx / Exception Rate %

```dql
timeseries {
  requests = sum(dt.service.request.count),
  errors   = sum(dt.service.request.failure_count)
},
by: { dt.entity.service }
| fieldsAdd error_rate_pct = errors[] / requests[] * 100
```

### [Saturation] RSS Memory (Working Set)

```dql
timeseries rss = avg(dt.process.memory.working_set_size),
  by: { dt.entity.process_group_instance }
```

### [Saturation] Process Memory Usage

```dql
timeseries mem = avg(dt.process.memory.usage),
  by: { dt.entity.process_group_instance }
```

### [Saturation] CPU Usage

```dql
timeseries cpu = avg(dt.process.cpu.usage),
  by: { dt.entity.process_group_instance }
```
