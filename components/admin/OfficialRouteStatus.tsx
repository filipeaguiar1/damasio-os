"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";
import { operationalDateKey } from "@/lib/dates/operationalDate";

type RouteEmployee = { id: string; employeeId: string | null; crewId: string; name: string; dailyCapacity: number };
type AdminEmployee = { id: string; daily_route_capacity?: number | null };

async function token() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

export function OfficialRouteStatus() {
  const [employees, setEmployees] = useState<RouteEmployee[]>([]);
  const [leads, setLeads] = useState<RouteLead[]>([]);
  const [message, setMessage] = useState("Loading official routes...");
  const date = operationalDateKey();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const accessToken = await token();
        if (!accessToken) throw new Error("Admin session required.");
        const headers = { authorization: `Bearer ${accessToken}` };
        const [routeResponse, employeeResponse] = await Promise.all([
          fetch("/api/admin/routes", { headers, cache: "no-store" }),
          fetch("/api/admin/users", { headers, cache: "no-store" }),
        ]);
        const routeResult = await routeResponse.json();
        const employeeResult = await employeeResponse.json().catch(() => ({ users: [] }));
        if (!routeResponse.ok) throw new Error(routeResult.error || "Routes could not be loaded.");
        if (!cancelled) {
          const profiles = new Map<string, AdminEmployee>((employeeResult.users || []).map((item: AdminEmployee) => [item.id, item]));
          setEmployees((routeResult.employees || []).map((item: Omit<RouteEmployee, "dailyCapacity">) => ({
            ...item,
            dailyCapacity: Math.max(1, Number(profiles.get(item.id)?.daily_route_capacity || 16)),
          })));
          setLeads(schedulingBoardToLeads((routeResult.board || {}) as SchedulingDispatchBoard));
          setMessage("");
        }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Routes could not be loaded.");
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const publishedToday = useMemo(() => leads.filter(item =>
    Boolean(item.canonicalVisitId)
    && Boolean(item.canonicalRouteId)
    && item.scheduledDate === date
    && item.canonicalVisitStatus !== "cancelled"), [leads, date]);

  const rows = useMemo(() => employees.map(employee => {
    const identity = { id: employee.employeeId || employee.id, crewId: employee.crewId };
    const visits = publishedToday.filter(item => belongsToCanonicalEmployee(item, identity));
    const completed = visits.filter(item => item.canonicalVisitStatus === "completed" || item.status === "completed").length;
    const skipped = visits.filter(item => item.canonicalVisitStatus === "missed").length;
    const inProgress = visits.filter(item => item.canonicalVisitStatus === "in_progress").length;
    const pending = Math.max(0, visits.length - completed - skipped - inProgress);
    const progress = visits.length ? Math.round(completed / visits.length * 100) : 0;
    return { employee, visits, completed, skipped, inProgress, pending, progress };
  }), [employees, publishedToday]);

  return <article className="studio-panel route-status-panel">
    <header><h2>Route Status</h2><Link href="/admin/routes?tab=view">Route Plan</Link></header>
    <div className="route-status-list">
      {rows.map(row => <Link href="/admin/routes?tab=view" key={row.employee.id}>
        <strong>{row.employee.name}</strong>
        <span>{row.visits.length}/{row.employee.dailyCapacity} published stops · {row.completed} completed · {row.pending} pending · {row.skipped} skipped{row.inProgress ? ` · ${row.inProgress} active` : ""}</span>
        <div><i style={{ width: `${row.progress}%` }} /></div><em>{row.progress}%</em>
      </Link>)}
      {!rows.length && <div className="studio-empty">{message || "No active Employees found."}</div>}
    </div>
  </article>;
}
