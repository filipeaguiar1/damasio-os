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

export type PaymentsInvoice = {
  id: string;
  customerId: string;
  number: string;
  status: string;
  serviceName: string | null;
  totalCents: number;
  createdAt: string;
  paidAt: string | null;
  stripeCheckoutSessionId: string | null;
};

export type PaymentsWorkspace = {
  customers: PaymentsCustomer[];
  jobs: PaymentsJob[];
  agreements: PaymentsAgreement[];
  events: PaymentsEvent[];
  invoices: PaymentsInvoice[];
};

const emptyWorkspace: PaymentsWorkspace = { customers: [], jobs: [], agreements: [], events: [], invoices: [] };

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function originOf(row: any): PaymentsCustomer["origin"] {
  const value = asString(row.origin || row.customerOrigin || row.acquisition_source, "company_created");
  if (value === "platform") return "platform";
  if (value === "company_referral") return "company_referral";
  return "company_created";
}

function normalizeWorkspace(value: Partial<PaymentsWorkspace> | Record<string, any>) {
  const customers = Array.isArray(value.customers) ? value.customers.map((row: any) => ({
    id: asString(row.id || row.customerId || row.customer_id),
    name: asString(row.name || row.fullName || row.full_name || row.customerName || row.customer_name, "Unnamed customer"),
    email: asNullableString(row.email || row.customerEmail || row.customer_email),
    origin: originOf(row),
    originCompanyId: asNullableString(row.originCompanyId || row.origin_company_id || row.companyId || row.company_id),
    serviceCompanyId: asNullableString(row.serviceCompanyId || row.service_company_id || row.organizationId || row.organization_id),
    assignmentStatus: asString(row.assignmentStatus || row.assignment_status, "active"),
  })).filter((customer: PaymentsCustomer) => customer.id) : [];

  const jobs = Array.isArray(value.jobs) ? value.jobs.map((row: any) => ({
    id: asString(row.id || row.jobId || row.job_id),
    customerId: asString(row.customerId || row.customer_id),
    propertyId: asNullableString(row.propertyId || row.property_id),
    serviceName: asString(row.serviceName || row.service_name || row.title, "Service"),
    nextVisitDate: asNullableString(row.nextVisitDate || row.next_visit_date || row.scheduledDate || row.scheduled_date),
    active: row.active !== false,
  })).filter((job: PaymentsJob) => job.id && job.customerId) : [];

  const agreements = Array.isArray(value.agreements) ? value.agreements.map((row: any) => ({
    id: asString(row.id || row.agreementId || row.agreement_id),
    jobId: asString(row.jobId || row.job_id),
    customerId: asString(row.customerId || row.customer_id),
    customerOrigin: asString(row.customerOrigin || row.customer_origin, "company") === "platform" ? "platform" : "company",
    ownerRole: asString(row.ownerRole || row.owner_role, "company") === "master" ? "master" : "company",
    billingModel: asString(row.billingModel || row.billing_model, "manual"),
    collectionTiming: asString(row.collectionTiming || row.collection_timing, "after_visit"),
    serviceFrequency: asString(row.serviceFrequency || row.service_frequency, "one_time"),
    customerAmountCents: row.customerAmountCents ?? row.customer_amount_cents ?? null,
    providerPayoutCents: row.providerPayoutCents ?? row.provider_payout_cents ?? null,
    platformFeeBasisPoints: row.platformFeeBasisPoints ?? row.platform_fee_basis_points ?? null,
    contractStartsOn: asNullableString(row.contractStartsOn || row.contract_starts_on),
    contractEndsOn: asNullableString(row.contractEndsOn || row.contract_ends_on),
    feedbackWindowHours: asNumber(row.feedbackWindowHours || row.feedback_window_hours, 24),
    prepaidPlanType: asNullableString(row.prepaidPlanType || row.prepaid_plan_type),
    active: row.active !== false,
  })).filter((agreement: PaymentsAgreement) => agreement.id) : [];

  const events = Array.isArray(value.events) ? value.events.map((row: any) => ({
    id: asString(row.id || row.eventId || row.event_id),
    visitId: asString(row.visitId || row.visit_id),
    customerId: asString(row.customerId || row.customer_id),
    state: asString(row.state || row.status, "pending"),
    feedbackDeadlineAt: asNullableString(row.feedbackDeadlineAt || row.feedback_deadline_at),
    chargedAt: asNullableString(row.chargedAt || row.charged_at),
    transferredAt: asNullableString(row.transferredAt || row.transferred_at),
  })).filter((event: PaymentsEvent) => event.id) : [];

  const invoices = Array.isArray(value.invoices) ? value.invoices.map((row: any) => ({
    id: asString(row.id || row.invoiceId || row.invoice_id),
    customerId: asString(row.customerId || row.customer_id),
    number: asString(row.number || row.invoiceNumber || row.invoice_number, "Invoice"),
    status: asString(row.status, "waiting_payment"),
    serviceName: asNullableString(row.serviceName || row.service_name || row.description),
    totalCents: asNumber(row.totalCents ?? row.total_cents ?? Math.round(asNumber(row.total, 0) * 100), 0),
    createdAt: asString(row.createdAt || row.created_at, new Date().toISOString()),
    paidAt: asNullableString(row.paidAt || row.paid_at),
    stripeCheckoutSessionId: asNullableString(row.stripeCheckoutSessionId || row.stripe_checkout_session_id),
  })).filter((invoice: PaymentsInvoice) => invoice.id && invoice.customerId) : [];

  return { customers, jobs, agreements, events, invoices } satisfies PaymentsWorkspace;
}

export async function getPaymentsWorkspace(scope: "master" | "company") {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_payments_contract_workspace" as never, { p_scope: scope } as never);
  if (error) throw new Error(error.message);
  return normalizeWorkspace((data || {}) as Partial<PaymentsWorkspace>);
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

export async function createPaymentRequestLink(invoiceId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before creating a payment request.");

  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ invoiceId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Payment request link could not be created.");
  if (!result.url) throw new Error("Stripe did not return a payment link.");
  return result as { url: string; reused?: boolean };
}

export async function createManualPaymentRequestLink(input: { customerId: string; amountCents: number; description?: string }) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before creating a payment request.");

  const response = await fetch("/api/stripe/checkout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Payment request link could not be created.");
  if (!result.url) throw new Error("Stripe did not return a payment link.");
  return result as { url: string; invoiceId: string; invoiceNumber?: string; reused?: boolean };
}

export { emptyWorkspace };
