import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CLEANUP_BATCH_SIZE = 4;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Operational simulator cleanup is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function simulationPattern(companyId: string) {
  return `ops-sim-${companyId.slice(0, 8)}-%@4everseasons.test`;
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");

  const profile = await service.from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.active || profile.data.role !== "admin") {
    throw new Error("Only an active company Admin can clean operational simulation Visits.");
  }

  const companyId = String(profile.data.company_id || profile.data.organization_id || "");
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { service, companyId };
}

async function cleanupCustomerBatch(service: any, companyId: string, customerIds: string[]): Promise<number> {
  const cleanup = await service.rpc("cleanup_operational_simulation_visits", {
    p_company_id: companyId,
    p_customer_ids: customerIds,
  });
  if (!cleanup.error) return Number(cleanup.data?.visitCount || 0);

  if (/statement timeout/i.test(cleanup.error.message || "") && customerIds.length > 1) {
    const midpoint = Math.ceil(customerIds.length / 2);
    const left = await cleanupCustomerBatch(service, companyId, customerIds.slice(0, midpoint));
    const right = await cleanupCustomerBatch(service, companyId, customerIds.slice(midpoint));
    return left + right;
  }

  throw new Error(cleanup.error.message);
}

export async function POST(request: NextRequest) {
  try {
    const { service, companyId } = await requireAdmin(request);
    const customers = await service.from("customers")
      .select("id")
      .or(companyFilter(companyId))
      .like("email", simulationPattern(companyId));
    if (customers.error) throw new Error(customers.error.message);

    const customerIds: string[] = [...new Set<string>(
      (customers.data || []).map((row: any) => String(row.id)).filter(Boolean),
    )];
    if (!customerIds.length) {
      return NextResponse.json({ cleaned: true, customerCount: 0, visitCount: 0, batchCount: 0 });
    }

    let visitCount = 0;
    const customerBatches = chunks<string>(customerIds, CLEANUP_BATCH_SIZE);
    for (const batch of customerBatches) {
      visitCount += await cleanupCustomerBatch(service, companyId, batch);
    }

    return NextResponse.json({
      cleaned: true,
      customerCount: customerIds.length,
      visitCount,
      batchCount: customerBatches.length,
    });
  } catch (error) {
    console.error("admin-operational-simulator-cleanup-visits", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operational simulation Visit cleanup failed." }, { status: 400 });
  }
}