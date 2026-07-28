"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { schedulingBoardToLeads, type RouteLead } from "@/lib/services/schedulingService";
import type { SchedulingDispatchBoard } from "@/lib/repositories/schedulingRepository";
import { belongsToCanonicalEmployee } from "@/lib/routes/canonicalRouteIdentity";
import { operationalDateKey } from "@/lib/dates/operationalDate";
import styles from "./officialRoutePanels.module.css";

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
  const date = operationalDateKey();

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const accessToken = await token();
        if (!accessToken) throw new Error("Admin session required.");
        const routeResponse = await fetch("/api/admin/routes", {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const routeResult = await routeResponse.json();
        if (!routeResponse.ok) throw new Error(routeResult.error || "Routes could not be loaded.");
        if (!cancelled) {
          setEmployees(routeResult.employees || []);
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
    const progress = visits.length ? Math.round(completed / visits.length * 100) : 0;
    return { employee, visits, completed, progress };
  }).filter(row => row.visits.length > 0), [employees, publishedToday]);

  return <article className="studio-panel route-status-panel">
    <header><h2>Route Status</h2><Link href="/admin/routes?tab=view">Route Plan</Link></header>
    <div className={styles.statusList}>
      {rows.map(row => <Link className={styles.statusRow} href="/admin/routes?tab=view" key={row.employee.id}>
        <div className={styles.statusHeader}>
          <strong>{row.employee.name}</strong>
          <span>{row.completed}/{row.visits.length}</span>
        </div>
        <div className={styles.statusTrack}><i style={{ width: `${row.progress}%` }} /></div>
        <small>{row.progress}% complete</small>
      </Link>)}
      {!rows.length && <div className="studio-empty">{message || "No published routes for today."}</div>}
    </div>
  </article>;
}
