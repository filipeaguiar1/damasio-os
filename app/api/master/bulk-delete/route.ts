import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Master bulk actions are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireMaster(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as Master.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error: profileError } = await client.from("profiles").select("id,role,active").eq("id", auth.user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== "master") throw new Error("Only an active Master can delete these records.");
  return { client, masterId: auth.user.id };
}

export async function POST(request: NextRequest) {
  try {
    const { client, masterId } = await requireMaster(request);
    const body = await request.json() as { resource?: "leads" | "audit"; ids?: string[] };
    const ids = [...new Set((body.ids || []).map(String).filter(Boolean))].slice(0, 100);
    if (!ids.length) throw new Error("Select at least one record.");
    const table = body.resource === "leads" ? "lead_center" : body.resource === "audit" ? "master_audit_log" : "";
    if (!table) throw new Error("This record type cannot be deleted.");

    const { data, error } = await client.from(table).delete().in("id", ids).select("id");
    if (error) throw new Error(error.message);
    const deletedIds = (data || []).map((row: { id: string }) => row.id);

    if (body.resource === "leads") {
      await client.from("master_audit_log").insert({
        master_profile_id: masterId,
        action: "master.bulk_delete.leads",
        entity_type: "lead_center",
        details: { requested_ids: ids, deleted_ids: deletedIds },
      });
    }

    return NextResponse.json({
      deletedIds,
      message: `${deletedIds.length} selected record${deletedIds.length === 1 ? "" : "s"} deleted.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bulk delete failed.";
    return NextResponse.json({ error: message }, { status: /sign in|only an active master/i.test(message) ? 401 : 400 });
  }
}
