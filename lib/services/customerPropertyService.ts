import { createCustomerProperty, deleteCustomerRecords, listCustomerProperties, type CreateCustomerPropertyInput, type CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { createManualCustomer, getLeads, Lead, seedDemoLeads, setLeads } from "@/lib/storage";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { createOperationQuote, updateOperationQuoteStatus } from "@/lib/repositories/operationsRepository";
import { readDemoSession } from "@/lib/auth/demoAuth";

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizeDbLawnSize(value: string | null | undefined): CustomerPropertyRecord["lotSize"] {
  if (value === "xs" || value === "small" || value === "legacy" || value === "oversize") return value;
  if (value === "large") return "legacy";
  if (value === "xlarge") return "oversize";
  if (value === "medium") return "small";
  return null;
}

function leadToCustomerPropertyRecord(lead: Lead): CustomerPropertyRecord {
  return {
    customerId: lead.id,
    propertyId: lead.id,
    fullName: lead.name,
    email: lead.email || null,
    phone: lead.phone || null,
    customerNotes: lead.notes || null,
    addressLine1: lead.address,
    city: lead.address.split(",").slice(-1)[0]?.trim() || "Hamilton",
    province: "ON",
    postalCode: null,
    lotSize: normalizeDbLawnSize(lead.propertyDetails?.lawnSize),
    grassHeight: lead.propertyDetails?.grassHeight || null,
    gate: Boolean(lead.propertyDetails?.gated),
    dog: false,
    irrigation: false,
    accessNotes: lead.propertyDetails?.accessNotes || null,
    propertyNotes: [lead.propertyDetails?.adminNotes, lead.propertyDetails?.propertyAlerts].filter(Boolean).join(" | ") || null,
    createdAt: lead.createdAt,
  };
}

function localRecords() {
  return getLeads().map(leadToCustomerPropertyRecord);
}

function usesLocalDemoData(){
  return Boolean(readDemoSession()) || !isSupabaseConfigured();
}

function mergeDirectory(remote: CustomerPropertyRecord[], local: CustomerPropertyRecord[]) {
  const seen = new Set<string>();
  const merged: CustomerPropertyRecord[] = [];
  [...remote, ...local].forEach((record) => {
    const key = normalize(record.email) || normalize(record.addressLine1) || record.propertyId;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(record);
  });
  return merged;
}

export async function getCustomerPropertyDirectory() {
  if(usesLocalDemoData()){
    seedDemoLeads();
    return localRecords();
  }
  return listCustomerProperties();
}

export async function addCustomerWithProperty(input: CreateCustomerPropertyInput) {
  if (!input.fullName.trim()) throw new Error("Customer name is required.");
  if (!input.addressLine1.trim()) throw new Error("Property address is required.");

  if(usesLocalDemoData()){
    const alreadyLocal = getLeads().some((lead) => normalize(lead.email) === normalize(input.email) && normalize(lead.address) === normalize(input.addressLine1));
    if(alreadyLocal)throw new Error("A customer with this email and property already exists in the demo.");
    const lead = createManualCustomer({
      name: input.fullName,
      phone: input.phone || "",
      email: input.email || "",
      address: input.addressLine1,
      service: input.serviceName || "Weekly Lawn Care",
      subtotal: 0,
      tax: 0,
      total: 0,
      notes: input.customerNotes,
      propertyDetails: {
        lawnSize: input.lotSize || "small",
        grassHeight: input.grassHeight || "3in",
        grassHandling: "no_preference",
        backyard: true,
        gated: Boolean(input.gate),
        accessNotes: input.accessNotes,
        adminNotes: input.propertyNotes,
      },
    });
    return leadToCustomerPropertyRecord(lead);
  }

  const record=await createCustomerProperty(input);
  if(input.serviceName){
    const supabase=getSupabaseBrowserClient();
    const {error}=await supabase.rpc("create_job_for_customer_property" as never,{
      p_customer_id:record.customerId,p_property_id:record.propertyId,p_service_name:input.serviceName,p_frequency:input.frequency||"one_time"
    } as never);
    if(error){
      const board=await createOperationQuote({customerId:record.customerId,propertyId:record.propertyId,serviceName:input.serviceName,subtotal:input.subtotal||0,notes:input.serviceName});
      const quote=board.quotes.find(item=>item.propertyId===record.propertyId&&item.status==="draft");
      if(quote)await updateOperationQuoteStatus(quote.id,"approved");
    }
  }
  return record;
}

export async function deleteCustomers(customerIds:string[]){
  const ids=[...new Set(customerIds.filter(Boolean))];if(!ids.length)throw new Error("Select at least one customer.");
  if(usesLocalDemoData()){
    const before=getLeads();const next=before.filter(lead=>!ids.includes(lead.id));
    setLeads(next);
    return before.length-next.length;
  }
  try{return await deleteCustomerRecords(ids)}catch(error){
    const message=error instanceof Error?error.message:"Customer removal failed.";
    if(message.toLowerCase().includes("permission denied"))throw new Error("Your session cannot remove customers. Sign out, sign in with a real company Admin account, and try again after installing the pre-launch database migration.");
    throw error;
  }
}
