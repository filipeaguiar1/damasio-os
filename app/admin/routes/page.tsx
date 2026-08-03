"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { RouteStudio } from "@/components/admin/RouteStudio";
import { RouteTodayRemovalPanel } from "@/components/admin/RouteTodayRemovalPanel";

export default function RoutesPage(){
  return <AdminShell active="Routes"><RouteStudio/><RouteTodayRemovalPanel/></AdminShell>;
}
