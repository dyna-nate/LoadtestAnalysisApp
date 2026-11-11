import { Page } from "@dynatrace/strato-components/layouts";
import React from "react";
import { Route, Routes } from "react-router-dom";
import { Data } from "./pages/Data";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { IntegrationSetup } from "./pages/IntegrationSetup";
import { ReleaseReportPage } from "./pages/ReleaseReport";
import { TestSummaryPanel } from "./components/TestSummaryPanel";
import { RequestDetailPanel } from "./components/RequestDetailPanel";
import { SelectedTestProvider } from "./context/SelectedTestContext";
import { SettingsProvider } from "./context/SettingsContext";
import { FilterProvider } from "./context/FilterContext";
import { SloProvider } from "./context/SloContext";
import { HiddenTestsProvider } from "./context/HiddenTestsContext";
import { AccessProvider } from "./context/AccessContext";

export const App = () => {
  return (
    <SettingsProvider>
    <AccessProvider>
    <SloProvider>
    <HiddenTestsProvider>
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
            <Route path="/setup" element={<IntegrationSetup />} />
            <Route path="/report" element={<ReleaseReportPage />} />
          </Routes>
        </Page.Main>
      </Page>
    </FilterProvider>
    </SelectedTestProvider>
    </HiddenTestsProvider>
    </SloProvider>
    </AccessProvider>
    </SettingsProvider>
  );
};
