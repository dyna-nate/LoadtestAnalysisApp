import React, { createContext, useContext, useEffect, useState } from "react";
import { useSelectedTest } from "./SelectedTestContext";

interface FilterState {
  filterSteps:    string[];
  filterRequests: string[];
  filterScripts:  string[];
  filterZones:    string[];
  setFilterSteps:    (v: string[]) => void;
  setFilterRequests: (v: string[]) => void;
  setFilterScripts:  (v: string[]) => void;
  setFilterZones:    (v: string[]) => void;
  clearFilters: () => void;
}

const FilterContext = createContext<FilterState>({
  filterSteps: [], filterRequests: [], filterScripts: [], filterZones: [],
  setFilterSteps: () => {}, setFilterRequests: () => {}, setFilterScripts: () => {}, setFilterZones: () => {},
  clearFilters: () => {},
});

export const FilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { primaryTest } = useSelectedTest();
  const [filterSteps,    setFilterSteps]    = useState<string[]>([]);
  const [filterRequests, setFilterRequests] = useState<string[]>([]);
  const [filterScripts,  setFilterScripts]  = useState<string[]>([]);
  const [filterZones,    setFilterZones]    = useState<string[]>([]);

  // Reset whenever the primary test changes
  useEffect(() => {
    setFilterSteps([]);
    setFilterRequests([]);
    setFilterScripts([]);
    setFilterZones([]);
  }, [primaryTest?.te_uuid]);

  const clearFilters = () => {
    setFilterSteps([]);
    setFilterRequests([]);
    setFilterScripts([]);
    setFilterZones([]);
  };

  return (
    <FilterContext.Provider value={{ filterSteps, filterRequests, filterScripts, filterZones, setFilterSteps, setFilterRequests, setFilterScripts, setFilterZones, clearFilters }}>
      {children}
    </FilterContext.Provider>
  );
};

export const useFilters = () => useContext(FilterContext);
