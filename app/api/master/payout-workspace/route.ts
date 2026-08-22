import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Master payouts are not configured.");
  return { url, anonKey, serviceKey };
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const { url, anonKey, serviceKey } = env();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master session expired.");
  const { data: profile, error: profileError } = await authClient.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can view payout operations.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function uuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

export async function GET(request: NextRequest) {
  try {
    const service = await requireMaster(request);
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get("pageSize") || 50)));
    const companyId = String(request.nextUrl.searchParams.get("companyId") || "").trim();
    const status = String(request.nextUrl.searchParams.get("status") || "all").trim();
    const search = String(request.nextUrl.searchParams.get("search") || "").trim();
    const from = String(request.nextUrl.searchParams.get("from") || "").trim();
    const to = String(request.nextUrl.searchParams.get("to") || "").trim();

    const activeResult = await service.from("company_payout_items")
      .select("id")
      .in("status", ["pending_feedback", "held_task", "eligible"])
      .limit(150);
    if (!activeResult.error) {
      for (const row of activeResult.data || []) {
        await service.rpc("refresh_payout_release_status", { p_item_id: row.id });
      }
    }

    let customerIds: string[] = [];
    let propertyIds: string[] = [];
    let companyIds: string[] = [];
    if (search) {
      const needle = `%${search.replace(/[%_]/g, "")}%`;
      const [customers, properties, companies] = await Promise.all([
        service.from("customers").select("id").or(`full_name.ilike.${needle},email.ilike.${needle},phone.ilike.${needle}`).limit(200),
        service.from("properties").select("id").or(`address_line1.ilike.${needle},city.ilike.${needle},postal_code.ilike.${needle}`).limit(200),
        service.from("organizations").select("id").ilike("name", needle).limit(100),
      ]);
      customerIds = (customers.data || []).map((row: any) => row.id);
      propertyIds = (properties.data || []).map((row: any) => row.id);
      companyIds = (companies.data || []).map((row: any) => row.id);
    }

    let query = service.from("company_payout_items")
      .select("id,company_id,batch_id,invoice_id,payment_id,job_id,visit_id,customer_id,property_id,amount_total,platform_fee,transfer_amount,status,hold_reason,eligible_at,service_completed_at,created_at,approved_at,transferred_at,cancelled_at", { count: "exact" })
      .order("service_completed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (uuid(companyId)) query = query.eq("company_id", companyId);
    if (status && status !== "all") query = query.eq("status", status);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000Z`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999Z`);
    if (search) {
      const clauses: string[] = [];
      if (customerIds.length) clauses.push(`customer_id.in.(${customerIds.join(",")})`);
      if (propertyIds.length) clauses.push(`property_id.in.(${propertyIds.join(",")})`);
      if (companyIds.length) clauses.push(`company_id.in.(${companyIds.join(",")})`);
      if (uuid(search)) clauses.push(`id.eq.${search}`, `visit_id.eq.${search}`);
      if (!clauses.length) return NextResponse.json({ rows: [], batches: [], page, pageSize, total: 0, totalPages: 1, companies: [] });
      query = query.or(clauses.join(","));
    }

    const start = (page - 1) * pageSize;
    const result = await query.range(start, start + pageSize - 1);
    if (result.error) throw new Error(result.error.message);
    const items = result.data || [];

    const unique = (key: string) => [...new Set(items.map((row: any) => String(row[key] || "")).filter(Boolean))];
    const [customers, properties, jobs, visits, organizations, batches] = await Promise.all([
      unique("customer_id").length ? service.from("customers").select("id,full_name,email,phone").in("id", unique("customer_id")) : Promise.resolve({ data: [], error: null }),
      unique("property_id").length ? service.from("properties").select("id,address_line1,city,province,postal_code").in("id", unique("property_id")) : Promise.resolve({ data: [], error: null }),
      unique("job_id").length ? service.from("jobs").select("id,service_name,service_frequency,frequency").in("id", unique("job_id")) : Promise.resolve({ data: [], error: null }),
      unique("visit_id").length ? service.from("visits").select("id,scheduled_date,status,started_at,finished_at,duration_seconds").in("id", unique("visit_id")) : Promise.resolve({ data: [], error: null }),
      service.from("organizations").select("id,name").is("deleted_at", null).order("name"),
      service.from("company_payout_batches").select("id,company_id,week_start,week_end,scheduled_payout_date,status,total_transfer_amount,approved_at,processed_at,created_at").order("week_start", { ascending: false }).limit(120),
    ]);
    const fatal = [customers, properties, jobs, visits, organizations, batches].find((entry: any) => entry.error);
    if (fatal?.error) throw new Error(fatal.error.message);

    const map = (rows: any[]) => new Map(rows.map(row => [String(row.id), row]));
    const customerMap = map(customers.data || []);
    const propertyMap = map(properties.data || []);
    const jobMap = map(jobs.data || []);
    const visitMap = map(visits.data || []);
    const companyMap = map(organizations.data || []);

    const rows = items.map((item: any) => {
      const customer = customerMap.get(String(item.customer_id || "")) || null;
      const property = propertyMap.get(String(item.property_id || "")) || null;
      const job = jobMap.get(String(item.job_id || "")) || null;
      const visit = visitMap.get(String(item.visit_id || "")) || null;
      const address = [property?.address_line1, property?.city, property?.province, property?.postal_code].filter(Boolean).join(", ");
      return {
        ...item,
        companyName: companyMap.get(String(item.company_id || ""))?.name || "Company",
        customerName: customer?.full_name || "Unknown customer",
        customerEmail: customer?.email || null,
        customerPhone: customer?.phone || null,
        address: address || "Address unavailable",
        serviceName: job?.service_name || "Service",
        serviceFrequency: job?.service_frequency || job?.frequency || null,
        visitStatus: visit?.status || null,
        scheduledDate: visit?.scheduled_date || null,
        startedAt: visit?.started_at || null,
        finishedAt: visit?.finished_at || null,
        durationSeconds: visit?.duration_seconds ?? null,
      };
    });

    return NextResponse.json({
      rows,
      batches: (batches.data || []).filter((batch: any) => !companyId || batch.company_id === companyId).map((batch: any) => ({ ...batch, companyName: companyMap.get(String(batch.company_id || ""))?.name || "Company" })),
      companies: organizations.data || [],
      page,
      pageSize,
      total: result.count || 0,
      totalPages: Math.max(1, Math.ceil((result.count || 0) / pageSize)),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Payout workspace could not be loaded." }, { status: 400 });
  }
}
