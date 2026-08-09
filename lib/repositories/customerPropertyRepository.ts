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

export type CustomerDirectoryPagination = {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type CustomerDirectoryPage = {
  records: CustomerPropertyRecord[];
  pagination: CustomerDirectoryPagination;
  counts: { customers: number; properties: number; pageJobs: number };
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

const directoryCache = new Map<string,{expires:number;value:CustomerDirectoryPage}>();
const DIRECTORY_CACHE_MS = 15_000;

function clearDirectoryCache(){directoryCache.clear()}

async function accessToken(refresh = false) {
  const supabase = getSupabaseBrowserClient() as any;
  const response = refresh
    ? await supabase.auth.refreshSession()
    : await supabase.auth.getSession();
  if (response.error) throw new Error(response.error.message);
  const token = response.data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

async function customerApi(path: string, options?: RequestInit) {
  let response: Response | null = null;
  let result: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await accessToken(attempt > 0)}`,
        ...(options?.headers || {}),
      },
      cache: "no-store",
    });
    result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    if (response.status !== 401 || attempt > 0) break;
  }
  throw new Error(result?.error || "Customer operation failed.");
}

export async function listCustomerProperties(params: {
  page?: number;
  pageSize?: number;
  query?: string;
  city?: string;
} = {}): Promise<CustomerDirectoryPage> {
  const normalizedParams={
    page:Math.max(1,params.page||1),
    pageSize:Math.min(100,Math.max(10,params.pageSize||50)),
    query:params.query?.trim()||"",
    city:params.city?.trim()&&params.city!=="all"?params.city.trim():"",
  };
  const cacheKey=JSON.stringify(normalizedParams);
  const cached=directoryCache.get(cacheKey);
  if(cached&&cached.expires>Date.now())return cached.value;

  const search = new URLSearchParams({
    page: String(normalizedParams.page),
    pageSize: String(normalizedParams.pageSize),
  });
  if (normalizedParams.query) search.set("query", normalizedParams.query);
  if (normalizedParams.city) search.set("city", normalizedParams.city);
  const result = await customerApi(`/api/admin/customers/directory?${search.toString()}`);
  const value={
    records: Array.isArray(result.records) ? result.records as CustomerPropertyRecord[] : [],
    pagination: result.pagination || {
      page: 1, pageSize: 50, total: 0, pageCount: 1, hasNext: false, hasPrevious: false,
    },
    counts: result.counts || { customers: 0, properties: 0, pageJobs: 0 },
  };
  directoryCache.set(cacheKey,{expires:Date.now()+DIRECTORY_CACHE_MS,value});
  return value;
}

export async function createCustomerProperty(input: CreateCustomerPropertyInput): Promise<CustomerPropertyRecord> {
  const result = await customerApi("/api/admin/customers", { method: "POST", body: JSON.stringify(input) });
  if (!result.record) throw new Error("Customer chain was created but could not be verified.");
  clearDirectoryCache();
  return result.record as CustomerPropertyRecord;
}

export async function deleteCustomerRecords(customerIds:string[]):Promise<number>{
  const result = await customerApi("/api/admin/customers", {
    method: "DELETE",
    body: JSON.stringify({ customerIds }),
  });
  clearDirectoryCache();
  return Number(result.removed || 0);
}
