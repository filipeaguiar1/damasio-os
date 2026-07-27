"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";

type RouteEmployee = { id: string; employeeId: string | null; crewId: string; name: string };

async function token() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export function OfficialRouteStatus() {
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [message, setMessage] = useState("Loading official routes...");
  const date = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const accessToken = await token();
        if (!accessToken) throw new Error("Admin session required.");
        const response = await fetch("/api/admin/routes", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Routes could not be loaded.");
        if (!cancelled) {
          setEmployees(result.employees || []);
          setLeads(schedulingBoardToLeads((result.board || {}) as SchedulingDispatchBoard));
          setMessage("");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => employees.map(employee => {
    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
    const visits = leads.filter(item => item.canonicalVisitId && item.scheduledDate === date && belongsToCanonicalEmployee(item, identity));
    const completed = visits.filter(item => item.canonicalVisitStatus === "completed" || item.status === "completed").length;
    const skipped = visits.filter(item => item.canonicalVisitStatus === "missed").length;
    return { employee, visits, completed, skipped, progress: visits.length ? Math.round(completed / visits.length * 100) : 0 };
  }), [employees, leads, date]);

  return <article className="studio-panel route-status-panel">
    <header><h2>Route Status</h2><Link href="/admin/routes">Route Plan</Link></header>
    <div className="route-status-list">
      {rows.map(row => <Link href={`/admin/routes?employee=${encodeURIComponent(row.employee.id)}`} key={row.employee.id}>
        <strong>{row.employee.name}</strong>
        <span>{row.visits.length} jobs · {row.skipped} skipped</span>
        <div><i style={{ width: `${row.progress}%` }} /></div><em>{row.progress}%</em>
      </Link>)}
      {!rows.length && <div className="studio-empty">{message || "No active Employees found."}</div>}
    </div>
  </article>;
}
