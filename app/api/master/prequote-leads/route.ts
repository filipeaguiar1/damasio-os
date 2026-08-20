import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master lead access is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your Master login expired.");
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can view pre-quote leads.");
  return client;
}

function safeSearch(value: string) {
  return value.trim().slice(0, 80).replace(/[,()%]/g, " ").replace(/\s+/g, " ");
}

function parseDetails(notes?: string | null) {
  const source = String(notes || "");
  const estimateMatch = source.match(/Average estimate shown:\s*\$([0-9]+(?:\.[0-9]{1,2})?)/i);
  const marker = "PROPERTY_DETAILS:";
  let propertyDetails: Record<string, unknown> | null = null;
  const markerIndex = source.indexOf(marker);
  if (markerIndex >= 0) {
    const raw = source.slice(markerIndex + marker.length).split(" | ")[0];
    try { propertyDetails = JSON.parse(raw); } catch { propertyDetails = null; }
  }
  const publicNotes = source
    .split(" | ")
    .filter(part => !part.startsWith("PREQUOTE_TOKEN:") && !part.startsWith("PREQUOTE_LEAD:") && !part.startsWith("PROPERTY_DETAILS:"))
    .join(" | ") || null;
  return {
    estimatedTotal: estimateMatch ? Number(estimateMatch[1]) : null,
    propertyDetails,
    publicNotes,
  };
}

function cityFromAddress(address?: string | null) {
  const parts = String(address || "").split(",").map(part => part.trim()).filter(Boolean);
  return parts.length >= 3 ? parts[parts.length - 3] : parts.length >= 2 ? parts[parts.length - 2] : "";
}

export async function GET(request: NextRequest) {
  try {
    const client = await requireMaster(request);
    const page = Math.max(1, Math.min(10000, Number(request.nextUrl.searchParams.get("page") || 1) || 1));
    const pageSize = Math.max(10, Math.min(50, Number(request.nextUrl.searchParams.get("pageSize") || 25) || 25));
    const search = safeSearch(request.nextUrl.searchParams.get("search") || "");
    const status = String(request.nextUrl.searchParams.get("status") || "all");
    const allowedStatuses = new Set(["all", "new", "offered", "converted", "lost"]);

    let query = client.from("lead_center")
      .select("id,full_name,email,phone,address,service_requested,notes,status,assigned_company_id,created_at,updated_at", { count: "exact" })
      .ilike("notes", "%PREQUOTE_LEAD:%")
      .order("created_at", { ascending: false });

    if (allowedStatuses.has(status) && status !== "all") query = query.eq("status", status);
    if (search) {
      const value = `*${search}*`;
      query = query.or(`full_name.ilike.${value},email.ilike.${value},phone.ilike.${value},address.ilike.${value},service_requested.ilike.${value}`);
    }

    const from = (page - 1) * pageSize;
    const { data, error, count } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);

    const rows = (data || []).map((row: any) => {
      const details = parseDetails(row.notes);
      return {
        id: row.id,
        fullName: row.full_name || "Lead",
        email: row.email || null,
        phone: row.phone || null,
        address: row.address || null,
        city: cityFromAddress(row.address),
        service: row.service_requested || "Property service",
        status: row.status || "new",
        assignedCompanyId: row.assigned_company_id || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        estimatedTotal: details.estimatedTotal,
        propertyDetails: details.propertyDetails,
        notes: details.publicNotes,
      };
    });

    return NextResponse.json({ rows, page, pageSize, total: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pre-quote leads could not be loaded." }, { status: 401 });
  }
}
