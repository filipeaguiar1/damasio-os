import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CustomerPaymentMethod = "card" | "account_balance";

export type CustomerPaymentPreferences = {
  servicePaymentMethod: CustomerPaymentMethod;
  tipPaymentMethod: CustomerPaymentMethod;
};

const defaults: CustomerPaymentPreferences = {
  servicePaymentMethod: "card",
  tipPaymentMethod: "card",
};

async function accessToken() {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in before changing payment preferences.");
  return token;
}

export async function getCustomerPaymentPreferences(): Promise<CustomerPaymentPreferences> {
  const token = await accessToken();
  const response = await fetch("/api/customer/payment-preferences", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Payment preferences could not be loaded.");
  return { ...defaults, ...result };
}

export async function saveCustomerPaymentPreferences(input: CustomerPaymentPreferences) {
  const token = await accessToken();
  const response = await fetch("/api/customer/payment-preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Payment preferences could not be saved. Please try again.");
  return { ...defaults, ...result };
}
