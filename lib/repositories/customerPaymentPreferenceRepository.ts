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

function isMissingPreferenceRpc(message: string) {
  const value = message.toLowerCase();
  return value.includes("get_customer_payment_preferences") ||
    value.includes("save_customer_payment_preferences") ||
    value.includes("schema cache") ||
    value.includes("pgrst202");
}

export async function getCustomerPaymentPreferences(): Promise<CustomerPaymentPreferences> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_customer_payment_preferences" as never);
  if (error) {
    if (isMissingPreferenceRpc(error.message)) {
      console.warn("customer-payment-preferences-rpc-unavailable");
      return defaults;
    }
    throw new Error("Payment preferences are temporarily unavailable.");
  }
  return { ...defaults, ...((data || {}) as Partial<CustomerPaymentPreferences>) };
}

export async function saveCustomerPaymentPreferences(input: CustomerPaymentPreferences) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("save_customer_payment_preferences" as never, {
    p_service_payment_method: input.servicePaymentMethod,
    p_tip_payment_method: input.tipPaymentMethod,
  } as never);
  if (error) {
    if (isMissingPreferenceRpc(error.message)) {
      throw new Error("Payment preferences will be available after the account update is completed.");
    }
    throw new Error("Payment preferences could not be saved. Please try again.");
  }
  return { ...defaults, ...((data || {}) as Partial<CustomerPaymentPreferences>) };
}
