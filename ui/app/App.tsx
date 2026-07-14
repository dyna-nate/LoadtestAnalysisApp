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

export const App = () => {
  return (
    <SettingsProvider>
    <SelectedTestProvider>
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
    </SelectedTestProvider>
    </SettingsProvider>
  );
};
