"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileAdminNav } from "@/components/mobile/MobileAdminNav";
import { loadDailyOperations } from "@/lib/services/dailyOperationsService";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type LiveAlert = {
  id: string;
  title: string;
  message: string;
  customer: string;
  address: string;
  status: string;
  priority: string;
  createdAt?: string;
  photo?: string | null;
  href: string;
};

async function token() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your Admin session expired. Sign in again.");
  return value;
}

async function loadRequestAlerts(): Promise<LiveAlert[]> {
  const response = await fetch("/api/admin/service-requests", {
    headers: { authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Alerts could not be loaded.");
  return (result.requests || [])
    .filter((item: any) => item.priority === "urgent" && !["completed", "resolved", "cancelled"].includes(item.status))
    .map((item: any) => ({
      id: String(item.id),
      title: item.serviceName || item.title || "Urgent customer task",
      message: item.issue || item.description || item.message || "This item needs Admin attention.",
      customer: item.customerName || "Customer",
      address: item.address || "Address unavailable",
      status: item.status || "pending",
      priority: item.priority || "urgent",
      createdAt: item.createdAt || item.created_at,
      photo: item.requestPhotos?.[0] || item.photos?.[0] || null,
      href: "/mobile/admin/tasks",
    }));
}

async function loadOperationAlerts(): Promise<LiveAlert[]> {
  const operations = await loadDailyOperations();
  return (operations.tasks || [])
    .filter((item: any) => item.priority === "urgent" && !["completed", "resolved", "cancelled"].includes(item.status))
    .map((item: any) => ({
      id: `operation-${item.id}`,
      title: item.title || "Urgent operational task",
      message: item.description || item.issue || "This operation needs attention.",
      customer: item.customerName || "Customer",
      address: item.address || "Address unavailable",
      status: item.status || "pending",
      priority: item.priority || "urgent",
      createdAt: item.createdAt || item.created_at,
      photo: item.requestPhotos?.[0] || null,
      href: "/mobile/admin/tasks",
    }));
}

export default function MobileAdminAlerts() {
  const [items, setItems] = useState<LiveAlert[]>([]);
  const [selected, setSelected] = useState<LiveAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const groups = await Promise.allSettled([loadRequestAlerts(), loadOperationAlerts()]);
      const merged = new Map<string, LiveAlert>();
      for (const group of groups) {
        if (group.status === "fulfilled") for (const alert of group.value) merged.set(alert.id.replace(/^operation-/, ""), alert);
      }
      setItems([...merged.values()].sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "")));
      const failed = groups.every(group => group.status === "rejected");
      setMessage(failed ? "Live alerts could not be loaded. Pull down or tap Refresh." : "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const client = getSupabaseBrowserClient() as any;
    const channel = client.channel("mobile-admin-live-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => void refresh(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "service_requests" }, () => void refresh(true))
      .subscribe();
    const timer = window.setInterval(() => void refresh(true), 5000);
    const focus = () => void refresh(true);
    window.addEventListener("focus", focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      void client.removeChannel(channel);
    };
  }, [refresh]);

  const title = useMemo(() => loading ? "Loading active alerts…" : items.length ? `${items.length} alert${items.length === 1 ? "" : "s"} need attention.` : "You are all caught up.", [items.length, loading]);

  return <MobileRoleGuard allowed={["admin", "manager"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-native-subpage mobile-live-alerts">
      <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/admin"/><div><strong>Alerts</strong><span>Live company attention</span></div><button className="mobile-native-add" onClick={() => void refresh()} aria-label="Refresh alerts">↻</button></header>
      <section className="mobile-native-hero alert"><span>LIVE ALERTS</span><h1>{title}</h1><p>The number on the Admin home and this list now use the same live task data.</p></section>
      {message && <div className="mobile-native-message" role="alert">{message}</div>}
      <section className="mobile-alert-list">
        {items.map(item => <button type="button" className="mobile-alert-item" key={item.id} onClick={() => setSelected(item)}>
          {item.photo ? <img className="mobile-alert-thumb" src={item.photo} alt="Task evidence"/> : <i>!</i>}
          <div><span>{item.priority} · {item.status.replaceAll("_", " ")}</span><strong>{item.title}</strong><p>{item.message}</p><small>{item.customer} · {item.address}</small></div><b/>
        </button>)}
        {!loading && !items.length && <div className="mobile-native-empty"><i>✓</i><strong>No active alerts</strong><p>Urgent tasks will appear here immediately.</p></div>}
      </section>
      {selected && <div className="mobile-native-modal"><button className="mobile-native-scrim" onClick={() => setSelected(null)} aria-label="Close alert"/><section><header><div><span>URGENT TASK</span><h2>{selected.title}</h2></div><button onClick={() => setSelected(null)}>×</button></header><div className="mobile-alert-detail">{selected.photo && <img className="mobile-alert-detail-photo" src={selected.photo} alt="Task evidence"/>}<label>What needs attention</label><p>{selected.message}</p><dl><div><dt>Customer</dt><dd>{selected.customer}</dd></div><div><dt>House</dt><dd>{selected.address}</dd></div><div><dt>Status</dt><dd>{selected.status.replaceAll("_", " ")}</dd></div>{selected.createdAt && <div><dt>Received</dt><dd>{new Date(selected.createdAt).toLocaleString("en-CA")}</dd></div>}</dl><Link className="mobile-native-submit" href={selected.href}>Open task center</Link></div></section></div>}
      <MobileAdminNav active="alerts"/>
      <style jsx global>{`.mobile-live-alerts .mobile-alert-thumb{width:48px;height:48px;border-radius:13px;object-fit:cover;align-self:start}.mobile-live-alerts .mobile-alert-item>div{min-width:0}.mobile-live-alerts .mobile-alert-item p{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.mobile-alert-detail-photo{width:100%;max-height:240px;object-fit:cover;border-radius:16px;margin-bottom:14px}`}</style>
    </main>
  </MobileRoleGuard>;
}
