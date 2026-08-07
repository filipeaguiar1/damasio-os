import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const employeeSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).nullable().optional(),
  addressLine1: z.string().trim().max(240).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  province: z.string().trim().max(40).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  routeStartAddress: z.string().trim().max(400).nullable().optional(),
  avatarUrl: z.string().trim().url().nullable().optional(),
  dailyRouteCapacity: z.number().int().min(1).default(16),
  active: z.boolean().optional(),
});

type EmployeeInput = z.infer<typeof employeeSchema>;

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Real employee administration is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function companyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,company_id,organization_id,active").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only the company Admin can manage employees.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { client, companyId };
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Employee operation failed." }, { status });
}

function missingCapacity(message?: string) {
  return /daily_route_capacity/i.test(message || "") && /(column|schema cache|does not exist)/i.test(message || "");
}

function employeePayload(body: EmployeeInput) {
  return {
    full_name: body.fullName,
    email: body.email,
    phone: body.phone || null,
    avatar_url: body.avatarUrl || null,
    address_line1: body.addressLine1 || null,
    city: body.city || null,
    province: body.province || "ON",
    postal_code: body.postalCode || null,
    route_start_address: body.routeStartAddress || body.addressLine1 || null,
    daily_route_capacity: body.dailyRouteCapacity,
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
  };
}

function withoutCapacity<T extends Record<string, unknown>>(value: T) {
  const { daily_route_capacity: _ignored, ...rest } = value;
  return rest;
}

async function writeWithCapacityFallback(run: (includeCapacity: boolean) => PromiseLike<{ error?: { message?: string } | null }>) {
  const first = await run(true);
  if (first.error && missingCapacity(first.error.message)) return await run(false);
  return first;
}

const baseColumns = "id,full_name,email,phone,active,created_at,avatar_url,address_line1,city,province,postal_code,route_start_address,invite_status";

export async function GET(request: NextRequest) {
  try {
    const { client, companyId } = await companyAdmin(request);
    let result = await client.from("profiles")
      .select(`${baseColumns},daily_route_capacity`)
      .eq("role", "employee")
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
      .order("created_at", { ascending: false });
    if (result.error && missingCapacity(result.error.message)) {
      result = await client.from("profiles")
        .select(baseColumns)
        .eq("role", "employee")
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
        .order("created_at", { ascending: false });
    }
    if (result.error) throw new Error(result.error.message);
    const users = (result.data || []).map((item: any) => ({ ...item, daily_route_capacity: Math.max(1, Number(item.daily_route_capacity || 16)) }));
    return NextResponse.json({ users });
  } catch (error) {
    return failure(error, 401);
  }
}

export async function POST(request: NextRequest) {
  let createdUserId = "";
  try {
    const { client, companyId } = await companyAdmin(request);
    const body = employeeSchema.parse(await request.json());
    const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
    const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(body.email, {
      redirectTo: `${siteUrl}/auth/complete?role=employee`,
      data: { full_name: body.fullName, role: "employee", company_id: companyId },
    });
    if (inviteError || !invite.user) throw new Error(inviteError?.message || "The employee invitation could not be created.");
    createdUserId = invite.user.id;
    const base = employeePayload(body);
    const profile = { id: createdUserId, organization_id: companyId, company_id: companyId, role: "employee", ...base, active: true, invite_status: "sent" };
    const profileResult = await writeWithCapacityFallback(includeCapacity =>
      client.from("profiles").upsert(includeCapacity ? profile : withoutCapacity(profile), { onConflict: "id" }));
    if (profileResult.error) throw new Error(profileResult.error.message);
    const employee = { organization_id: companyId, company_id: companyId, profile_id: createdUserId, ...base, active: true, invite_status: "sent" };
    const employeeResult = await writeWithCapacityFallback(includeCapacity =>
      client.from("employees").insert(includeCapacity ? employee : withoutCapacity(employee)));
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    return NextResponse.json({ user: { ...profile, daily_route_capacity: body.dailyRouteCapacity }, message: `Invitation sent to ${body.email}.` }, { status: 201 });
  } catch (error) {
    if (createdUserId) try { await serverClient().auth.admin.deleteUser(createdUserId); } catch { /* best effort rollback */ }
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { client, companyId } = await companyAdmin(request);
    const raw = await request.json();
    const id = String(raw.id || "");
    if (!id) throw new Error("Choose an employee.");
    const body = employeeSchema.parse(raw);
    const updates = employeePayload(body);
    let data: any = null;
    const profileResult = await writeWithCapacityFallback(async includeCapacity => {
      const result = await client.from("profiles")
        .update(includeCapacity ? updates : withoutCapacity(updates))
        .eq("id", id)
        .eq("role", "employee")
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
        .select(includeCapacity ? `${baseColumns},daily_route_capacity` : baseColumns)
        .single();
      data = result.data;
      return result;
    });
    if (profileResult.error || !data) throw new Error(profileResult.error?.message || "Employee not found in this company.");
    const employeeResult = await writeWithCapacityFallback(includeCapacity =>
      client.from("employees")
        .update(includeCapacity ? updates : withoutCapacity(updates))
        .eq("profile_id", id)
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`));
    if (employeeResult.error) throw new Error(employeeResult.error.message);
    const { error: authError } = await client.auth.admin.updateUserById(id, {
      email: body.email,
      user_metadata: { full_name: body.fullName, role: "employee", company_id: companyId },
    });
    if (authError) throw new Error(authError.message);
    return NextResponse.json({ user: { ...data, daily_route_capacity: body.dailyRouteCapacity }, message: `Profile saved for ${data.full_name}.` });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { client, companyId } = await companyAdmin(request);
    const body = await request.json() as { id?: string };
    const id = String(body.id || "");
    if (!id) throw new Error("Choose an employee.");
    const { data: profile, error } = await client.from("profiles").select("id,full_name").eq("id", id).eq("role", "employee").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).single();
    if (error || !profile) throw new Error("Employee not found in this company.");
    const employeeResult = await client.from("employees")
      .update({ active: false, profile_id: null })
      .eq("profile_id", id)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
    if (employeeResult.error) throw new Error(`Employee record could not be deactivated: ${employeeResult.error.message}`);
    const { error: authError } = await client.auth.admin.deleteUser(id);
    if (authError && !authError.message.toLowerCase().includes("not found")) throw new Error(authError.message);
    return NextResponse.json({ id, message: `${profile.full_name} was removed. Historical visits remain preserved.` });
  } catch (error) {
    return failure(error);
  }
}
