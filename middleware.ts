import { NextRequest, NextResponse } from "next/server";

const ADMIN_MAP: Record<string, string> = {
  "": "/admin",
  command: "/admin/command",
  routes: "/admin/routes",
  schedule: "/admin/schedule",
  customers: "/admin/customers",
  tasks: "/admin/tasks/open",
  alerts: "/admin/alerts",
  estimates: "/admin/estimates",
  invoices: "/admin/invoices",
  requests: "/admin/requests",
  employees: "/admin/employees",
  finance: "/admin/finance",
  reports: "/admin/reports",
};

const CUSTOMER_MAP: Record<string, string> = {
  "": "/customer",
  services: "/customer/services",
  history: "/customer/history",
  estimates: "/customer/estimates",
  invoices: "/customer/invoices",
  payments: "/customer/payments",
  feedback: "/customer/feedback",
  profile: "/customer/profile",
  issues: "/customer/tasks",
  requests: "/customer/requests",
  more: "/customer",
};

const EMPLOYEE_MAP: Record<string, string> = {
  "": "/employee",
  route: "/employee/route",
  checklist: "/employee/checklist",
  photos: "/employee/photos",
  hours: "/employee/hours",
  training: "/employee/training",
  profile: "/employee/profile",
};

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "mobile") return NextResponse.next();
  if (parts.length === 1 || parts[1] === "login") return NextResponse.next();

  const role = parts[1];
  const section = parts[2] || "";
  let target: string | undefined;

  if (role === "admin") target = ADMIN_MAP[section] || "/admin";
  if (role === "customer") target = CUSTOMER_MAP[section] || "/customer";
  if (role === "employee") target = EMPLOYEE_MAP[section] || "/employee";
  if (role === "master") target = "/master";

  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/mobile/:path*"],
};
