import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export type CustomerPortalIdentity = {
  profileId: string;
  customerId: string;
  companyId: string | null;
};

type CustomerRow = {
  id: string;
  profile_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  company_id: string | null;
  organization_id: string | null;
  service_payment_method?: string | null;
  tip_payment_method?: string | null;
};

function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error("Customer portal authentication is not configured.");
  return { url, anonKey, serviceKey };
}

export function customerPortalServiceClient() {
  const { url, serviceKey } = supabaseConfig();
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

export async function requireCustomerPortalIdentity(
  request: NextRequest,
  options: { allowUnlinked?: boolean } = {},
) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the Customer to continue.");

  const { url, anonKey } = supabaseConfig();
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as any;
  const service = customerPortalServiceClient();

  const auth = await userClient.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your customer session expired. Sign in again.");

  const profile = await service.from("profiles")
    .select("id,role,active,company_id,organization_id,email")
    .eq("id", auth.data.user.id)
    .maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data?.active || profile.data.role !== "customer") {
    throw new Error("Only an active Customer account can use this portal.");
  }

  // Identity linkage is decided by the authenticated, tenant-aware database RPC.
  // Never trust user_metadata.customer_id/company_id as authorization input.
  const linked = await userClient.rpc("link_current_customer_account");
  if (linked.error) throw new Error(linked.error.message);
  const customerId = linked.data ? String(linked.data) : "";
  const profileCompanyId = profile.data.company_id || profile.data.organization_id || null;

  if (!customerId) {
    if (options.allowUnlinked) {
      return {
        service,
        user: auth.data.user,
        profile: profile.data,
        customer: null as CustomerRow | null,
        identity: {
          profileId: String(auth.data.user.id),
          customerId: "",
          companyId: profileCompanyId ? String(profileCompanyId) : null,
        } satisfies CustomerPortalIdentity,
      };
    }
    throw new Error("Customer account is not linked yet.");
  }

  const customerResult = await service.from("customers")
    .select("id,profile_id,email,full_name,phone,company_id,organization_id,service_payment_method,tip_payment_method")
    .eq("id", customerId)
    .is("archived_at", null)
    .maybeSingle();
  if (customerResult.error) throw new Error(customerResult.error.message);
  if (!customerResult.data) throw new Error("Customer record was not found for this account.");

  const customer = customerResult.data as CustomerRow;
  if (String(customer.profile_id || "") !== String(auth.data.user.id)) {
    throw new Error("Customer record is linked to a different account.");
  }

  const customerCompanyId = customer.company_id || customer.organization_id || null;
  if (profileCompanyId && customerCompanyId && String(profileCompanyId) !== String(customerCompanyId)) {
    throw new Error("Customer company identity does not match the signed-in account.");
  }

  return {
    service,
    user: auth.data.user,
    profile: profile.data,
    customer,
    identity: {
      profileId: String(auth.data.user.id),
      customerId: String(customer.id),
      companyId: customerCompanyId
        ? String(customerCompanyId)
        : profileCompanyId
          ? String(profileCompanyId)
          : null,
    } satisfies CustomerPortalIdentity,
  };
}
