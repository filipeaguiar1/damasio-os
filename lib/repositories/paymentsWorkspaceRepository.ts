import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PaymentsCustomer = {
  id: string;
  name: string;
  email: string | null;
  origin: "platform" | "company_referral" | "company_created";
  originCompanyId: string | null;
  serviceCompanyId: string | null;
  assignmentStatus: string;
};

export type PaymentsJob = {
  id: string;
  customerId: string;
  propertyId: string | null;
  serviceName: string;
  nextVisitDate: string | null;
  active: boolean;
};

export type PaymentsAgreement = {
  id: string;
  jobId: string;
  customerId: string;
  customerOrigin: "platform" | "company";
  ownerRole: "master" | "company";
  billingModel: string;
  collectionTiming: string;
  serviceFrequency: string;
  customerAmountCents: number | null;
  providerPayoutCents: number | null;
  platformFeeBasisPoints: number | null;
  contractStartsOn: string | null;
  contractEndsOn: string | null;
  feedbackWindowHours: number;
  prepaidPlanType: string | null;
  active: boolean;
};

export type PaymentsEvent = {
  id: string;
  visitId: string;
  customerId: string;
  state: string;
  feedbackDeadlineAt: string | null;
  chargedAt: string | null;
  transferredAt: string | null;
};

export type PaymentsWorkspace = {
  customers: PaymentsCustomer[];
  jobs: PaymentsJob[];
  agreements: PaymentsAgreement[];
  events: PaymentsEvent[];
};

const emptyWorkspace: PaymentsWorkspace = { customers: [], jobs: [], agreements: [], events: [] };

export async function getPaymentsWorkspace(scope: "master" | "company") {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_payments_contract_workspace" as never, { p_scope: scope } as never);
  if (error) throw new Error(error.message);
  const value = (data || {}) as Partial<PaymentsWorkspace>;
  return {
    customers: Array.isArray(value.customers) ? value.customers : [],
    jobs: Array.isArray(value.jobs) ? value.jobs : [],
    agreements: Array.isArray(value.agreements) ? value.agreements : [],
    events: Array.isArray(value.events) ? value.events : [],
  } satisfies PaymentsWorkspace;
}

export type SaveAgreementInput = {
  jobId: string;
  billingModel: string;
  collectionTiming: string;
  serviceFrequency: string;
  customerAmountCents: number;
  providerPayoutCents?: number | null;
  platformFeeBasisPoints?: number | null;
  contractStartsOn: string;
  contractEndsOn?: string | null;
  feedbackWindowHours: number;
  prepaidPlanType?: string | null;
  planBillingDay?: number;
  serviceStartDay?: number | null;
};

export async function saveAgreement(input: SaveAgreementInput) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("save_customer_billing_agreement" as never, {
    p_job_id: input.jobId,
    p_billing_model: input.billingModel,
    p_collection_timing: input.collectionTiming,
    p_service_frequency: input.serviceFrequency,
    p_customer_amount_cents: input.customerAmountCents,
    p_provider_payout_cents: input.providerPayoutCents ?? null,
    p_platform_fee_basis_points: input.platformFeeBasisPoints ?? null,
    p_contract_starts_on: input.contractStartsOn,
    p_contract_ends_on: input.contractEndsOn || null,
    p_feedback_window_hours: input.feedbackWindowHours,
    p_prepaid_plan_type: input.prepaidPlanType || null,
    p_plan_billing_day: input.planBillingDay ?? 1,
    p_service_start_day: input.serviceStartDay ?? null,
    p_custom_frequency_interval: null,
    p_custom_frequency_unit: null,
  } as never);
  if (error) throw new Error(error.message);
  return String(data);
}

export async function syncAgreementToStripe(agreementId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before syncing the agreement with Stripe.");

  const response = await fetch("/api/stripe/agreements/sync", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ agreementId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Agreement could not be synced with Stripe.");
  return result as { synced: boolean; productId: string; priceId: string };
}

function defaultHorizon() {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString().slice(0, 10);
}

export async function generateAgreementVisits(agreementId: string, horizon?: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("generate_agreement_visits" as never, {
    p_agreement_id: agreementId,
    p_horizon: horizon || defaultHorizon(),
  } as never);
  if (error) throw new Error(error.message);
  return Number(data || 0);
}

export { emptyWorkspace };
