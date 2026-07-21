import React, { useState, useEffect } from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { Button } from "@dynatrace/strato-components/buttons";
import { Switch } from "@dynatrace/strato-components/forms";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { useSettings } from "../context/SettingsContext";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

export const SettingsSheet: React.FC<SettingsSheetProps> = ({ open, onClose }) => {
  const { settings, updateSettings } = useSettings();

  // Local pending state — only committed on Save
  const [pending, setPending] = useState(settings);

  // Sync pending state when sheet opens
  useEffect(() => {
    if (open) setPending(settings);
  }, [open]);

  const handleSave = () => {
    updateSettings(pending);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <Sheet
      show={open}
      onDismiss={handleCancel}
      topoffset={52}
      actions={
        <Button variant="emphasized" onClick={handleSave}>
          Save Settings
        </Button>
      }
    >
      {/* Styled header matching the Dynatrace app settings pattern */}
      <div
        style={{
          background: "linear-gradient(135deg, #1c2b6e 0%, #0d1a4a 100%)",
          padding: "20px 24px 24px",
          margin: "-16px -16px 24px",
        }}
      >
        <Heading level={3} style={{ color: "#fff", marginBottom: "4px" }}>
          App Settings
        </Heading>
        <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.875em" }}>
          Configure display preferences
        </Text>
      </div>

      {/* Settings content */}
      <Flex flexDirection="column" gap={24}>
        {/* Request Detail section */}
        <Flex flexDirection="column" gap={12}>
          <Text
            style={{
              fontSize: "0.72em",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8e9099",
            }}
          >
            Request Detail Panel
          </Text>

          <Flex justifyContent="space-between" alignItems="flex-start" gap={24}>
            <Flex flexDirection="column" gap={4} style={{ flex: 1 }}>
              <Text>Show missing lookup table notices</Text>
              <Text textStyle="small" color="var(--dt-color-text-subdued, #8e9099)">
                Display a notice for comparison tests that have no
                neoload.responsetime.detailed business events. Disable once
                you know which executions are missing data.
              </Text>
            </Flex>
            <Switch
              value={pending.showMissingTestsNotice}
              onChange={(checked) =>
                setPending(prev => ({ ...prev, showMissingTestsNotice: checked }))
              }
            />
          </Flex>
        </Flex>
      </Flex>

      {/* Footer */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          padding: "16px 24px",
          display: "flex",
          gap: "12px",
          background: "var(--dt-color-background-base-default, #1a1a2e)",
        }}
      >
        <Button variant="emphasized" onClick={handleSave} style={{ flex: 1 }}>
          Save Settings
        </Button>
        <Button variant="default" onClick={handleCancel}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
};
