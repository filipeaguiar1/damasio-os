import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Visit detail is not configured.");
  return { url, anonKey, serviceKey };
}

async function requireOperator(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in first.");
  const { url, anonKey, serviceKey } = env();
  const authClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your session expired. Sign in again.");
  const { data: profile, error: profileError } = await authClient
    .from("profiles")
    .select("id,role,active,company_id,organization_id")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profileError || !profile?.active || !["admin", "manager", "master"].includes(String(profile.role))) {
    throw new Error("This Visit is not available to your account.");
  }
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  return { service, profile };
}

function companyId(row: any) {
  return String(row?.company_id || row?.organization_id || "");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
}

export async function GET(request: NextRequest) {
  try {
    const { service, profile } = await requireOperator(request);
    const visitId = String(request.nextUrl.searchParams.get("visitId") || "").trim();
    if (!isUuid(visitId)) throw new Error("Choose a valid Visit.");

    const visitResult = await service
      .from("visits")
      .select("id,company_id,organization_id,job_id,route_id,customer_id,property_id,crew_id,assigned_employee_id,scheduled_date,status,started_at,finished_at,duration_seconds,employee_notes,customer_visible_summary,route_order,payment_hold,payment_release_status,payment_release_reason,created_at,updated_at")
      .eq("id", visitId)
      .maybeSingle();
    if (visitResult.error) throw new Error(visitResult.error.message);
    const visit = visitResult.data;
    if (!visit) throw new Error("Visit not found.");

    const visitCompanyId = companyId(visit);
    const actorCompanyId = String(profile.company_id || profile.organization_id || "");
    if (String(profile.role) !== "master" && (!actorCompanyId || actorCompanyId !== visitCompanyId)) {
      throw new Error("This Visit belongs to another company.");
    }

    const [customerResult, propertyResult, jobResult, photosResult, feedbackResult, tasksResult, organizationResult] = await Promise.all([
      visit.customer_id ? service.from("customers").select("id,full_name,email,phone,notes").eq("id", visit.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      visit.property_id ? service.from("properties").select("id,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes,customer_comment,official_photo_url").eq("id", visit.property_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      visit.job_id ? service.from("jobs").select("id,service_name,frequency,service_frequency,next_visit_date,active").eq("id", visit.job_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      service.from("photos").select("id,storage_bucket,storage_path,public_url,photo_type,caption,created_at,sort_order,is_profile,visit_id,property_id").or(`visit_id.eq.${visitId}${visit.property_id ? `,property_id.eq.${visit.property_id}` : ""}`).order("created_at", { ascending: true }),
      service.from("feedback").select("id,rating,comment,created_at,task_id").eq("visit_id", visitId).order("created_at", { ascending: false }),
      service.from("tasks").select("id,title,customer_issue,priority,status,scheduled_date,completion_summary,created_at,resolved_at").eq("source_visit_id", visitId).order("created_at", { ascending: false }),
      visitCompanyId ? service.from("organizations").select("id,name").eq("id", visitCompanyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);

    const fatal = [customerResult, propertyResult, jobResult, photosResult, feedbackResult, tasksResult, organizationResult].find((result: any) => result?.error);
    if (fatal?.error) throw new Error(fatal.error.message);

    const photos = await Promise.all((photosResult.data || []).map(async (photo: any) => {
      if (photo.public_url) return { ...photo, url: photo.public_url };
      const bucket = String(photo.storage_bucket || "work-photos");
      const path = String(photo.storage_path || "");
      if (!path) return { ...photo, url: null };
      const signed = await service.storage.from(bucket).createSignedUrl(path, 900);
      return { ...photo, url: signed.data?.signedUrl || null };
    }));

    return NextResponse.json({
      visit,
      customer: customerResult.data || null,
      property: propertyResult.data || null,
      job: jobResult.data || null,
      company: organizationResult.data || null,
      photos,
      feedback: feedbackResult.data || [],
      tasks: tasksResult.data || [],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Visit detail could not be loaded." }, { status: 400 });
  }
}
