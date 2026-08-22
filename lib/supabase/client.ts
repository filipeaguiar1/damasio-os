import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let browserClient: SupabaseClient<Database> | null = null;
const KEEP_CONNECTED_KEY = "damasio_keep_connected";

function shouldPersistSession() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEEP_CONNECTED_KEY) !== "false";
}

const browserAuthStorage = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    return shouldPersistSession() ? window.localStorage.getItem(key) : window.sessionStorage.getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    const primary = shouldPersistSession() ? window.localStorage : window.sessionStorage;
    const secondary = shouldPersistSession() ? window.sessionStorage : window.localStorage;
    primary.setItem(key, value);
    secondary.removeItem(key);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function setSessionPersistencePreference(keepConnected: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEEP_CONNECTED_KEY, String(keepConnected));
}

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("your-project")) {
    throw new Error("Supabase is not configured. Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
  }

  if (!browserClient) {
    browserClient = createClient<Database>(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: browserAuthStorage,
      },
    });
  }

  return browserClient;
}

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && anonKey && !url.includes("your-project"));
}
