"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PortalShell } from "@/components/admin/PortalShell";
import { CustomerServiceRecommendation, getCustomerServiceRecommendations } from "@/lib/storage";

export default function CustomerNotifications() {
  const [items, setItems] = useState<CustomerServiceRecommendation[]>([]);

  useEffect(() => {
    setItems(getCustomerServiceRecommendations());
  }, []);

  return (
    <PortalShell type="Customer" active="Notifications">
      <div className="app-top">
        <div>
          <span className="eyebrow">Messages</span>
          <h1>Notifications</h1>
          <p className="section-intro">Service recommendations and important account updates from the company.</p>
        </div>
        <Link className="btn btn-outline" href="/customer/requests">Request Service</Link>
      </div>
      <section className="card table-card">
        <div className="table-head">
          <div><h2>Service Recommendations</h2><p className="section-intro">{items.length} message(s).</p></div>
        </div>
        <div className="recommendation-feed">
          {items.length ? items.map((item) => (
            <article key={item.id}>
              <span>{item.status}</span>
              <div>
                <strong>{item.serviceName}</strong>
                <p>{item.message}</p>
                <small>{item.address} - {new Date(item.createdAt).toLocaleString()}</small>
              </div>
              <b>${item.amount.toFixed(2)}</b>
            </article>
          )) : <div className="empty-state"><strong>No notifications yet.</strong><p>Recommended services will appear here.</p></div>}
        </div>
      </section>
    </PortalShell>
  );
}
