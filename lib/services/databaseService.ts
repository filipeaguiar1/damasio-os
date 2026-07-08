import { runSupabaseHealthCheck } from "@/lib/services/healthService";

export type DatabaseTableStatus = {
  table: string;
  status: "ok" | "error";
  details: string;
};

export async function testDatabaseConnection(): Promise<DatabaseTableStatus[]> {
  const health = await runSupabaseHealthCheck();
  return health.tables.map(item => ({
    table: item.name,
    status: item.status === "ok" ? "ok" : "error",
    details: item.details
  }));
}
