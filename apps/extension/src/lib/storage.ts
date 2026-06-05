import type { Session } from "@supabase/supabase-js";

export type StoredProject = {
  id: string;
  organizationId: string;
  name: string;
};

export type ExtensionSettings = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  session?: Session;
  selectedProject?: StoredProject;
};

const settingsKey = "commentToolSettings";

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(settingsKey);
  return (result[settingsKey] ?? {}) as ExtensionSettings;
}

export async function saveSettings(nextSettings: ExtensionSettings) {
  const current = await getSettings();
  await chrome.storage.local.set({
    [settingsKey]: {
      ...current,
      ...nextSettings
    }
  });
}

export async function clearSession() {
  const current = await getSettings();
  await chrome.storage.local.set({
    [settingsKey]: {
      supabaseUrl: current.supabaseUrl,
      supabaseAnonKey: current.supabaseAnonKey
    }
  });
}
