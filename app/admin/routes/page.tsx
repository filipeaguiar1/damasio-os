"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { RouteStudioV2 } from "@/components/admin/RouteStudioV2";
import { RouteTodayRemovalPanel } from "@/components/admin/RouteTodayRemovalPanel";

export default function RoutesPage(){
  return <AdminShell active="Routes"><RouteStudioV2/><RouteTodayRemovalPanel/></AdminShell>;
}
