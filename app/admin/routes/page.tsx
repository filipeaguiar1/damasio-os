"use client";

import { AdminShell } from "@/components/admin/AdminShell";
import { RouteStudio } from "@/components/admin/RouteStudio";

export default function RoutesPage(){
  return <AdminShell active="Routes"><RouteStudio/></AdminShell>;
}
