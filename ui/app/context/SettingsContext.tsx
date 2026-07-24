import React, { createContext, useContext, useState } from "react";
import { type ThresholdConfig, type MetricCategory, type MetricThreshold, DEFAULT_THRESHOLDS, DEFAULT_TECH_THRESHOLDS } from "../utils/thresholds";

const STORAGE_KEY = "dt-neoload:settings";

interface AppSettings {
  showMissingTestsNotice: boolean;
  thresholds: ThresholdConfig;
  techThresholds: Record<string, MetricThreshold>;
}

function mergeThresholds(stored: unknown): ThresholdConfig {
  if (!stored || typeof stored !== 'object') return { ...DEFAULT_THRESHOLDS };
  const result = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as MetricCategory[]) {
    const storedKey = (stored as Record<string, unknown>)[key];
    if (storedKey && typeof storedKey === 'object') {
      result[key] = { ...DEFAULT_THRESHOLDS[key], ...(storedKey as Partial<MetricThreshold>) };
    }
  }
  return result;
}

function mergeTechThresholds(stored: unknown): Record<string, MetricThreshold> {
  const result = { ...DEFAULT_TECH_THRESHOLDS };
  if (!stored || typeof stored !== 'object') return result;
  for (const key of Object.keys(DEFAULT_TECH_THRESHOLDS)) {
    const storedKey = (stored as Record<string, unknown>)[key];
    if (storedKey && typeof storedKey === 'object') {
      result[key] = { ...DEFAULT_TECH_THRESHOLDS[key], ...(storedKey as Partial<MetricThreshold>) };
    }
  }
  return result;
}

function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    showMissingTestsNotice: true,
    thresholds: { ...DEFAULT_THRESHOLDS },
    techThresholds: { ...DEFAULT_TECH_THRESHOLDS },
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored);
    return {
      ...defaults,
      ...parsed,
      thresholds:     mergeThresholds(parsed.thresholds),
      techThresholds: mergeTechThresholds(parsed.techThresholds),
    };
  } catch {}
  return defaults;
}

function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

interface SettingsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: { showMissingTestsNotice: true, thresholds: { ...DEFAULT_THRESHOLDS }, techThresholds: { ...DEFAULT_TECH_THRESHOLDS } },
  updateSettings: () => {},
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
