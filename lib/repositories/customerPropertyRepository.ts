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

type RpcRecord = {
  customer_id: string;
  property_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  customer_notes: string | null;
  address_line1: string;
  city: string;
  province: string;
  postal_code: string | null;
  lot_size: CustomerPropertyRecord["lotSize"];
  grass_height: CustomerPropertyRecord["grassHeight"];
  gate: boolean;
  dog: boolean;
  irrigation: boolean;
  access_notes: string | null;
  property_notes: string | null;
  created_at: string;
};

function mapRecord(row: RpcRecord): CustomerPropertyRecord {
  return {
    customerId: row.customer_id,
    propertyId: row.property_id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    customerNotes: row.customer_notes,
    addressLine1: row.address_line1,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    lotSize: row.lot_size,
    grassHeight: row.grass_height,
    gate: row.gate,
    dog: row.dog,
    irrigation: row.irrigation,
    accessNotes: row.access_notes,
    propertyNotes: row.property_notes,
    createdAt: row.created_at,
  };
}

export async function listCustomerProperties(): Promise<CustomerPropertyRecord[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_customer_property_directory" as never);
  if (error) throw new Error(error.message);
  return ((data || []) as RpcRecord[]).map(mapRecord);
}

export async function createCustomerProperty(input: CreateCustomerPropertyInput): Promise<CustomerPropertyRecord> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("create_customer_property" as never, {
    p_full_name: input.fullName,
    p_email: input.email || null,
    p_phone: input.phone || null,
    p_customer_notes: input.customerNotes || null,
    p_address_line1: input.addressLine1,
    p_city: input.city || "Hamilton",
    p_province: input.province || "ON",
    p_postal_code: input.postalCode || null,
    p_lot_size: input.lotSize || null,
    p_grass_height: input.grassHeight || null,
    p_gate: Boolean(input.gate),
    p_dog: Boolean(input.dog),
    p_irrigation: Boolean(input.irrigation),
    p_access_notes: input.accessNotes || null,
    p_property_notes: input.propertyNotes || null,
  } as never);
  if (error) throw new Error(error.message);
  const first = Array.isArray(data) ? data[0] : data;
  if (!first) throw new Error("Customer was not created.");
  return mapRecord(first as RpcRecord);
}

export async function deleteCustomerRecords(customerIds:string[]):Promise<number>{
  const supabase=getSupabaseBrowserClient();
  const{data,error}=await supabase.rpc("delete_company_customers" as never,{p_customer_ids:customerIds} as never);
  if(error)throw new Error(error.message);
  return Number(data||0);
}
