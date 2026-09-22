import React, { createContext, useContext, useEffect, useState } from "react";
import { stateClient } from "@dynatrace-sdk/client-state";
import { getCurrentUserDetails } from "@dynatrace-sdk/app-environment";

const ACCESS_STATE_KEY = "neoload-settings-admins";

interface AccessState {
  isAdmin: boolean;
  currentUserEmail: string;
  adminEmails: string[];
  isSaving: boolean;
  saveAdminEmails: (emails: string[]) => Promise<void>;
}

const AccessContext = createContext<AccessState>({
  isAdmin: true,
  currentUserEmail: "",
  adminEmails: [],
  isSaving: false,
  saveAdminEmails: async () => {},
});

export const AccessProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const rawDetails = getCurrentUserDetails();
  // Guard against sentinel values returned when user context is unavailable
  const currentUserEmail = rawDetails.email.startsWith("dt.missing")
    ? ""
    : rawDetails.email.toLowerCase();

  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    stateClient
      .getAppStates({ filter: `key = '${ACCESS_STATE_KEY}'`, addFields: "value" })
      .then(states => {
        if (cancelled) return;
        const value = states[0]?.value;
        if (value) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              setAdminEmails(parsed.map((e: unknown) => String(e).toLowerCase().trim()).filter(Boolean));
            }
          } catch {}
        }
        setLoaded(true);
      })
      .catch(() => { setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Empty list = open access (all users can edit)
  const isAdmin =
    !loaded ||
    adminEmails.length === 0 ||
    (currentUserEmail !== "" && adminEmails.includes(currentUserEmail));

  const saveAdminEmails = async (emails: string[]) => {
    const normalized = emails.map(e => e.toLowerCase().trim()).filter(Boolean);
    setAdminEmails(normalized);
    setIsSaving(true);
    try {
      await stateClient.setAppState({
        key: ACCESS_STATE_KEY,
        body: { value: JSON.stringify(normalized) },
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AccessContext.Provider value={{ isAdmin, currentUserEmail, adminEmails, isSaving, saveAdminEmails }}>
      {children}
    </AccessContext.Provider>
  );
};

export const useAccess = () => useContext(AccessContext);
