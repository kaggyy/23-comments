import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ExtensionSettings } from "./storage";

let cachedClient: SupabaseClient | null = null;
let cachedClientKey = "";

export function createExtensionSupabase(settings: ExtensionSettings) {
  if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
    throw new Error("Supabase URLと公開キーが必要です。");
  }

  const nextClientKey = `${settings.supabaseUrl}:${settings.supabaseAnonKey}`;

  if (cachedClient && cachedClientKey === nextClientKey) {
    return cachedClient;
  }

  cachedClient = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "comment-tool-extension-auth"
    }
  });
  cachedClientKey = nextClientKey;

  return cachedClient;
}

export async function createAuthenticatedSupabase(settings: ExtensionSettings) {
  const client = createExtensionSupabase(settings);

  if (!settings.session?.access_token || !settings.session.refresh_token) {
    throw new Error("コメントを保存する前にログインしてください。");
  }

  const { error } = await client.auth.setSession({
    access_token: settings.session.access_token,
    refresh_token: settings.session.refresh_token
  });

  if (error) {
    throw error;
  }

  return client;
}
