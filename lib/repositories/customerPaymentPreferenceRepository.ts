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

export async function getCustomerPaymentPreferences(): Promise<CustomerPaymentPreferences> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_customer_payment_preferences" as never);
  if (error) throw new Error(error.message);
  return { ...defaults, ...((data || {}) as Partial<CustomerPaymentPreferences>) };
}

export async function saveCustomerPaymentPreferences(input: CustomerPaymentPreferences) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("save_customer_payment_preferences" as never, {
    p_service_payment_method: input.servicePaymentMethod,
    p_tip_payment_method: input.tipPaymentMethod,
  } as never);
  if (error) throw new Error(error.message);
  return { ...defaults, ...((data || {}) as Partial<CustomerPaymentPreferences>) };
}
