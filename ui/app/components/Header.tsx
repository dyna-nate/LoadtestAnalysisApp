import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppHeader, Flex } from "@dynatrace/strato-components/layouts";
import { Select } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { useHiddenTests } from "../context/HiddenTestsContext";
import { SettingIcon } from "@dynatrace/strato-icons";
import { useDql } from "@dynatrace-sdk/react-hooks";
import {
  type TestExecution,
  useSelectedTest,
} from "../context/SelectedTestContext";
import { SettingsSheet } from "./SettingsSheet";
import { useSettings } from "../context/SettingsContext";
import { parseProjectFromTestExecution, parseScenarioFromTestExecution } from "../utils/sloData";
import { logger } from "../utils/logger";

const LOOKUP_QUERY =
  'load "/lookups/perftest/neoload/testsummarybytime" | sort test_start desc';

function durationMs(t: TestExecution): number | null {
  if (t.test_duration_ms != null && !isNaN(Number(t.test_duration_ms))) return Number(t.test_duration_ms);
  const d = new Date(t.test_end).getTime() - new Date(t.test_start).getTime();
  return isNaN(d) ? null : d;
}

function fmtDur(ms: number | null): string {
  if (ms == null) return "n/a";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export const Header = () => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data, isLoading, error } = useDql<TestExecution>(LOOKUP_QUERY);
  const { primaryTest, setPrimaryTest, compareTests, setCompareTests } = useSelectedTest();
  const { settings } = useSettings();
  const { isHidden, hiddenIds, hideTest, unhideTest } = useHiddenTests();
  const [showHidden, setShowHidden] = useState(false);
  const formatRunLabel = (t: TestExecution) =>
    `${new Date(t.test_start).toLocaleString()} · ${fmtDur(durationMs(t))}${isHidden(t.te_uuid) ? " (hidden)" : ""}`;
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);

  const allRecords = data?.records ?? [];

  // Resolve project/scenario from te_* fields when present; fall back to parsing test_execution
  const getProject = (r: TestExecution) => r.te_projectname || parseProjectFromTestExecution(r.test_execution);
  const getScenario = (r: TestExecution) => r.te_scenarioname || parseScenarioFromTestExecution(r.test_execution);

  const projectNames = [...new Set(allRecords.map(getProject).filter(Boolean))].sort() as string[];

  const allScenarioNames = [
    ...new Set(
      (selectedProject ? allRecords.filter((r) => getProject(r) === selectedProject) : allRecords)
        .map(getScenario)
        .filter(Boolean)
    ),
  ].sort() as string[];

  const scenarioNames = settings.benchmarkScenarioFilter
    ? allScenarioNames.filter((s) => s.toLowerCase().includes("benchmark"))
    : allScenarioNames;

  const testRuns = allRecords.filter(
    (r) =>
      (showHidden || !isHidden(r.te_uuid) || r.te_uuid === primaryTest?.te_uuid) &&
      getScenario(r) === selectedScenario &&
      (!selectedProject || getProject(r) === selectedProject)
  );

  const compareRuns = testRuns.filter(
    (r) => r.te_uuid !== primaryTest?.te_uuid
  );

  const compareIds = compareTests.map((t) => t.te_uuid);

  useEffect(() => {
    if (isLoading) logger.debug("Loading test executions from lookup table...");
  }, [isLoading]);

  useEffect(() => {
    if (data) logger.debug(`Loaded ${allRecords.length} test execution(s)`, allRecords);
  }, [data]);

  useEffect(() => {
    if (error) logger.error("Failed to load test executions", error);
  }, [error]);

  const handleProjectChange = (value: string | null | undefined) => {
    const project = value ?? null;
    logger.debug("Project selected", project);
    setSelectedProject(project);
    setSelectedScenario(null);
    setPrimaryTest(null);
    setCompareTests([]);
  };

  const handleScenarioChange = (value: string | null | undefined) => {
    const scenario = value ?? null;
    logger.debug("Scenario selected", scenario);
    setSelectedScenario(scenario);
    setPrimaryTest(null);
    setCompareTests([]);

    if (scenario) {
      const matchingProjects = [
        ...new Set(
          allRecords
            .filter((r) => getScenario(r) === scenario)
            .map(getProject)
            .filter(Boolean)
        ),
      ] as string[];
      if (matchingProjects.length === 1) {
        logger.debug("Auto-setting project from scenario", matchingProjects[0]);
        setSelectedProject(matchingProjects[0]);
      }
    }
  };

  const handlePrimaryChange = (value: string | null | undefined) => {
    const found = allRecords.find((r) => r.te_uuid === value) ?? null;
    logger.debug("Primary test selected", found);
    setPrimaryTest(found);
    if (found) {
      setCompareTests(compareTests.filter((t) => t.te_uuid !== found.te_uuid));
    }
    if (found && !selectedScenario) {
      setSelectedScenario(getScenario(found));
    }
    if (found && !selectedProject) {
      setSelectedProject(getProject(found));
    }
  };

  const handleCompareChange = (values: string[] | null | undefined) => {
    const ids = values ?? [];
    const found = allRecords.filter((r) => ids.includes(r.te_uuid));
    logger.debug("Compare tests selected", found);
    setCompareTests(found);
  };

  return (
    <>
      <AppHeader>
        <AppHeader.Navigation>
          <AppHeader.Logo as={Link} to="/" />
          <AppHeader.NavigationItem as={Link} to="/data">
            Explore Data
          </AppHeader.NavigationItem>
          <AppHeader.NavigationItem as={Link} to="/report">
            Release Report
          </AppHeader.NavigationItem>
          <AppHeader.NavigationItem as={Link} to="/setup">
            Integration Setup
          </AppHeader.NavigationItem>
          <AppHeader.NavigationItem
            as="button"
            onClick={() => setSettingsOpen(true)}
            isSelected={settingsOpen}
            style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
          >
            <SettingIcon />
            Settings
          </AppHeader.NavigationItem>
        </AppHeader.Navigation>
        <AppHeader.ActionItems>
          <Flex flexDirection="column" gap={4}>
            <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">
              {primaryTest
                ? (() => {
                    const p = durationMs(primaryTest);
                    const diffs = compareTests.filter((t) => {
                      const d = durationMs(t);
                      return p != null && d != null && p > 0 && Math.abs(d - p) / p > 0.1;
                    });
                    return `Primary duration: ${fmtDur(p)}` +
                      (compareTests.length ? ` | Compare: ${compareTests.map((t) => fmtDur(durationMs(t))).join(", ")}` : "") +
                      (diffs.length ? ` ⚠ ${diffs.length} compare test(s) differ by more than 10% in duration` : "");
                  })()
                : "Select a project and scenario, then choose a primary test to analyze and optionally compare against past tests."}
            </Text>
            <Flex gap={8} alignItems="center">
              <div style={{ width: "280px" }}>
                <Select<string>
                  value={selectedProject ?? null}
                  onChange={handleProjectChange}
                  disabled={isLoading}
                >
                  <Select.Trigger placeholder="Project..." width="full" />
                  <Select.Content>
                    {projectNames.map((name) => (
                      <Select.Option key={name} value={name}>
                        {name}
                      </Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div style={{ width: "280px" }}>
                <Select<string>
                  value={selectedScenario ?? null}
                  onChange={handleScenarioChange}
                  disabled={isLoading}
                >
                  <Select.Trigger placeholder="Scenario..." width="full" />
                  <Select.Content>
                    {scenarioNames.map((name) => (
                      <Select.Option key={name} value={name}>
                        {name}
                      </Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div style={{ width: "280px" }}>
                <Select<string>
                  value={primaryTest?.te_uuid ?? null}
                  onChange={handlePrimaryChange}
                  disabled={isLoading || !selectedScenario}
                >
                  <Select.Trigger placeholder="Primary test..." width="full" />
                  <Select.Content>
                    {testRuns.map((t) => (
                      <Select.Option key={t.te_uuid} value={t.te_uuid}>
                        {formatRunLabel(t)}
                      </Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              {primaryTest && (
                <Button
                  onClick={() =>
                    isHidden(primaryTest.te_uuid)
                      ? unhideTest(primaryTest.te_uuid)
                      : (hideTest(primaryTest.te_uuid), setPrimaryTest(null), setCompareTests([]))
                  }
                >
                  {isHidden(primaryTest.te_uuid) ? "Unhide test" : "Hide test"}
                </Button>
              )}
              {hiddenIds.size > 0 && (
                <Button onClick={() => setShowHidden(!showHidden)}>
                  {showHidden ? "Hide hidden" : `Show hidden (${hiddenIds.size})`}
                </Button>
              )}
              <div style={{ width: "380px" }}>
                <Select<string, true>
                  multiple={true}
                  value={compareIds}
                  onChange={handleCompareChange}
                  disabled={isLoading || !primaryTest}
                >
                  <Select.Trigger placeholder="Compare against..." width="full" />
                  <Select.Content>
                    {compareRuns.map((t) => (
                      <Select.Option key={t.te_uuid} value={t.te_uuid}>
                        {formatRunLabel(t)}
                      </Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </Flex>
          </Flex>
        </AppHeader.ActionItems>
      </AppHeader>

      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
};
