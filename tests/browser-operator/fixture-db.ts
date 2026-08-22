import { expect } from "@playwright/test";
import type { SupabaseAny } from "./fixture-env";

export async function insertRowsWithFallback(
  db: SupabaseAny,
  table: string,
  rows: Record<string, unknown>[],
  optionalColumns: string[],
) {
  let currentRows = rows;
  let remaining = [...optionalColumns];
  for (;;) {
    const result = await db.from(table).insert(currentRows);
    if (!result.error) return;
    const missing = remaining.find(column => missingColumn(result.error.message, column));
    if (!missing) throw new Error(`${table}: ${result.error.message}`);
    remaining = remaining.filter(column => column !== missing);
    currentRows = currentRows.map(row => omitKey(row, missing));
  }
}

export async function upsertRowsWithFallback(
  db: SupabaseAny,
  table: string,
  rows: Record<string, unknown>[],
  optionalColumns: string[],
) {
  let currentRows = rows;
  let remaining = [...optionalColumns];
  for (;;) {
    const result = await db.from(table).upsert(currentRows);
    if (!result.error) return;
    const missing = remaining.find(column => missingColumn(result.error.message, column));
    if (!missing) throw new Error(`${table}: ${result.error.message}`);
    remaining = remaining.filter(column => column !== missing);
    currentRows = currentRows.map(row => omitKey(row, missing));
  }
}

export function missingColumn(message: string, column: string) {
  return /schema cache|does not exist|could not find/i.test(message)
    && message.toLowerCase().includes(column.toLowerCase());
}

export async function selectCompanyIds(db: SupabaseAny, table: string, companyId: string) {
  let result = await db.from(table).select("id").or(companyFilter(companyId));
  if (result.error && missingColumn(result.error.message, "company_id")) {
    result = await db.from(table).select("id").eq("organization_id", companyId);
  }
  if (result.error) return [];
  return (result.data || []).map((row: any) => String(row.id));
}

export async function countCompanyRows(db: SupabaseAny, table: string, companyId: string) {
  let result = await db.from(table).select("id", { count: "exact", head: true }).or(companyFilter(companyId));
  if (result.error && missingColumn(result.error.message, "company_id")) {
    result = await db.from(table).select("id", { count: "exact", head: true }).eq("organization_id", companyId);
  }
  expect(result.error, `${table}: ${result.error?.message || ""}`).toBeNull();
  return Number(result.count || 0);
}

export async function countByIds(db: SupabaseAny, table: string, column: string, ids: string[]) {
  const values = unique(ids);
  if (!values.length) return 0;
  const result = await db.from(table).select("id", { count: "exact", head: true }).in(column, values);
  expect(result.error, `${table}: ${result.error?.message || ""}`).toBeNull();
  return Number(result.count || 0);
}

export async function safeDelete(db: SupabaseAny, table: string, column: string, ids: string[]) {
  const values = unique(ids);
  if (!values.length) return;
  const result = await db.from(table).delete().in(column, values);
  if (result.error && !/does not exist|schema cache|could not find/i.test(result.error.message)) {
    throw new Error(`${table}: ${result.error.message}`);
  }
}

export function unique(values: string[]) {
  return [...new Set(values.map(String).filter(Boolean))];
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function omitKey(row: Record<string, unknown>, key: string) {
  const next = { ...row };
  delete next[key];
  return next;
}
