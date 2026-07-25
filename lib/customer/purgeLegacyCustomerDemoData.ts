const CUSTOMER_LEGACY_KEYS = [
  "damasio_os_leads",
  "damasio_os_estimates",
  "damasio_os_invoices",
  "damasio_os_service_requests",
  "damasio_os_customer_recommendations",
  "damasio_os_recurrences",
  "damasio_os_service_sessions",
  "damasio_os_employee_tasks",
  "damasio_os_notifications",
];

function isDemoSession() {
  if (typeof window === "undefined") return false;
  try {
    const session = JSON.parse(window.localStorage.getItem("damasio_os_session") || "null") as { email?: string } | null;
    return Boolean(session?.email?.toLowerCase().endsWith("@damasioos.demo"));
  } catch {
    return false;
  }
}

/**
 * Old mobile builds stored sample customers, properties and estimates in localStorage.
 * A real authenticated customer must never inherit those browser records.
 */
export function purgeLegacyCustomerDemoData() {
  if (typeof window === "undefined" || isDemoSession()) return;
  for (const key of CUSTOMER_LEGACY_KEYS) window.localStorage.removeItem(key);
  window.localStorage.setItem("damasio_customer_demo_data_purged", "1");
}
