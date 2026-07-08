export type ReadinessStatus = "ready" | "warning" | "blocked";

export type ReadinessItem = {
  area: string;
  title: string;
  status: ReadinessStatus;
  detail: string;
  nextAction: string;
};

export const productionReadinessItems: ReadinessItem[] = [
  {
    area: "Operations",
    title: "Timer Engine",
    status: "warning",
    detail: "Service start/finish is protected, but this remains the most critical flow to regression test before selling.",
    nextAction: "Test Start, Finish, Reset and Refresh on the same property.",
  },
  {
    area: "Operations",
    title: "Task Assignment Lock",
    status: "ready",
    detail: "Assigned return visits stay locked until Admin uses Unassign.",
    nextAction: "Confirm Open, Assign, Unassign, Completed and Resolve flows.",
  },
  {
    area: "Dispatch",
    title: "Route Sync",
    status: "warning",
    detail: "Routes must remain synced with Employee Route, Service Screen and pending houses.",
    nextAction: "Test assigning and completing houses across multiple employees.",
  },
  {
    area: "Data",
    title: "Single Source of Truth",
    status: "warning",
    detail: "V49 keeps the ERP rule: no duplicated customer/property/service records.",
    nextAction: "Audit demo data, Supabase repositories and local fallback data.",
  },
  {
    area: "SaaS",
    title: "Company Isolation",
    status: "blocked",
    detail: "Before real SaaS sales, every record must be isolated by company/account.",
    nextAction: "Implement tenant_id/company_id enforcement in all repositories and RLS.",
  },
  {
    area: "Finance",
    title: "Payments",
    status: "blocked",
    detail: "Finance foundation exists, but live payment processing is not connected yet.",
    nextAction: "Connect Stripe or another Canadian-ready processor when ready.",
  },
  {
    area: "Mobile",
    title: "Field Mode",
    status: "warning",
    detail: "Mobile-first screens exist, but offline sync still requires device testing.",
    nextAction: "Test on phone/tablet with weak connection and photo upload.",
  },
];

export function getProductionReadinessSummary() {
  return productionReadinessItems.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { ready: 0, warning: 0, blocked: 0 } as Record<ReadinessStatus, number>
  );
}
