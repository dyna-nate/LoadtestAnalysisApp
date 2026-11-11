import React, { createContext, useContext, useEffect, useState } from "react";
import { stateClient } from "@dynatrace-sdk/client-state";

const HIDDEN_STATE_KEY = "neoload-hidden-tests";

interface HiddenTestsState {
  hiddenIds: Set<string>;
  isHidden: (teUuid: string) => boolean;
  hideTest: (teUuid: string) => Promise<void>;
  unhideTest: (teUuid: string) => Promise<void>;
}

const HiddenTestsContext = createContext<HiddenTestsState>({
  hiddenIds: new Set(),
  isHidden: () => false,
  hideTest: async () => {},
  unhideTest: async () => {},
});

export const HiddenTestsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    stateClient
      .getAppStates({ filter: `key = '${HIDDEN_STATE_KEY}'`, addFields: "value" })
      .then((states) => {
        const value = states[0]?.value;
        if (cancelled || !value) return;
        try {
          const parsed = JSON.parse(value) as { ids?: unknown };
          if (Array.isArray(parsed?.ids)) setHiddenIds(new Set(parsed.ids as string[]));
        } catch { /* malformed — ignore */ }
      })
      .catch(() => { /* keep empty */ });
    return () => { cancelled = true; };
  }, []);

  const persist = async (next: Set<string>) => {
    setHiddenIds(next);
    await stateClient.setAppState({
      key: HIDDEN_STATE_KEY,
      body: { value: JSON.stringify({ version: 1, ids: [...next] }) },
    });
  };

  const hideTest = (id: string) => persist(new Set(hiddenIds).add(id));
  const unhideTest = (id: string) => {
    const next = new Set(hiddenIds);
    next.delete(id);
    return persist(next);
  };

  return (
    <HiddenTestsContext.Provider
      value={{ hiddenIds, isHidden: (id) => hiddenIds.has(id), hideTest, unhideTest }}
    >
      {children}
    </HiddenTestsContext.Provider>
  );
};

export const useHiddenTests = () => useContext(HiddenTestsContext);
