export const CORE_DATABASE_TABLES = [
  "organizations",
  "profiles",
  "customers",
  "employees",
  "crews",
  "properties",
  "service_requests",
  "quotes",
  "invoices",
  "payments",
  "jobs",
  "routes",
  "visits",
  "tasks",
  "photos",
  "feedback",
  "activity_log"
] as const;

export const STORAGE_BUCKETS = [
  "property-photos",
  "work-photos",
  "task-photos",
  "before-after",
  "documents"
] as const;

export type CoreDatabaseTable = (typeof CORE_DATABASE_TABLES)[number];
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];
