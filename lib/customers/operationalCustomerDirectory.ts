import "server-only";

export type OperationalCustomer = {
  id: string;
  profile_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  company_id: string | null;
  organization_id: string | null;
  service_company_id: string | null;
  assignment_status: string | null;
  offer_status: string | null;
  acquisition_source: string | null;
  platform_managed: boolean | null;
  archived_at: string | null;
  created_at: string;
};

export type OperationalProperty = {
  id: string;
  customer_id: string;
  company_id: string | null;
  organization_id: string | null;
  address_line1: string;
  city: string;
  province: string;
  postal_code: string | null;
  lot_size: string | null;
  grass_height: string | null;
  gate: boolean;
  dog: boolean;
  irrigation: boolean;
  access_notes: string | null;
  property_notes: string | null;
  official_photo_url: string | null;
  created_at: string;
};

export type OperationalJob = {
  id: string;
  customer_id: string;
  property_id: string;
  quote_id: string | null;
  service_name: string;
  frequency: string;
  next_visit_date: string | null;
  recurrence_anchor_date: string | null;
  default_route_order: number | null;
  company_id: string | null;
  organization_id: string | null;
  active: boolean;
  created_at: string;
};

export type OperationalCustomerContext = {
  customers: OperationalCustomer[];
  properties: OperationalProperty[];
  jobs: OperationalJob[];
  repairedCustomerIds: string[];
};

const QUERY_BATCH_SIZE = 40;

const customerColumns = [
  "id", "profile_id", "full_name", "email", "phone", "notes", "company_id",
  "organization_id", "service_company_id", "assignment_status", "offer_status",
  "acquisition_source", "platform_managed", "archived_at", "created_at",
].join(",");

const propertyColumns = [
  "id", "customer_id", "company_id", "organization_id", "address_line1", "city",
  "province", "postal_code", "lot_size", "grass_height", "gate", "dog",
  "irrigation", "access_notes", "property_notes", "official_photo_url", "created_at",
].join(",");

const jobColumns = [
  "id", "customer_id", "property_id", "quote_id", "service_name", "frequency",
  "next_visit_date", "recurrence_anchor_date", "default_route_order", "company_id",
  "organization_id", "active", "created_at",
].join(",");

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function acceptedForCompany(customer: OperationalCustomer, companyId: string) {
  if (customer.service_company_id !== companyId) return false;
  return customer.offer_status === "accepted"
    || ["accepted", "assigned", "active"].includes(customer.assignment_status || "");
}

function directCompanyCustomer(customer: OperationalCustomer, companyId: string) {
  return customer.company_id === companyId || customer.organization_id === companyId;
}

function mergeRows<T extends { id: string }>(groups: T[][]) {
  const rows = new Map<string, T>();
  for (const group of groups) for (const row of group) rows.set(String(row.id), row);
  return [...rows.values()];
}

function chunks<T>(values: T[], size = QUERY_BATCH_SIZE) {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function byCreatedAt(left: { created_at?: string }, right: { created_at?: string }) {
  return String(left.created_at || "").localeCompare(String(right.created_at || ""));
}

async function linkedIds(service: any, companyId: string) {
  const [profiles, properties, jobs] = await Promise.all([
    service.from("profiles").select("id").eq("role", "customer").or(companyFilter(companyId)),
    service.from("properties").select("customer_id").or(companyFilter(companyId)),
    service.from("jobs").select("customer_id").or(companyFilter(companyId)),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  if (properties.error) throw new Error(properties.error.message);
  if (jobs.error) throw new Error(jobs.error.message);
  return {
    profileIds: new Set<string>((profiles.data || []).map((row: any) => String(row.id))),
    childCustomerIds: new Set<string>([
      ...(properties.data || []).map((row: any) => String(row.customer_id || "")),
      ...(jobs.data || []).map((row: any) => String(row.customer_id || "")),
    ].filter(Boolean)),
  };
}

async function customerCandidates(service: any, companyId: string) {
  const { profileIds, childCustomerIds } = await linkedIds(service, companyId);
  const queries: PromiseLike<any>[] = [
    service.from("customers").select(customerColumns).is("archived_at", null)
      .or(`${companyFilter(companyId)},service_company_id.eq.${companyId}`),
  ];

  for (const ids of chunks([...profileIds])) {
    queries.push(service.from("customers").select(customerColumns).is("archived_at", null)
      .in("profile_id", ids));
  }
  for (const ids of chunks([...childCustomerIds])) {
    queries.push(service.from("customers").select(customerColumns).is("archived_at", null)
      .in("id", ids));
  }

  const results = await Promise.all(queries);
  for (const result of results) if (result.error) throw new Error(result.error.message);
  const customers = mergeRows<OperationalCustomer>(results.map(result => result.data || []));
  return {
    customers: customers.filter(customer => directCompanyCustomer(customer, companyId)
      || acceptedForCompany(customer, companyId)
      || Boolean(customer.profile_id && profileIds.has(customer.profile_id))
      || childCustomerIds.has(customer.id)),
    profileIds,
    childCustomerIds,
  };
}

async function repairCoreOwnership(service: any, companyId: string, customers: OperationalCustomer[]) {
  const ids = customers
    .filter(customer => customer.company_id !== companyId || customer.organization_id !== companyId)
    .map(customer => customer.id);
  if (!ids.length) return [] as string[];

  const patch = { company_id: companyId, organization_id: companyId };
  for (const batch of chunks(ids)) {
    const results = await Promise.all([
      service.from("customers").update(patch).in("id", batch),
      service.from("properties").update(patch).in("customer_id", batch),
      service.from("jobs").update(patch).in("customer_id", batch).eq("active", true),
      service.from("quotes").update(patch).in("customer_id", batch),
      service.from("service_requests").update(patch).in("customer_id", batch),
    ]);
    for (const result of results) if (result.error) throw new Error(result.error.message);
  }
  return ids;
}

export async function listOperationalCompanyCustomers(
  service: any,
  companyId: string,
  options: { repair?: boolean } = {},
): Promise<OperationalCustomerContext> {
  const candidate = await customerCandidates(service, companyId);
  const repairedCustomerIds = options.repair === false
    ? []
    : await repairCoreOwnership(service, companyId, candidate.customers);

  const customerIds = candidate.customers.map(customer => customer.id);
  if (!customerIds.length) return { customers: [], properties: [], jobs: [], repairedCustomerIds };

  const customerBatches = chunks(customerIds);
  const [propertyResults, jobResults] = await Promise.all([
    Promise.all(customerBatches.map(ids =>
      service.from("properties").select(propertyColumns).in("customer_id", ids).order("created_at"))),
    Promise.all(customerBatches.map(ids =>
      service.from("jobs").select(jobColumns).in("customer_id", ids).eq("active", true).order("created_at"))),
  ]);

  for (const result of propertyResults) if (result.error) throw new Error(result.error.message);
  for (const result of jobResults) if (result.error) throw new Error(result.error.message);

  const properties = mergeRows<OperationalProperty>(propertyResults.map(result => result.data || []))
    .sort(byCreatedAt);
  const jobs = mergeRows<OperationalJob>(jobResults.map(result => result.data || []))
    .sort(byCreatedAt);

  return {
    customers: candidate.customers,
    properties,
    jobs,
    repairedCustomerIds,
  };
}
