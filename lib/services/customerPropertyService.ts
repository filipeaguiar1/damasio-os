import { createCustomerProperty, deleteCustomerRecords, listCustomerProperties, type CreateCustomerPropertyInput, type CustomerDirectoryPage, type CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { createManualCustomer, getLeads, Lead, seedDemoLeads, setLeads } from "@/lib/storage";
import { isSupabaseConfigured } from "@/lib/supabase/client";
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
    officialPhotoUrl: lead.propertyPhoto || null,
    acquisitionSource: "company_created",
    lockedByPlatform: false,
    offerStatus: null,
    createdAt: lead.createdAt,
  };
}

function localRecords() {
  return getLeads().map(leadToCustomerPropertyRecord);
}

function usesLocalDemoData(){
  return Boolean(readDemoSession()) || !isSupabaseConfigured();
}

export async function getCustomerPropertyDirectoryPage(params: {
  page?: number;
  pageSize?: number;
  query?: string;
  city?: string;
} = {}): Promise<CustomerDirectoryPage> {
  if (usesLocalDemoData()) {
    seedDemoLeads();
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(10, params.pageSize || 50));
    const query = normalize(params.query);
    const city = normalize(params.city === "all" ? "" : params.city);
    const filtered = localRecords().filter(record => {
      const haystack = normalize(`${record.fullName} ${record.email || ""} ${record.phone || ""} ${record.addressLine1} ${record.city}`);
      return (!query || haystack.includes(query)) && (!city || normalize(record.city) === city);
    });
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, pageCount);
    const start = (safePage - 1) * pageSize;
    return {
      records: filtered.slice(start, start + pageSize),
      pagination: {
        page: safePage,
        pageSize,
        total: filtered.length,
        pageCount,
        hasNext: safePage < pageCount,
        hasPrevious: safePage > 1,
      },
      counts: { customers: filtered.length, properties: filtered.length, pageJobs: 0 },
    };
  }
  return listCustomerProperties(params);
}

export async function getCustomerPropertyDirectory() {
  return (await getCustomerPropertyDirectoryPage()).records;
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
      subtotal: input.subtotal || 0,
      tax: Math.round((input.subtotal || 0) * 0.13 * 100) / 100,
      total: Math.round((input.subtotal || 0) * 1.13 * 100) / 100,
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

  return createCustomerProperty(input);
}

export async function deleteCustomers(customerIds:string[]){
  const ids=[...new Set(customerIds.filter(Boolean))];if(!ids.length)throw new Error("Select at least one customer.");
  if(usesLocalDemoData()){
    const before=getLeads();const next=before.filter(lead=>!ids.includes(lead.id));
    setLeads(next);
    return before.length-next.length;
  }
  return deleteCustomerRecords(ids);
}
