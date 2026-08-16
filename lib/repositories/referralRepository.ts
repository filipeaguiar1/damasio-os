import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CompanyReferral = {
  id: string;
  fullName: string;
  email?: string;
  phone?: string;
  address?: string;
  serviceRequested?: string;
  notes?: string;
  status: string;
  createdAt?: string;
};

export type CompanyReferralDecisionResult = {
  referrals: CompanyReferral[];
  accepted: boolean;
  inviteSent: boolean;
  accessMethod: string;
  accessWarning: string | null;
  message: string;
};

export async function listCompanyReferrals(): Promise<CompanyReferral[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_company_referral_inbox" as never);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as CompanyReferral[] : [];
}

export async function respondCompanyReferral(id: string, accept: boolean): Promise<CompanyReferralDecisionResult> {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your company session expired. Sign in again.");

  const response = await fetch(`/api/admin/referrals/${encodeURIComponent(id)}/respond`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ accept }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Referral response failed.");

  return {
    referrals: Array.isArray(payload.referrals) ? payload.referrals as CompanyReferral[] : [],
    accepted: Boolean(payload.accepted),
    inviteSent: Boolean(payload.inviteSent),
    accessMethod: String(payload.accessMethod || "none"),
    accessWarning: payload.accessWarning ? String(payload.accessWarning) : null,
    message: String(payload.message || (accept ? "Referral accepted." : "Referral declined.")),
  };
}
