"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { MobileBackButton } from "@/components/mobile/MobileBackButton";
import { MobileAdminNav } from "@/components/mobile/MobileAdminNav";
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
  phone: string | null;
  email: string | null;
  address: string;
  createdAt: string | null;
};

async function accessToken() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Admin session expired. Sign in again.");
  return token;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function MobileAdminRequests() {
  const [requests, setRequests] = useState<LiveRequest[]>([]);
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

  const pending = requests.filter(item => ["pending", "open"].includes(item.status)).length;

  return <MobileRoleGuard allowed={["admin", "manager"]}>
    <main className="mobile-app-shell role-mobile-shell mobile-native-subpage">
      <header className="role-mobile-topbar">
        <MobileBackButton fallback="/mobile/admin" />
        <div><strong>Customer requests</strong><span>Live company inbox</span></div>
        <button className="mobile-native-add mobile-native-check" disabled={loading} onClick={() => void refresh()} aria-label="Refresh requests">↻</button>
      </header>

      <section className="mobile-native-hero requests">
        <span>LIVE DATABASE</span>
        <h1>{pending} request{pending === 1 ? "" : "s"} need review.</h1>
        <p>Requests sent by customers appear here automatically.</p>
      </section>

      {message && <div className="mobile-native-message" role="status">{message}</div>}

      <section className="customer-native-list admin-live-request-list">
        {requests.length ? requests.map(item => <article key={`${item.kind}-${item.id}`}>
          <div className="admin-live-request-card">
            <i className={["pending", "open"].includes(item.status) ? "pending" : "done"}>{item.kind === "customer_task" ? "↺" : "+"}</i>
            <div>
              <strong>{item.serviceName}</strong>
              <span>{item.customerName}</span>
              <small>{item.address}</small>
              {item.message && <p>{item.message}</p>}
              <small>{item.createdAt ? new Date(item.createdAt).toLocaleString("en-CA") : "Date unavailable"}</small>
            </div>
            <em>{label(item.status)}</em>
          </div>
          {item.customerId && <Link className="mobile-outline" href={`/mobile/admin/customers/${item.customerId}`}>Open customer</Link>}
        </article>) : !loading && <div className="customer-native-empty"><i>✓</i><strong>No customer requests</strong><p>New requests will appear here automatically.</p></div>}
      </section>

      <style jsx>{`
        .admin-live-request-list{display:grid;gap:12px;padding-bottom:96px}.admin-live-request-list article{display:grid;gap:10px;padding:14px;border:1px solid #dce8e1;border-radius:18px;background:#fff}.admin-live-request-card{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:start}.admin-live-request-card>i{display:grid;place-items:center;width:40px;height:40px;border-radius:13px;font-style:normal;font-weight:950}.admin-live-request-card>i.pending{background:#fff1f2;color:#be123c}.admin-live-request-card>i.done{background:#ecfdf5;color:#047857}.admin-live-request-card div strong,.admin-live-request-card div span,.admin-live-request-card div small{display:block}.admin-live-request-card div span{margin-top:3px;color:#254b3d;font-weight:800}.admin-live-request-card div small{margin-top:4px;color:#64748b}.admin-live-request-card p{margin:9px 0 0;color:#334155;line-height:1.45}.admin-live-request-card em{font-style:normal;text-transform:capitalize;font-size:10px;font-weight:950;color:#0b7655;background:#edf8f2;border-radius:999px;padding:6px 9px}.mobile-outline{justify-self:start;text-decoration:none}
      `}</style>
      <MobileAdminNav active="more" />
    </main>
  </MobileRoleGuard>;
}
