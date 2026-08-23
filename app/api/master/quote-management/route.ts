import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type QuoteStage = "prequote" | "submitted";
type QuoteLead = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  service_requested?: string | null;
  notes?: string | null;
  status?: string | null;
  created_at?: string | null;
};

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master quote management is not configured on the server.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await client.from("profiles")
    .select("id,role,active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Master profile verification failed: ${profileError.message}`);
  if (!profile?.active || profile.role !== "master") throw new Error("Only an active Master can manage quote records.");
  return { client, masterId: auth.user.id };
}

function quoteStage(row: QuoteLead): QuoteStage | null {
  const notes = String(row.notes || "");
  const status = String(row.status || "");
  if (notes.includes("QUOTE_STAGE:prequote") && status !== "converted") return "prequote";
  const submitted = notes.includes("QUOTE_STAGE:submitted") || (!notes.includes("QUOTE_STAGE:prequote") && notes.includes("Average estimate shown:"));
  return submitted ? "submitted" : null;
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Quote operation failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { client } = await requireMaster(request);
    const { data, error } = await client.from("lead_center")
      .select("id,full_name,email,phone,address,service_requested,notes,status,created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const items = ((data || []) as QuoteLead[]).flatMap((row) => {
      const stage = quoteStage(row);
      if (!stage) return [];
      return [{
        id: row.id,
        stage,
        customer: row.full_name || "Customer",
        email: row.email || "",
        phone: row.phone || "",
        address: row.address || "",
        service: row.service_requested || "Property service",
        status: row.status || "new",
        createdAt: row.created_at || "",
      }];
    });

    return NextResponse.json({ items });
  } catch (error) {
    return failure(error, 401);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 100)
      : [];
    if (!ids.length) throw new Error("Select at least one quote or pre-quote.");

    const { data: rows, error: readError } = await client.from("lead_center")
      .select("id,full_name,email,service_requested,notes,status,created_at")
      .in("id", ids);
    if (readError) throw new Error(readError.message);

    const records = (rows || []) as QuoteLead[];
    if (records.length !== ids.length) throw new Error("One or more selected quote records no longer exist.");
    const invalid = records.filter((row) => !quoteStage(row));
    if (invalid.length) throw new Error("Only records shown in Master Quote Review can be removed here.");
    const converted = records.filter((row) => row.status === "converted");
    if (converted.length) {
      return NextResponse.json({ error: "A converted quote is already linked to downstream customer data and cannot be removed from Quote Review." }, { status: 409 });
    }

    const { data: removed, error: deleteError } = await client.from("lead_center")
      .delete()
      .in("id", ids)
      .select("id");
    if (deleteError) throw new Error(deleteError.message);

    const auditRows = records.map((row) => ({
      master_profile_id: masterId,
      action: "quote.review_record_removed",
      entity_type: "lead_center",
      entity_id: row.id,
      details: {
        stage: quoteStage(row),
        customer: row.full_name || null,
        email: row.email || null,
        service: row.service_requested || null,
      },
    }));
    const { error: auditError } = await client.from("master_audit_log").insert(auditRows);
    if (auditError) console.error("Quote removal audit log could not be written", auditError.message);

    return NextResponse.json({ removed: (removed || []).length, ids: (removed || []).map((row: any) => row.id) });
  } catch (error) {
    return failure(error);
  }
}
