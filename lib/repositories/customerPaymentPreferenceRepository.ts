import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type CustomerPaymentMethod = "card" | "account_balance";

export type CustomerPaymentPreferences = {
  servicePaymentMethod: CustomerPaymentMethod;
  tipPaymentMethod: CustomerPaymentMethod;
  syncStatus?: "live" | "local";
};

const defaults: CustomerPaymentPreferences = {
  servicePaymentMethod: "card",
  tipPaymentMethod: "card",
};

const localKey = "customer-payment-preferences-v1";

function isMissingPreferenceRpc(message: string) {
  const value = message.toLowerCase();
  return value.includes("get_customer_payment_preferences") ||
    value.includes("save_customer_payment_preferences") ||
    value.includes("schema cache") ||
    value.includes("pgrst202");
}

function normalize(input: Partial<CustomerPaymentPreferences> | null | undefined): CustomerPaymentPreferences {
  return {
    servicePaymentMethod: input?.servicePaymentMethod === "account_balance" ? "account_balance" : "card",
    tipPaymentMethod: input?.tipPaymentMethod === "account_balance" ? "account_balance" : "card",
  };
}

function localPreferences(): CustomerPaymentPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(localKey);
    return raw ? normalize(JSON.parse(raw) as Partial<CustomerPaymentPreferences>) : defaults;
  } catch {
    return defaults;
  }
}

function saveLocalPreferences(input: CustomerPaymentPreferences) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(localKey, JSON.stringify(input));
  } catch {
  }
}

async function accessToken() {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

async function apiPreferences(method: "GET" | "PATCH", input?: CustomerPaymentPreferences): Promise<CustomerPaymentPreferences> {
  const token = await accessToken();
  if (!token) throw new Error("Sign in before changing payment preferences.");
  const response = await fetch("/api/customer/payment-preferences", {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(input ? { "content-type": "application/json" } : {}),
    },
    body: input ? JSON.stringify(input) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Payment preferences are temporarily unavailable.");
  return { ...normalize(result.preferences || result), syncStatus: "live" };
}

export async function getCustomerPaymentPreferences(): Promise<CustomerPaymentPreferences> {
  try {
    return await apiPreferences("GET");
  } catch (apiError) {
    console.warn("customer-payment-preferences-api-unavailable", apiError);
  }
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("get_customer_payment_preferences" as never);
    if (error) {
      if (isMissingPreferenceRpc(error.message)) {
        console.warn("customer-payment-preferences-rpc-unavailable");
        return { ...localPreferences(), syncStatus: "local" };
      }
      throw new Error("Payment preferences are temporarily unavailable.");
    }
    return { ...normalize((data || {}) as Partial<CustomerPaymentPreferences>), syncStatus: "live" };
  } catch (error) {
    console.warn("customer-payment-preferences-live-read-failed", error);
    return { ...localPreferences(), syncStatus: "local" };
  }
}

export async function saveCustomerPaymentPreferences(input: CustomerPaymentPreferences) {
  const preferences = normalize(input);
  saveLocalPreferences(preferences);
  try {
    return await apiPreferences("PATCH", preferences);
  } catch (apiError) {
    console.warn("customer-payment-preferences-api-save-failed", apiError);
  }
  try {
    const supabase = getSupabaseBrowserClient();
    const { data, error } = await supabase.rpc("save_customer_payment_preferences" as never, {
      p_service_payment_method: preferences.servicePaymentMethod,
      p_tip_payment_method: preferences.tipPaymentMethod,
    } as never);
    if (error) {
      if (isMissingPreferenceRpc(error.message)) {
        console.warn("customer-payment-preferences-rpc-unavailable-save");
        return { ...preferences, syncStatus: "local" };
      }
      throw error;
    }
    const saved = normalize((data || preferences) as Partial<CustomerPaymentPreferences>);
    saveLocalPreferences(saved);
    return { ...saved, syncStatus: "live" };
  } catch (error) {
    console.warn("customer-payment-preferences-live-save-failed", error);
    return { ...preferences, syncStatus: "local" };
  }
}
