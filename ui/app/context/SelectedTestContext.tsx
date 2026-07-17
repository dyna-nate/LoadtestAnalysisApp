import React, { createContext, useContext, useState } from "react";
import { logger } from "../utils/logger";

export interface TestExecution {
  test_execution: string;
  test_start: string;
  test_end: string;
  test_duration_ms?: number;
  te_uuid: string;
  te_projectname?: string;
  te_scenarioname?: string;
  avg_dur_ms?: number;
  min_dur_ms?: number;
  max_dur_ms?: number;
  p50_dur_ms?: number;
  p90_dur_ms?: number;
  p95_dur_ms?: number;
  p99_dur_ms?: number;
}

interface SelectedTestContextValue {
  primaryTest: TestExecution | null;
  setPrimaryTest: (test: TestExecution | null) => void;
  compareTests: TestExecution[];
  setCompareTests: (tests: TestExecution[]) => void;
}

const SelectedTestContext = createContext<SelectedTestContextValue>({
  primaryTest: null,
  setPrimaryTest: () => {},
  compareTests: [],
  setCompareTests: () => {},
});

export const SelectedTestProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [primaryTest, setPrimaryTestState] = useState<TestExecution | null>(null);
  const [compareTests, setCompareTestsState] = useState<TestExecution[]>([]);

  const setPrimaryTest = (test: TestExecution | null) => {
    logger.debug("SelectedTestContext: primary test changed", test);
    setPrimaryTestState(test);
  };

  const setCompareTests = (tests: TestExecution[]) => {
    logger.debug("SelectedTestContext: compare tests changed", tests);
    setCompareTestsState(tests);
  };

  return (
    <SelectedTestContext.Provider
      value={{ primaryTest, setPrimaryTest, compareTests, setCompareTests }}
    >
      {children}
    </SelectedTestContext.Provider>
  );
};

export const useSelectedTest = () => useContext(SelectedTestContext);
