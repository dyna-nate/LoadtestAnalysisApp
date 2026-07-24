import { ALL_UNIQUE_TECH_DEFS } from './infraMetricConfig';

export type MetricCategory =
  | 'responseTime'
  | 'errorRate'
  | 'errorCount'
  | 'requestCount'
  | 'cpu'
  | 'memory';

export interface MetricThreshold {
  relEnabled: boolean;
  relPct: number;
  staticEnabled: boolean;
  staticValue: number;
  combination: 'or' | 'and';
}

export type ThresholdConfig = Record<MetricCategory, MetricThreshold>;

export const METRIC_CATEGORY_DEFS: Array<{
  key: MetricCategory;
  label: string;
  unit: string;
  betterIsLower: boolean;
}> = [
  { key: 'responseTime', label: 'Response Time', unit: 'ms',  betterIsLower: true  },
  { key: 'errorRate',    label: 'Error Rate',    unit: '%',   betterIsLower: true  },
  { key: 'errorCount',   label: 'Error Count',   unit: '',    betterIsLower: true  },
  { key: 'requestCount', label: 'Request Count', unit: '',    betterIsLower: false },
  { key: 'cpu',          label: 'CPU Usage',     unit: '%',   betterIsLower: true  },
  { key: 'memory',       label: 'Memory',        unit: 'MiB', betterIsLower: true  },
];

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  responseTime: { relEnabled: true,  relPct: 20, staticEnabled: false, staticValue: 2000, combination: 'or'  },
  errorRate:    { relEnabled: true,  relPct: 50, staticEnabled: false, staticValue: 5,    combination: 'and' },
  errorCount:   { relEnabled: true,  relPct: 50, staticEnabled: false, staticValue: 100,  combination: 'or'  },
  requestCount: { relEnabled: true,  relPct: 20, staticEnabled: false, staticValue: 10,   combination: 'or'  },
  cpu:          { relEnabled: true,  relPct: 50, staticEnabled: false, staticValue: 80,   combination: 'or'  },
  memory:       { relEnabled: true,  relPct: 50, staticEnabled: false, staticValue: 1024, combination: 'or'  },
};

// Default thresholds for tech-specific metrics, keyed by DT metric key.
// betterIsLower metrics (heap, GC, wait times) default to 50% relative threshold.
// Traffic-like metrics (thread counts, workers) also default to 50% relative.
export const DEFAULT_TECH_THRESHOLDS: Record<string, MetricThreshold> = (() => {
  const out: Record<string, MetricThreshold> = {};
  for (const def of ALL_UNIQUE_TECH_DEFS) {
    out[def.metricKey] = { relEnabled: true, relPct: 50, staticEnabled: false, staticValue: 0, combination: 'or' };
  }
  return out;
})();

/**
 * Returns true when primary is "worse" according to the configured thresholds.
 * When both thresholds are disabled, falls back to any positive delta (original behaviour).
 */
export function isWorse(
  primary: number | null,
  baseline: number | null,
  betterIsLower: boolean,
  threshold: MetricThreshold
): boolean {
  if (primary == null) return false;

  const relCondition =
    threshold.relEnabled && baseline != null && baseline !== 0
      ? betterIsLower
        ? primary > baseline * (1 + threshold.relPct / 100)
        : primary < baseline * (1 - threshold.relPct / 100)
      : false;

  const staticCondition = threshold.staticEnabled
    ? betterIsLower
      ? primary > threshold.staticValue
      : primary < threshold.staticValue
    : false;

  if (!threshold.relEnabled && !threshold.staticEnabled) {
    if (baseline == null) return false;
    return betterIsLower ? primary > baseline : primary < baseline;
  }

  if (threshold.relEnabled && threshold.staticEnabled) {
    return threshold.combination === 'or'
      ? relCondition || staticCondition
      : relCondition && staticCondition;
  }

  return threshold.relEnabled ? relCondition : staticCondition;
}
