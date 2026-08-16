"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { RouteOperationsV3 } from "@/components/admin/RouteOperationsV3";
import { RouteTodayRemovalPanel } from "@/components/admin/RouteTodayRemovalPanel";

export default function RoutesPage(){
  return <AdminShell active="Routes"><RouteOperationsV3/><RouteTodayRemovalPanel/></AdminShell>;
}
