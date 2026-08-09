export type ManagerPermissionKey =
  | "customers"
  | "properties"
  | "quotes"
  | "jobs"
  | "schedule"
  | "dispatch"
  | "routes"
  | "employees"
  | "tasks"
  | "feedback"
  | "reports"
  | "finance"
  | "settings";

export type ManagerPermissionLevel = "none" | "view" | "manage";
export type ManagerPermissions = Partial<Record<ManagerPermissionKey, ManagerPermissionLevel>>;

const RANK: Record<ManagerPermissionLevel, number> = { none: 0, view: 1, manage: 2 };

export function hasManagerPermission(
  permissions: unknown,
  key: ManagerPermissionKey,
  required: Exclude<ManagerPermissionLevel, "none"> = "view",
) {
  const map = permissions && typeof permissions === "object" ? permissions as ManagerPermissions : {};
  const actual = map[key] || "none";
  return RANK[actual] >= RANK[required];
}

export function managerPermissionForPath(pathname: string): ManagerPermissionKey | null {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (/^\/(?:mobile\/)?admin\/(?:customers|add-customer|add-client|recommend-service)(?:\/|$)/.test(path)) return "customers";
  if (/^\/(?:mobile\/)?admin\/properties(?:\/|$)/.test(path)) return "properties";
  if (/^\/(?:mobile\/)?admin\/(?:estimates|quotes)(?:\/|$)/.test(path)) return "quotes";
  if (/^\/(?:mobile\/)?admin\/(?:jobs|operations)(?:\/|$)/.test(path)) return "jobs";
  if (/^\/(?:mobile\/)?admin\/schedule(?:\/|$)/.test(path)) return "schedule";
  if (/^\/(?:mobile\/)?admin\/(?:dispatch|command|status)(?:\/|$)/.test(path)) return "dispatch";
  if (/^\/(?:mobile\/)?admin\/(?:routes|map|route-advisor)(?:\/|$)/.test(path)) return "routes";
  if (/^\/(?:mobile\/)?admin\/(?:employees|users)(?:\/|$)/.test(path)) return "employees";
  if (/^\/(?:mobile\/)?admin\/(?:tasks|alerts|requests)(?:\/|$)/.test(path)) return "tasks";
  if (/^\/(?:mobile\/)?admin\/feedback(?:\/|$)/.test(path)) return "feedback";
  if (/^\/(?:mobile\/)?admin\/reports(?:\/|$)/.test(path)) return "reports";
  if (/^\/(?:mobile\/)?admin\/(?:finance|payments)(?:\/|$)/.test(path)) return "finance";
  if (/^\/(?:mobile\/)?admin\/(?:settings|company|opening)(?:\/|$)/.test(path)) return "settings";

  // Unmapped Admin surfaces are Admin-only by default.
  return null;
}

const DESKTOP_DESTINATIONS: Array<[ManagerPermissionKey, string]> = [
  ["customers", "/admin/customers"],
  ["properties", "/admin/properties"],
  ["quotes", "/admin/estimates"],
  ["jobs", "/admin/operations"],
  ["schedule", "/admin/schedule"],
  ["dispatch", "/admin/dispatch"],
  ["routes", "/admin/routes"],
  ["employees", "/admin/employees"],
  ["tasks", "/admin/tasks"],
  ["feedback", "/admin/feedback"],
  ["reports", "/admin/reports"],
  ["finance", "/admin/finance"],
  ["settings", "/admin/settings"],
];

const MOBILE_DESTINATIONS: Array<[ManagerPermissionKey, string]> = [
  ["customers", "/mobile/admin/customers"],
  ["quotes", "/mobile/admin/estimates"],
  ["schedule", "/mobile/admin/schedule"],
  ["dispatch", "/mobile/admin/command"],
  ["routes", "/mobile/admin/routes"],
  ["employees", "/mobile/admin/employees"],
  ["tasks", "/mobile/admin/tasks"],
  ["finance", "/mobile/admin/finance"],
];

export function firstAllowedManagerPath(permissions: unknown, mobile = false) {
  const options = mobile ? MOBILE_DESTINATIONS : DESKTOP_DESTINATIONS;
  return options.find(([key]) => hasManagerPermission(permissions, key, "view"))?.[1] || null;
}
