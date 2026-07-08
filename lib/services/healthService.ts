import { CORE_DATABASE_TABLES } from "@/lib/config/database";
import {
  checkAuthHealth,
  checkDatabaseHealth,
  checkEnvironmentHealth,
  checkStorageHealth
} from "@/lib/repositories/healthRepository";

export type HealthStatus = "ok" | "error" | "pending";

export type HealthItem = {
  name: string;
  status: HealthStatus;
  details: string;
};

export type SupabaseHealthReport = {
  ok: boolean;
  checkedAt: string;
  environment: HealthItem[];
  auth: HealthItem[];
  storage: HealthItem[];
  tables: HealthItem[];
};

export async function runSupabaseHealthCheck(): Promise<SupabaseHealthReport> {
  const checkedAt = new Date().toISOString();
  const environment = await checkEnvironmentHealth();

  const environmentItems: HealthItem[] = [
    {
      name: "Project URL",
      status: environment.urlConfigured ? "ok" : "error",
      details: environment.urlConfigured ? "Configured" : "Missing NEXT_PUBLIC_SUPABASE_URL"
    },
    {
      name: "Publishable key",
      status: environment.keyConfigured ? "ok" : "error",
      details: environment.keyConfigured ? "Configured" : "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY"
    }
  ];

  if (!environment.ok) {
    return { ok: false, checkedAt, environment: environmentItems, auth: [], storage: [], tables: [] };
  }

  const [auth, storage, database] = await Promise.all([
    checkAuthHealth(),
    checkStorageHealth(),
    checkDatabaseHealth()
  ]);

  const authItems: HealthItem[] = [{
    name: "Supabase Auth",
    status: auth.ok ? "ok" : "error",
    details: auth.ok ? `Ready (${auth.mode})` : auth.error || "Auth check failed"
  }];

  const storageItems: HealthItem[] = storage.buckets.map(bucket => ({
    name: bucket.bucket,
    status: bucket.exists ? "ok" : "error",
    details: bucket.exists ? "Bucket found" : "Bucket missing"
  }));

  if (storage.error && storageItems.length === 0) {
    storageItems.push({ name: "Storage", status: "error", details: storage.error });
  }

  const tableItems: HealthItem[] = CORE_DATABASE_TABLES.map(table => {
    const result = database.tables.find(row => row.table === table);
    if (!result || !result.exists) {
      return { name: table, status: "error", details: result?.error || "Table not found" };
    }
    return {
      name: table,
      status: "ok",
      details: typeof result.visible_rows === "number" ? `${result.visible_rows} rows visible to health function` : "Table found"
    };
  });

  const allItems = [...environmentItems, ...authItems, ...storageItems, ...tableItems];
  return { ok: allItems.every(item => item.status === "ok"), checkedAt, environment: environmentItems, auth: authItems, storage: storageItems, tables: tableItems };
}
