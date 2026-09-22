import { Page } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Data } from "./pages/Data";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { TestSummaryPanel } from "./components/TestSummaryPanel";
import { RequestDetailPanel } from "./components/RequestDetailPanel";
import { SelectedTestProvider } from "./context/SelectedTestContext";
import { SettingsProvider } from "./context/SettingsContext";
import { FilterProvider } from "./context/FilterContext";
import { SloProvider } from "./context/SloContext";
import { AccessProvider } from "./context/AccessContext";

export const App = () => {
  return (
    <SettingsProvider>
    <AccessProvider>
    <SloProvider>
    <SelectedTestProvider>
    <FilterProvider>
      <Page>
        <Page.Header>
          <Header />
        </Page.Header>
        <Page.Main>
          <TestSummaryPanel />
          <RequestDetailPanel />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/data" element={<Data />} />
          </Routes>
        </Page.Main>
      </Page>
    </FilterProvider>
    </SelectedTestProvider>
    </SloProvider>
    </AccessProvider>
    </SettingsProvider>
  );
};
