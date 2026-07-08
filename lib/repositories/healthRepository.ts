import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { CORE_DATABASE_TABLES, STORAGE_BUCKETS } from "@/lib/config/database";

export type HealthCheckTable = {
  table: string;
  exists: boolean;
  visible_rows: number | null;
  error?: string | null;
};

export type DatabaseHealthCheck = {
  ok: boolean;
  checked_at: string;
  tables: HealthCheckTable[];
};

export type AuthHealthCheck = {
  ok: boolean;
  mode: "anonymous" | "authenticated";
  error?: string | null;
};

export type StorageHealthCheck = {
  ok: boolean;
  buckets: { bucket: string; exists: boolean }[];
  error?: string | null;
};

function normalizeDatabaseHealthCheck(value: unknown): DatabaseHealthCheck {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid database health check response.");
  }

  const data = value as Partial<DatabaseHealthCheck>;
  return {
    ok: Boolean(data.ok),
    checked_at: typeof data.checked_at === "string" ? data.checked_at : new Date().toISOString(),
    tables: Array.isArray(data.tables) ? data.tables : []
  };
}

export async function checkEnvironmentHealth() {
  return {
    ok: isSupabaseConfigured(),
    urlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    keyConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  };
}

export async function checkDatabaseHealth(): Promise<DatabaseHealthCheck> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Fill .env.local first.");
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("database_health_check");

  if (error) throw new Error(error.message);

  const normalized = normalizeDatabaseHealthCheck(data);
  const missing = CORE_DATABASE_TABLES.filter(
    table => !normalized.tables.some(row => row.table === table && row.exists)
  );

  return { ...normalized, ok: normalized.ok && missing.length === 0 };
}

export async function checkAuthHealth(): Promise<AuthHealthCheck> {
  if (!isSupabaseConfigured()) {
    return { ok: false, mode: "anonymous", error: "Supabase is not configured." };
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) return { ok: false, mode: "anonymous", error: error.message };

  return { ok: true, mode: data.session ? "authenticated" : "anonymous", error: null };
}

export async function checkStorageHealth(): Promise<StorageHealthCheck> {
  if (!isSupabaseConfigured()) {
    return { ok: false, buckets: [], error: "Supabase is not configured." };
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("storage_health_check");

  if (error) return { ok: false, buckets: [], error: error.message };

  const value = data as { buckets?: { bucket: string; exists: boolean }[]; ok?: boolean } | null;
  const buckets = STORAGE_BUCKETS.map(bucket => {
    const result = value?.buckets?.find(row => row.bucket === bucket);
    return { bucket, exists: Boolean(result?.exists) };
  });

  return { ok: Boolean(value?.ok) && buckets.every(bucket => bucket.exists), buckets, error: null };
}
