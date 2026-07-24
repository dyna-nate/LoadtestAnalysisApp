export type SignalType = 'latency' | 'traffic' | 'errors' | 'saturation';

export const SIGNAL_ORDER: SignalType[] = ['latency', 'traffic', 'errors', 'saturation'];

export const SIGNAL_LABELS: Record<SignalType, string> = {
  latency:    'Latency',
  traffic:    'Traffic',
  errors:     'Errors',
  saturation: 'Saturation',
};

export interface TechMetricDef {
  signal: SignalType;
  label: string;
  metricKey: string;
  entityDim: 'dt.entity.service' | 'dt.entity.process_group_instance';
  aggregation: 'avg' | 'sum';
  unit?: string;
  bytesToMiB?: boolean;
  betterIsLower?: boolean; // defaults true; set false for traffic-like counters (threads, workers)
}

// Human-readable labels for each technology type key
export const TECH_TYPE_LABELS: Record<string, string> = {
  NODE_JS:         'Node.js',
  ASP_DOT_NET_CORE:'ASP.NET Core',
  DOTNET:          '.NET',
  SPRINGBOOT:      'Spring Boot',
  TOMCAT:          'Apache Tomcat',
  JBOSS:           'JBoss',
  WEB_SPHERE:      'WebSphere',
  IIS_APP_POOL:    'IIS App Pool',
  APACHE:          'Apache HTTP',
  RUBY:            'Ruby',
};

// Tech-specific additional metrics (beyond the universal set) keyed by tech type.
// Each entry carries a signal tag so the UI can group them correctly.
export const TECH_METRIC_DEFS: Record<string, TechMetricDef[]> = {
  NODE_JS: [
    { signal: 'latency',    label: 'Event Loop Utilization', metricKey: 'dt.runtime.nodejs.eventloop.utilization',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%',   betterIsLower: true  },
    { signal: 'traffic',    label: 'Active Handles',         metricKey: 'dt.runtime.nodejs.eventloop.active_handles',    entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: true  },
    { signal: 'saturation', label: 'V8 Heap Used',           metricKey: 'dt.runtime.nodejs.memory.used',                 entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'GC Time',                metricKey: 'dt.runtime.nodejs.gc.collection_time',          entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
  ],
  ASP_DOT_NET_CORE: [
    { signal: 'saturation', label: 'CLR Heap',               metricKey: 'dt.runtime.clr.memory.consumption',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'GC Time %',              metricKey: 'dt.runtime.clr.gc.time_percentage',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%',   betterIsLower: true  },
    { signal: 'saturation', label: 'GC Pause',               metricKey: 'dt.runtime.clr.gc.suspension_time',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
    { signal: 'saturation', label: 'Thread Pool Queue',      metricKey: 'dt.runtime.clr.threadpool.queued_work_items',   entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: true  },
  ],
  DOTNET: [
    { signal: 'saturation', label: 'CLR Heap',               metricKey: 'dt.runtime.clr.memory.consumption',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'GC Time %',              metricKey: 'dt.runtime.clr.gc.time_percentage',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%',   betterIsLower: true  },
    { signal: 'saturation', label: 'Thread Pool Queue',      metricKey: 'dt.runtime.clr.threadpool.queued_work_items',   entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: true  },
  ],
  SPRINGBOOT: [
    { signal: 'saturation', label: 'JVM Heap Used',          metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'GC Total Time',          metricKey: 'dt.runtime.jvm.gc.total_collection_time',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
    { signal: 'saturation', label: 'JVM Thread Count',       metricKey: 'dt.runtime.jvm.threads.count',                  entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
  ],
  TOMCAT: [
    { signal: 'saturation', label: 'JVM Heap Used',          metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'GC Total Time',          metricKey: 'dt.runtime.jvm.gc.total_collection_time',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
    { signal: 'saturation', label: 'JVM Thread Count',       metricKey: 'dt.runtime.jvm.threads.count',                  entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
  ],
  JBOSS: [
    { signal: 'saturation', label: 'JVM Heap Used',          metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'GC Total Time',          metricKey: 'dt.runtime.jvm.gc.total_collection_time',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
    { signal: 'saturation', label: 'JVM Thread Count',       metricKey: 'dt.runtime.jvm.threads.count',                  entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
  ],
  WEB_SPHERE: [
    { signal: 'saturation', label: 'JVM Heap Used',          metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
    { signal: 'saturation', label: 'Thread Pool Active',     metricKey: 'dt.runtime.websphere.threadpool.active_threads', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
    { signal: 'saturation', label: 'JDBC Pool %',            metricKey: 'dt.runtime.websphere.connectionpool.percent_used', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%', betterIsLower: true },
    { signal: 'saturation', label: 'GC Total Time',          metricKey: 'dt.runtime.jvm.gc.total_collection_time',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
  ],
  IIS_APP_POOL: [
    { signal: 'saturation', label: 'Active Threads',         metricKey: 'dt.runtime.iis.threads.active',                 entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
    { signal: 'saturation', label: 'Idle Threads',           metricKey: 'dt.runtime.iis.threads.idle',                   entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
    { signal: 'saturation', label: 'Queue Wait',             metricKey: 'dt.runtime.iis.connections.socket_waiting_time',entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms',  betterIsLower: true  },
  ],
  APACHE: [
    { signal: 'saturation', label: 'Active Workers',         metricKey: 'dt.runtime.apache.threads.active',              entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
    { signal: 'saturation', label: 'Idle Workers',           metricKey: 'dt.runtime.apache.threads.idle',                entityDim: 'dt.entity.process_group_instance', aggregation: 'avg',              betterIsLower: false },
    { signal: 'saturation', label: 'Queue Wait',             metricKey: 'dt.runtime.apache.connections.socket_waiting_time', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms', betterIsLower: true },
  ],
  RUBY: [
    { signal: 'saturation', label: 'RSS Memory',             metricKey: 'dt.process.memory.usage',                       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'MiB', bytesToMiB: true, betterIsLower: true },
  ],
};

// Base metric keys already shown in the standard columns — skip these in tech-specific extras
const BASE_METRIC_KEYS = new Set([
  'dt.service.request.response_time',
  'dt.service.request.count',
  'dt.service.request.failure_count',
  'dt.process.cpu.usage',
  'dt.process.memory.usage', // already shown in the Memory column
]);

// Deduplicated list of all unique tech metric defs (excluding base metrics already in the table)
export const ALL_UNIQUE_TECH_DEFS: TechMetricDef[] = (() => {
  const seen = new Set<string>();
  const result: TechMetricDef[] = [];
  for (const defs of Object.values(TECH_METRIC_DEFS)) {
    for (const def of defs) {
      if (!seen.has(def.metricKey) && !BASE_METRIC_KEYS.has(def.metricKey)) {
        seen.add(def.metricKey);
        result.push(def);
      }
    }
  }
  return result;
})();

// Groups for the Settings UI — each metric key appears at most once, in the first group that uses it.
// Groups are ordered so shared keys (e.g. JVM metrics used by both Spring Boot and WebSphere)
// appear under the primary group (JVM family first).
export const TECH_METRIC_GROUPS: Array<{ label: string; techTypes: string[]; defs: TechMetricDef[] }> = (() => {
  const shown = new Set<string>();
  const mkGroup = (label: string, techTypes: string[], allDefs: TechMetricDef[]) => {
    const unique = allDefs.filter((d) => !shown.has(d.metricKey) && !BASE_METRIC_KEYS.has(d.metricKey));
    unique.forEach((d) => shown.add(d.metricKey));
    return { label, techTypes, defs: unique };
  };

  const nodeDefs   = TECH_METRIC_DEFS['NODE_JS'] ?? [];
  // ASP.NET Core is a superset of .NET, so use it as the source for the combined group
  const clrDefs    = TECH_METRIC_DEFS['ASP_DOT_NET_CORE'] ?? [];
  // JVM family — SPRINGBOOT has the full set; WebSphere adds its own extras
  const jvmDefs    = TECH_METRIC_DEFS['SPRINGBOOT'] ?? [];
  const wsDefs     = TECH_METRIC_DEFS['WEB_SPHERE'] ?? [];
  const iisDefs    = TECH_METRIC_DEFS['IIS_APP_POOL'] ?? [];
  const apacheDefs = TECH_METRIC_DEFS['APACHE'] ?? [];

  const groups = [
    mkGroup('Node.js',                                ['NODE_JS'],                              nodeDefs),
    mkGroup('.NET CLR (ASP.NET Core, .NET)',          ['ASP_DOT_NET_CORE', 'DOTNET'],           clrDefs),
    mkGroup('JVM (Spring Boot, Tomcat, JBoss)',       ['SPRINGBOOT', 'TOMCAT', 'JBOSS'],        jvmDefs),
    mkGroup('WebSphere',                             ['WEB_SPHERE'],                            wsDefs),
    mkGroup('IIS App Pool',                          ['IIS_APP_POOL'],                          iisDefs),
    mkGroup('Apache HTTP',                           ['APACHE'],                                apacheDefs),
  ];
  return groups.filter((g) => g.defs.length > 0);
})();

export function getTechMetrics(techType: string): TechMetricDef[] {
  return TECH_METRIC_DEFS[techType] ?? [];
}
