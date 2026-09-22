import React, { createContext, useContext, useEffect, useState } from "react";
import { stateClient } from "@dynatrace-sdk/client-state";
import { DEFAULT_SLO_ENTRIES, type SloEntry, type SloConfig } from "../utils/sloData";

const SLO_STATE_KEY = "neoload-slo-config";

interface SloState {
  entries: SloEntry[];
  isSaving: boolean;
  saveEntries: (entries: SloEntry[]) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

const SloContext = createContext<SloState>({
  entries: DEFAULT_SLO_ENTRIES,
  isSaving: false,
  saveEntries: async () => {},
  resetToDefaults: async () => {},
});

export const SloProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [entries, setEntries] = useState<SloEntry[]>(DEFAULT_SLO_ENTRIES);
  const [isSaving, setIsSaving] = useState(false);

  // Load on mount — use getAppStates with a filter so a missing key returns [] instead of a 404
  useEffect(() => {
    let cancelled = false;
    stateClient.getAppStates({ filter: `key = '${SLO_STATE_KEY}'`, addFields: "value" })
      .then(states => {
        if (cancelled) return;
        const value = states[0]?.value;
        if (!value) return; // key doesn't exist yet — keep defaults
        try {
          const parsed = JSON.parse(value) as SloConfig;
          if (Array.isArray(parsed?.entries) && parsed.entries.length > 0) {
            setEntries(parsed.entries);
          }
        } catch { /* malformed JSON — keep defaults */ }
      })
      .catch(() => { /* unexpected error — keep defaults */ });
    return () => { cancelled = true; };
  }, []);

  const saveEntries = async (newEntries: SloEntry[]) => {
    setEntries(newEntries);
    setIsSaving(true);
    try {
      const config: SloConfig = { version: 1, entries: newEntries };
      await stateClient.setAppState({
        key: SLO_STATE_KEY,
        body: { value: JSON.stringify(config) },
      });
    } finally {
      setIsSaving(false);
    }
  };

  const resetToDefaults = () => saveEntries(DEFAULT_SLO_ENTRIES);

  return (
    <SloContext.Provider value={{ entries, isSaving, saveEntries, resetToDefaults }}>
      {children}
    </SloContext.Provider>
  );
};

export const useSlos = () => useContext(SloContext);
