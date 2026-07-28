import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type DbLawnSize = "xs" | "small" | "legacy" | "oversize";

export type CustomerPropertyRecord = {
  customerId: string;
  propertyId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  customerNotes: string | null;
  addressLine1: string;
  city: string;
  province: string;
  postalCode: string | null;
  lotSize: DbLawnSize | null;
  grassHeight: "2in" | "3in" | "4in" | "5in" | null;
  gate: boolean;
  dog: boolean;
  irrigation: boolean;
  accessNotes: string | null;
  propertyNotes: string | null;
  officialPhotoUrl: string | null;
  acquisitionSource: "platform" | "company_referral" | "company_created";
  lockedByPlatform: boolean;
  offerStatus: string | null;
  createdAt: string;
};

export type CreateCustomerPropertyInput = {
  fullName: string;
  email?: string;
  phone?: string;
  customerNotes?: string;
  addressLine1: string;
  city?: string;
  province?: string;
  postalCode?: string;
  lotSize?: DbLawnSize;
  grassHeight?: "2in" | "3in" | "4in" | "5in";
  gate?: boolean;
  dog?: boolean;
  irrigation?: boolean;
  accessNotes?: string;
  propertyNotes?: string;
  serviceName?: string;
  frequency?: "weekly"|"biweekly"|"monthly"|"adaptive"|"one_time";
  subtotal?: number;
};

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

async function customerApi(options?: RequestInit) {
  const response = await fetch("/api/admin/customers", {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${await accessToken()}`,
      ...(options?.headers || {}),
    },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Customer operation failed.");
  return result;
}

export async function listCustomerProperties(): Promise<CustomerPropertyRecord[]> {
  const result = await customerApi();
  return Array.isArray(result.records) ? result.records as CustomerPropertyRecord[] : [];
}

export async function createCustomerProperty(input: CreateCustomerPropertyInput): Promise<CustomerPropertyRecord> {
  const result = await customerApi({ method: "POST", body: JSON.stringify(input) });
  if (!result.record) throw new Error("Customer chain was created but could not be verified.");
  return result.record as CustomerPropertyRecord;
}

export async function deleteCustomerRecords(customerIds:string[]):Promise<number>{
  const result = await customerApi({
    method: "DELETE",
    body: JSON.stringify({ customerIds }),
  });
  return Number(result.removed || 0);
}
