export interface TechMetricDef {
  label: string;
  metricKey: string;
  entityDim: 'dt.entity.service' | 'dt.entity.process_group_instance';
  aggregation: 'avg' | 'sum';
  unit?: string;
}

// The single most important tech-specific saturation metric per tech type.
// Used for the detail panel when a row is selected.
export const KEY_SATURATION: Record<string, TechMetricDef> = {
  SPRINGBOOT:      { label: 'JVM Heap Used',       metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
  TOMCAT:          { label: 'JVM Heap Used',       metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
  JBOSS:           { label: 'JVM Heap Used',       metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
  WEB_SPHERE:      { label: 'JVM Heap Used',       metricKey: 'dt.runtime.jvm.memory_pool.used',               entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
  ASP_DOT_NET_CORE:{ label: 'CLR Heap',            metricKey: 'dt.runtime.clr.memory.consumption',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
  DOTNET:          { label: 'CLR Heap',            metricKey: 'dt.runtime.clr.memory.consumption',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
  NODE_JS:         { label: 'Event Loop Util',     metricKey: 'dt.runtime.nodejs.eventloop.utilization',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%' },
  IIS_APP_POOL:    { label: 'Active Threads',      metricKey: 'dt.runtime.iis.threads.active',                 entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  APACHE:          { label: 'Active Workers',      metricKey: 'dt.runtime.apache.threads.active',              entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  RUBY:            { label: 'Process Memory',      metricKey: 'dt.process.memory.usage',                       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
};

// Additional saturation metrics shown in the detail panel per tech type.
export const EXTRA_SATURATION: Record<string, TechMetricDef[]> = {
  SPRINGBOOT: [
    { label: 'GC Time',      metricKey: 'dt.runtime.jvm.gc.total_collection_time', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
    { label: 'Thread Count', metricKey: 'dt.runtime.jvm.threads.count',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  ],
  TOMCAT: [
    { label: 'GC Time',      metricKey: 'dt.runtime.jvm.gc.total_collection_time', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
    { label: 'Thread Count', metricKey: 'dt.runtime.jvm.threads.count',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  ],
  JBOSS: [
    { label: 'GC Time',      metricKey: 'dt.runtime.jvm.gc.total_collection_time', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
    { label: 'Thread Count', metricKey: 'dt.runtime.jvm.threads.count',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  ],
  WEB_SPHERE: [
    { label: 'Thread Pool Active', metricKey: 'dt.runtime.websphere.threadpool.active_threads',      entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
    { label: 'JDBC Pool %',        metricKey: 'dt.runtime.websphere.connectionpool.percent_used',    entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%' },
    { label: 'GC Time',            metricKey: 'dt.runtime.jvm.gc.total_collection_time',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
  ],
  ASP_DOT_NET_CORE: [
    { label: 'GC Time %',       metricKey: 'dt.runtime.clr.gc.time_percentage',              entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%' },
    { label: 'Thread Pool Queue', metricKey: 'dt.runtime.clr.threadpool.queued_work_items',  entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
    { label: 'GC Pause',        metricKey: 'dt.runtime.clr.gc.suspension_time',              entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
  ],
  DOTNET: [
    { label: 'GC Time %',       metricKey: 'dt.runtime.clr.gc.time_percentage',              entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: '%' },
    { label: 'Thread Pool Queue', metricKey: 'dt.runtime.clr.threadpool.queued_work_items',  entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  ],
  NODE_JS: [
    { label: 'V8 Heap Used',   metricKey: 'dt.runtime.nodejs.memory.used',             entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'B' },
    { label: 'GC Time',        metricKey: 'dt.runtime.nodejs.gc.collection_time',       entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
    { label: 'Active Handles', metricKey: 'dt.runtime.nodejs.eventloop.active_handles', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
  ],
  APACHE: [
    { label: 'Idle Workers',    metricKey: 'dt.runtime.apache.threads.idle',                   entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
    { label: 'Queue Wait (ms)', metricKey: 'dt.runtime.apache.connections.socket_waiting_time', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
  ],
  IIS_APP_POOL: [
    { label: 'Idle Threads',    metricKey: 'dt.runtime.iis.threads.idle',                   entityDim: 'dt.entity.process_group_instance', aggregation: 'avg' },
    { label: 'Queue Wait (ms)', metricKey: 'dt.runtime.iis.connections.socket_waiting_time', entityDim: 'dt.entity.process_group_instance', aggregation: 'avg', unit: 'ms' },
    { label: 'IIS Requests',    metricKey: 'dt.runtime.iis.requests',                        entityDim: 'dt.entity.process_group_instance', aggregation: 'sum' },
  ],
  RUBY: [],
};

export function getKeySaturation(techType: string): TechMetricDef | null {
  return KEY_SATURATION[techType] ?? null;
}

export function getExtraSaturation(techType: string): TechMetricDef[] {
  return EXTRA_SATURATION[techType] ?? [];
}
