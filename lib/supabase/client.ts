import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let browserClient: SupabaseClient<Database> | null = null;

const KEEP_CONNECTED_KEY = "damasio_keep_connected";

function keepConnected() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(KEEP_CONNECTED_KEY) !== "false";
}

const rememberAwareStorage = {
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    return (keepConnected() ? window.localStorage : window.sessionStorage).getItem(key);
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    const target = keepConnected() ? window.localStorage : window.sessionStorage;
    const other = keepConnected() ? window.sessionStorage : window.localStorage;
    target.setItem(key, value);
    other.removeItem(key);
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export function setAuthPersistencePreference(value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEEP_CONNECTED_KEY, String(value));
  if (!value) {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) window.localStorage.removeItem(key);
    }
  }
}

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.includes("your-project")) {
    throw new Error("Supabase is not configured. Fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
  }

  if (!browserClient) {
    browserClient = createClient<Database>(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: rememberAwareStorage },
    });
  }

  return browserClient;
}

export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && anonKey && !url.includes("your-project"));
}
