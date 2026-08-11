import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const managerModules = [
  "customers", "properties", "quotes", "jobs", "schedule", "dispatch", "routes",
  "employees", "tasks", "feedback", "reports", "finance", "settings",
] as const;
const accessLevelSchema = z.enum(["none", "view", "read", "manage"]);
const managerPermissionsSchema = z.object(Object.fromEntries(
  managerModules.map(module => [module, accessLevelSchema.optional()]),
) as Record<(typeof managerModules)[number], z.ZodOptional<typeof accessLevelSchema>>).partial();

const userCreateSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).nullable().optional(),
  role: z.enum(["manager", "employee", "customer"]).default("employee"),
  managerPermissions: managerPermissionsSchema.optional().default({}),
  addressLine1: z.string().trim().max(240).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  province: z.string().trim().max(40).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  routeStartAddress: z.string().trim().max(400).nullable().optional(),
  avatarUrl: z.string().trim().url().nullable().optional(),
  dailyRouteCapacity: z.number().int().min(1).default(16),
  active: z.boolean().optional(),
});

const userPatchSchema = userCreateSchema.partial().extend({
  id: z.string().uuid(),
});

type UserCreateInput = z.infer<typeof userCreateSchema>;

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Real user administration is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function companyAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");
  const client = serverClient();
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user) throw new Error("Your login expired. Sign in again.");
  const { data: profile, error } = await client.from("profiles").select("id,role,company_id,organization_id,active").eq("id", auth.user.id).single();
  if (error || !profile?.active || profile.role !== "admin") throw new Error("Only the company Admin can manage users.");
  const companyId = profile.company_id || profile.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return { client, companyId };
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "User operation failed." }, { status });
}

function missingCapacity(message?: string) {
  return /daily_route_capacity/i.test(message || "") && /(column|schema cache|does not exist)/i.test(message || "");
}

function toStoredManagerPermissions(permissions: Record<string, unknown> = {}) {
  return Object.fromEntries(managerModules.map(module => {
    const value = permissions[module];
    return [module, value === "view" ? "read" : value === "manage" || value === "read" ? value : "none"];
  }));
}

function toPublicManagerPermissions(permissions: Record<string, unknown> = {}) {
  return Object.fromEntries(managerModules.map(module => {
    const value = permissions[module];
    return [module, value === "read" ? "view" : value === "manage" || value === "view" ? value : "none"];
  }));
}

function publicUser(user: any) {
  return {
    ...user,
    manager_permissions: user.role === "manager" ? toPublicManagerPermissions(user.manager_permissions || {}) : {},
  };
}

function employeePayload(body: Partial<UserCreateInput>) {
  return {
    ...(body.fullName !== undefined ? { full_name: body.fullName } : {}),
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
    ...(body.avatarUrl !== undefined ? { avatar_url: body.avatarUrl || null } : {}),
    ...(body.addressLine1 !== undefined ? { address_line1: body.addressLine1 || null } : {}),
    ...(body.city !== undefined ? { city: body.city || null } : {}),
    ...(body.province !== undefined ? { province: body.province || "ON" } : {}),
    ...(body.postalCode !== undefined ? { postal_code: body.postalCode || null } : {}),
    ...(body.routeStartAddress !== undefined || body.addressLine1 !== undefined ? { route_start_address: body.routeStartAddress || body.addressLine1 || null } : {}),
    ...(body.dailyRouteCapacity !== undefined ? { daily_route_capacity: body.dailyRouteCapacity } : {}),
    ...(typeof body.active === "boolean" ? { active: body.active } : {}),
  };
}

function profilePayload(body: Partial<UserCreateInput>) {
  return {
    ...(body.fullName !== undefined ? { full_name: body.fullName } : {}),
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
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

const baseColumns = "id,full_name,email,phone,role,active,created_at,avatar_url,address_line1,city,province,postal_code,route_start_address,invite_status,manager_permissions";

async function listEmployees(client: any, companyId: string) {
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
  return (result.data || []).map((item: any) => publicUser({ ...item, daily_route_capacity: Math.max(1, Number(item.daily_route_capacity || 16)) }));
}

async function listWorkspaceUsers(client: any, companyId: string) {
  const result = await client.from("profiles")
    .select(baseColumns)
    .in("role", ["admin", "manager", "employee", "customer"])
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    .order("created_at", { ascending: false });
  if (result.error) throw new Error(result.error.message);
  return (result.data || []).map(publicUser);
}

async function listCrews(client: any, companyId: string) {
  const result = await client.from("crews")
    .select("id,name")
    .eq("active", true)
    .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
    .order("name", { ascending: true });
  if (result.error) throw new Error(result.error.message);
  return result.data || [];
}

export async function GET(request: NextRequest) {
  try {
    const { client, companyId } = await companyAdmin(request);
    const scope = request.nextUrl.searchParams.get("scope") || "employees";
    const users = scope === "workspace"
      ? await listWorkspaceUsers(client, companyId)
      : await listEmployees(client, companyId);
    const crews = scope === "workspace" ? await listCrews(client, companyId) : [];
    return NextResponse.json({ users, crews });
  } catch (error) {
    return failure(error, 401);
  }
}

export async function POST(request: NextRequest) {
  let createdUserId = "";
  let createdCrewId = "";
  try {
    const { client, companyId } = await companyAdmin(request);
    const body = userCreateSchema.parse(await request.json());
    const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
    const { data: invite, error: inviteError } = await client.auth.admin.inviteUserByEmail(body.email, {
      redirectTo: `${siteUrl}/auth/complete?role=${body.role}`,
      data: { full_name: body.fullName, role: body.role, company_id: companyId },
    });
    if (inviteError || !invite.user) throw new Error(inviteError?.message || "The user invitation could not be created.");
    createdUserId = invite.user.id;

    const profile = {
      id: createdUserId,
      organization_id: companyId,
      company_id: companyId,
      role: body.role,
      ...profilePayload(body),
      manager_permissions: body.role === "manager" ? toStoredManagerPermissions(body.managerPermissions) : {},
      active: true,
      invite_status: "sent",
    };
    const profileResult = await client.from("profiles").upsert(profile, { onConflict: "id" });
    if (profileResult.error) throw new Error(profileResult.error.message);

    if (body.role === "employee") {
      const crewResult = await client.from("crews")
        .insert({ organization_id: companyId, company_id: companyId, name: body.fullName, active: true })
        .select("id")
        .single();
      if (crewResult.error || !crewResult.data?.id) throw new Error(crewResult.error?.message || "The Employee Crew could not be created.");
      createdCrewId = String(crewResult.data.id);
      const employee = {
        organization_id: companyId,
        company_id: companyId,
        profile_id: createdUserId,
        crew_id: createdCrewId,
        ...employeePayload(body),
        full_name: body.fullName,
        email: body.email,
        active: true,
        invite_status: "sent",
      };
      const employeeResult = await writeWithCapacityFallback(includeCapacity =>
        client.from("employees").insert(includeCapacity ? employee : withoutCapacity(employee)));
      if (employeeResult.error) throw new Error(employeeResult.error.message);
    }

    return NextResponse.json({ user: publicUser(profile), message: `Invitation sent to ${body.email}.` }, { status: 201 });
  } catch (error) {
    if (createdCrewId) {
      try { await serverClient().from("crews").delete().eq("id", createdCrewId); } catch { /* best effort rollback */ }
    }
    if (createdUserId) try { await serverClient().auth.admin.deleteUser(createdUserId); } catch { /* best effort rollback */ }
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { client, companyId } = await companyAdmin(request);
    const body = userPatchSchema.parse(await request.json());
    const { data: current, error: currentError } = await client.from("profiles")
      .select(`${baseColumns},daily_route_capacity`)
      .eq("id", body.id)
      .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
      .single();
    if (currentError || !current) throw new Error("User not found in this company.");
    if (current.role === "admin") throw new Error("Company Admin access cannot be changed from this screen.");

    const updates = {
      ...profilePayload(body),
      ...(current.role === "manager" && body.managerPermissions !== undefined ? { manager_permissions: toStoredManagerPermissions(body.managerPermissions) } : {}),
    };
    if (Object.keys(updates).length) {
      const profileResult = await client.from("profiles")
        .update(updates)
        .eq("id", body.id)
        .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`)
        .select(baseColumns)
        .single();
      if (profileResult.error || !profileResult.data) throw new Error(profileResult.error?.message || "User profile could not be saved.");
      Object.assign(current, profileResult.data);
    }

    if (current.role === "employee") {
      const employeeUpdates = employeePayload(body);
      if (Object.keys(employeeUpdates).length) {
        const employeeResult = await writeWithCapacityFallback(includeCapacity =>
          client.from("employees")
            .update(includeCapacity ? employeeUpdates : withoutCapacity(employeeUpdates))
            .eq("profile_id", body.id)
            .or(`company_id.eq.${companyId},organization_id.eq.${companyId}`));
        if (employeeResult.error) throw new Error(employeeResult.error.message);
      }
    }

    if (body.email || body.fullName) {
      const { error: authError } = await client.auth.admin.updateUserById(body.id, {
        ...(body.email ? { email: body.email } : {}),
        user_metadata: {
          full_name: body.fullName || current.full_name,
          role: current.role,
          company_id: companyId,
        },
      });
      if (authError) throw new Error(authError.message);
    }

    return NextResponse.json({ user: publicUser(current), message: `Profile saved for ${current.full_name}.` });
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