import { createCustomerProperty, listCustomerProperties, type CreateCustomerPropertyInput, type CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { createManualCustomer, getLeads, Lead } from "@/lib/storage";

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
  const local = localRecords();
  try {
    const remote = await listCustomerProperties();
    return mergeDirectory(remote, local);
  } catch {
    return local;
  }
}

export async function addCustomerWithProperty(input: CreateCustomerPropertyInput) {
  if (!input.fullName.trim()) throw new Error("Customer name is required.");
  if (!input.addressLine1.trim()) throw new Error("Property address is required.");

  const alreadyLocal = getLeads().some((lead) => normalize(lead.email) === normalize(input.email) && normalize(input.addressLine1) === normalize(input.addressLine1));
  let localRecord: CustomerPropertyRecord | null = null;
  if (!alreadyLocal) {
    const lead = createManualCustomer({
      name: input.fullName,
      phone: input.phone || "",
      email: input.email || "",
      address: input.addressLine1,
      service: "Weekly Lawn Care",
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
    localRecord = leadToCustomerPropertyRecord(lead);
  }

  try {
    return await createCustomerProperty(input);
  } catch {
    return localRecord || localRecords()[0];
  }
}
