import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { CORE_DATABASE_TABLES } from "@/lib/config/database";

type HealthCheckTable = {
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

function normalizeHealthCheck(value: unknown): DatabaseHealthCheck {
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

export async function runDatabaseHealthCheck(): Promise<DatabaseHealthCheck> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured. Fill .env.local first.");
  }

  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("database_health_check");

  if (error) {
    throw new Error(error.message);
  }

  const normalized = normalizeHealthCheck(data);
  const missing = CORE_DATABASE_TABLES.filter(
    table => !normalized.tables.some(row => row.table === table && row.exists)
  );

  return {
    ...normalized,
    ok: normalized.ok && missing.length === 0
  };
}
