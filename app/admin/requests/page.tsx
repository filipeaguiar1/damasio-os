"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type LiveRequest = {
  id: string;
  kind: "service_request" | "customer_task";
  serviceName: string;
  message: string | null;
  status: string;
  priority: string | null;
  customerId: string | null;
  customerName: string;
  email: string | null;
  phone: string | null;
  propertyId: string | null;
  address: string;
  createdAt: string | null;
};

async function accessToken() {
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function AdminRequests() {
  const [requests, setRequests] = useState<LiveRequest[]>([]);
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("Loading customer requests...");
  const [loading, setLoading] = useState(true);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const token = await accessToken();
      const response = await fetch("/api/admin/service-requests", {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer requests could not be loaded.");
      setRequests(result.requests || []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer requests could not be loaded.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const statuses = useMemo(() => [...new Set(requests.map(item => item.status))], [requests]);
  const pending = requests.filter(item => ["pending", "open"].includes(item.status)).length;
  const visible = filter === "all" ? requests : requests.filter(item => item.status === filter);

  return <AdminShell active="Requests">
    <div className="app-top">
      <div>
        <span className="eyebrow">Live Customer Inbox</span>
        <h1>Requests <em className="notification-count">{pending}</em></h1>
        <p className="section-intro">Requests sent from the Customer app now appear directly from the company database.</p>
      </div>
      <button className="btn btn-outline" disabled={loading} onClick={() => void refresh()}>{loading ? "Loading..." : "Refresh"}</button>
    </div>

    {message && <div className="notice" style={{ marginBottom: 18 }}>{message}</div>}

    <section className="business-metrics request-metrics">
      <button className={filter === "all" ? "business-metric active" : "business-metric"} onClick={() => setFilter("all")}>
        <span>All</span><strong>{requests.length}</strong><small>live requests</small>
      </button>
      {statuses.map(status => <button key={status} className={filter === status ? "business-metric active" : "business-metric"} onClick={() => setFilter(status)}>
        <span>{statusLabel(status)}</span><strong>{requests.filter(item => item.status === status).length}</strong><small>{["pending", "open"].includes(status) ? "needs review" : statusLabel(status)}</small>
      </button>)}
    </section>

    <section className="card table-card">
      <div className="table-head"><div><h2>Customer request queue</h2><p className="section-intro">Standard service requests and customer-created return-visit tasks share this inbox.</p></div></div>
      <div className="table-wrap workflow-desktop-table">
        <table>
          <thead><tr><th>Request</th><th>Customer</th><th>Property</th><th>Status</th><th>Received</th></tr></thead>
          <tbody>{visible.length === 0 ? <tr><td colSpan={5}>{loading ? "Loading requests..." : "No customer requests in this status."}</td></tr> : visible.map(item => <tr key={`${item.kind}-${item.id}`}>
            <td><strong>{item.serviceName}</strong><br/><small>{item.kind === "customer_task" ? "Customer follow-up" : "Service request"}</small>{item.message && <p>{item.message}</p>}</td>
            <td><strong>{item.customerName}</strong><br/><small>{item.phone || "No phone"}{item.email ? ` · ${item.email}` : ""}</small>{item.customerId && <p><Link className="open-inline" href={`/admin/customers/${item.customerId}`}>Open customer</Link></p>}</td>
            <td>{item.address}</td>
            <td><span className={`request-status ${item.status}`}>{statusLabel(item.status)}</span>{item.priority && <p><small>Priority: {item.priority}</small></p>}</td>
            <td>{item.createdAt ? new Date(item.createdAt).toLocaleString("en-CA") : "—"}</td>
          </tr>)}</tbody>
        </table>
      </div>

      <div className="workflow-mobile-list">{visible.length === 0 ? <div className="mobile-empty">{loading ? "Loading requests..." : "No customer requests in this status."}</div> : visible.map(item => <article className="workflow-mobile-card" key={`mobile-${item.kind}-${item.id}`}>
        <h3>{item.serviceName}</h3>
        <p><strong>{item.customerName}</strong></p>
        <p>{item.address}</p>
        {item.message && <p>{item.message}</p>}
        <div className="workflow-mobile-meta"><div><span>Status</span><strong>{statusLabel(item.status)}</strong></div><div><span>Received</span><strong>{item.createdAt ? new Date(item.createdAt).toLocaleDateString("en-CA") : "—"}</strong></div><div><span>Type</span><strong>{item.kind === "customer_task" ? "Follow-up" : "Service"}</strong></div><div><span>Priority</span><strong>{item.priority || "Normal"}</strong></div></div>
        {item.customerId && <Link className="btn btn-outline" href={`/admin/customers/${item.customerId}`}>Open customer</Link>}
      </article>)}</div>
    </section>
  </AdminShell>;
}
