import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerPortalIdentity, type CustomerPortalIdentity } from "@/lib/auth/customerPortalIdentity";

export const dynamic = "force-dynamic";

const schema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().default(""),
}).strict();

function authorizedAvatarPath(user: any, identity: CustomerPortalIdentity) {
  if (!identity.companyId || !identity.customerId) return "";
  const candidate = typeof user.user_metadata?.customer_avatar_path === "string"
    ? user.user_metadata.customer_avatar_path
    : "";
  const prefix = `${identity.companyId}/${identity.customerId}/customer-avatar.`;
  if (!candidate.startsWith(prefix)) return "";
  const suffix = candidate.slice(prefix.length).toLowerCase();
  return /^(avif|heic|heif|jpe?g|png|webp)$/.test(suffix) ? candidate : "";
}

async function responseProfile(client: any, customer: any, user: any, identity: CustomerPortalIdentity) {
  const avatarPath = authorizedAvatarPath(user, identity);
  let avatarUrl: string | null = null;
  if (avatarPath) {
    const { data } = await client.storage.from("property-photos").createSignedUrl(avatarPath, 3600);
    avatarUrl = data?.signedUrl || null;
  }
  return {
    id: customer.id,
    fullName: customer.full_name || "",
    phone: customer.phone || "",
    email: customer.email || user.email || "",
    avatarUrl,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { service, customer, user, identity } = await requireCustomerPortalIdentity(request);
    return NextResponse.json({ profile: await responseProfile(service, customer, user, identity) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer profile could not be loaded.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { service, identity, user } = await requireCustomerPortalIdentity(request);
    let query = service
      .from("customers")
      .update({ full_name: body.fullName, phone: body.phone || null, updated_at: new Date().toISOString() })
      .eq("id", identity.customerId)
      .eq("profile_id", identity.profileId);
    if (identity.companyId) {
      query = query.or(`company_id.eq.${identity.companyId},organization_id.eq.${identity.companyId}`);
    }
    const { data, error } = await query
      .select("id,full_name,phone,email,company_id,organization_id")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ saved: true, profile: await responseProfile(service, data, user, identity) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Customer profile could not be saved.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|only an active/i.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
