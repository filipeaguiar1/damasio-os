"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { getCustomerPropertyDirectory } from "@/lib/services/customerPropertyService";
import type { CustomerPropertyRecord } from "@/lib/repositories/customerPropertyRepository";
import { getLeads, sendCustomerServiceRecommendation } from "@/lib/storage";

type CustomerOption = {
  customerId: string;
  propertyId?: string;
  fullName: string;
  email?: string;
  phone?: string;
  address: string;
};

function fromLocalCustomers(): CustomerOption[] {
  return getLeads().map((lead) => ({
    customerId: lead.id,
    propertyId: lead.id,
    fullName: lead.name,
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
  }));
}

export default function RecommendService() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [serviceName, setServiceName] = useState("Spring Cleanup");
  const [amount, setAmount] = useState("180");
  const [message, setMessage] = useState("We recommend this service for your property based on the season and your current maintenance plan.");
  const [sendPortal, setSendPortal] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let alive = true;
    void getCustomerPropertyDirectory()
      .then((records: CustomerPropertyRecord[]) => {
        const mapped = records.map((record) => ({
          customerId: record.customerId,
          propertyId: record.propertyId,
          fullName: record.fullName,
          email: record.email || undefined,
          phone: record.phone || undefined,
          address: [record.addressLine1, record.city, record.province, record.postalCode].filter(Boolean).join(", "),
        }));
        const next = mapped.length ? mapped : fromLocalCustomers();
        if (alive) {
          setCustomers(next);
          setSelectedId(next[0]?.propertyId || next[0]?.customerId || "");
        }
      })
      .catch(() => {
        const next = fromLocalCustomers();
        if (alive) {
          setCustomers(next);
          setSelectedId(next[0]?.propertyId || next[0]?.customerId || "");
        }
      });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) =>
      `${customer.fullName} ${customer.email || ""} ${customer.phone || ""} ${customer.address}`.toLowerCase().includes(needle),
    );
  }, [customers, query]);

  const selected = customers.find((customer) => customer.propertyId === selectedId || customer.customerId === selectedId) || filtered[0] || customers[0];
  const safeAmount = Number(amount || 0);

  function send() {
    if (!selected) { setStatus("Choose a customer first."); return; }
    if (!serviceName.trim()) { setStatus("Service name is required."); return; }
    if (!message.trim()) { setStatus("Message is required."); return; }
    if (!sendPortal && !sendEmail) { setStatus("Choose at least one delivery method."); return; }
    sendCustomerServiceRecommendation({
      customerId: selected.customerId,
      propertyId: selected.propertyId,
      customerName: selected.fullName,
      email: selected.email,
      phone: selected.phone,
      address: selected.address,
      serviceName: serviceName.trim(),
      message: message.trim(),
      amount: Number.isFinite(safeAmount) ? safeAmount : 0,
      sendPortal,
      sendEmail,
    });
    setStatus(sendEmail ? "Recommendation saved. Portal notification is ready; email delivery needs the production email provider connection." : "Recommendation sent to the customer portal notifications.");
  }

  return (
    <AdminShell active="Recommend Service">
      <div className="app-top">
        <div>
          <span className="eyebrow">Customer Growth</span>
          <h1>Recommend Service</h1>
          <p className="section-intro">Pick a customer, write the service recommendation, set the value and choose where to send it.</p>
        </div>
        <Link className="btn btn-outline" href="/admin/customers">Customers</Link>
      </div>

      <section className="recommend-service-grid">
        <article className="card profile-card">
          <h2>Choose Customer</h2>
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email, phone or address" />
          <div className="customer-pick-list" role="listbox" aria-label="Customers">
            {filtered.length ? filtered.map((customer) => {
              const id = customer.propertyId || customer.customerId;
              return (
                <button key={id} type="button" className={selectedId === id ? "active" : ""} onClick={() => setSelectedId(id)}>
                  <strong>{customer.fullName}</strong>
                  <span>{customer.address}</span>
                  <small>{customer.email || customer.phone || "No contact saved"}</small>
                </button>
              );
            }) : <div className="empty-state">No customers match this search.</div>}
          </div>
        </article>

        <article className="card profile-card">
          <h2>Service Message</h2>
          <div className="form-grid">
            <label className="field">Service<input className="input" value={serviceName} onChange={(event) => setServiceName(event.target.value)} /></label>
            <label className="field">Recommended value<input className="input" type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          </div>
          <label className="field">Message<textarea className="input" value={message} onChange={(event) => setMessage(event.target.value)} /></label>
          <div className="recommend-preview">
            <span>Preview</span>
            <strong>{serviceName || "Recommended Service"} - ${Number.isFinite(safeAmount) ? safeAmount.toFixed(2) : "0.00"}</strong>
            <p>{message}</p>
            <small>{selected ? `To: ${selected.fullName} - ${selected.address}` : "Choose a customer"}</small>
          </div>
          <div className="send-methods">
            <label><input type="checkbox" checked={sendPortal} onChange={(event) => setSendPortal(event.target.checked)} /> Portal notification</label>
            <label><input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} /> Email</label>
          </div>
          <button className="btn btn-primary" onClick={send}>Send Recommendation</button>
          {status && <div className="payment-message">{status}</div>}
        </article>
      </section>
    </AdminShell>
  );
}
