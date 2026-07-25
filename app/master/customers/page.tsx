"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Company = { id: string; name: string; active: boolean };
type CustomerRow = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  acquisition_source?: string;
  assignment_status?: string;
  service_company_id?: string | null;
  originCompanyName: string;
  serviceCompanyName: string;
  platformManaged: boolean;
  property?: { id: string; address_line1: string; city: string; province: string; postal_code?: string | null } | null;
};
type CustomerDetail = { customer: any; properties: any[]; quotes: any[]; invoices: any[]; payments: any[]; companies: Company[] };

const ui = {
  page: { minHeight: "100vh", background: "#f4f7f5", color: "#17352d", padding: "24px" } as const,
  shell: { maxWidth: 1180, margin: "0 auto" } as const,
  top: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 22, flexWrap: "wrap" as const },
  back: { textDecoration: "none", color: "#0b5c43", fontWeight: 800 } as const,
  card: { background: "#fff", border: "1px solid #dce8e2", borderRadius: 18, padding: 20, boxShadow: "0 8px 24px rgba(23,53,45,.06)" } as const,
  label: { display: "block", fontWeight: 800, fontSize: 13, marginBottom: 7 } as const,
  input: { width: "100%", minHeight: 44, border: "1px solid #cfded7", borderRadius: 10, padding: "10px 12px", background: "#fff", color: "#17352d" } as const,
  button: { minHeight: 42, border: 0, borderRadius: 10, padding: "10px 15px", background: "#0b5c43", color: "#fff", fontWeight: 800, cursor: "pointer" } as const,
  secondary: { minHeight: 42, border: "1px solid #cfded7", borderRadius: 10, padding: "10px 15px", background: "#fff", color: "#17352d", fontWeight: 800, cursor: "pointer" } as const,
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 } as const,
};

async function accessToken() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your Master session expired. Sign in again.");
  return token;
}

export default function MasterCustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [propertyIndex, setPropertyIndex] = useState(0);
  const [transferCompany, setTransferCompany] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading customers...");

  async function loadDirectory() {
    setLoading(true);
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customers could not be loaded.");
      setCustomers((result.customers || []).sort((a: CustomerRow, b: CustomerRow) => a.full_name.localeCompare(b.full_name)));
      setCompanies(result.companies || []);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDirectory(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((customer) => `${customer.full_name} ${customer.email || ""} ${customer.phone || ""} ${customer.property?.address_line1 || ""} ${customer.property?.city || ""}`.toLowerCase().includes(q));
  }, [customers, search]);

  async function openCustomer(id: string) {
    setBusy(true);
    setSelectedId(id);
    setPickerOpen(false);
    setMessage("Opening customer...");
    try {
      const token = await accessToken();
      const response = await fetch(`/api/master/customers?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be opened.");
      setSelected(result);
      setPropertyIndex(0);
      setTransferCompany(result.customer.service_company_id || "");
      setTransferReason("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  function updateCustomer(field: string, value: unknown) {
    setSelected((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateProperty(field: string, value: unknown) {
    setSelected((current) => {
      if (!current) return current;
      return { ...current, properties: current.properties.map((property, index) => index === propertyIndex ? { ...property, [field]: value } : property) };
    });
  }

  async function saveAll() {
    if (!selected) return;
    const property = selected.properties[propertyIndex];
    if (!property) { setMessage("This customer has no property record."); return; }
    setBusy(true);
    setMessage("Saving...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "save",
          customerId: selected.customer.id,
          customer: { fullName: selected.customer.full_name, email: selected.customer.email, phone: selected.customer.phone || null, notes: selected.customer.notes || null },
          property: {
            propertyId: property.id,
            addressLine1: property.address_line1,
            city: property.city,
            province: property.province,
            postalCode: property.postal_code || null,
            lotSize: property.lot_size || null,
            grassHeight: property.grass_height || null,
            gate: Boolean(property.gate), dog: Boolean(property.dog), irrigation: Boolean(property.irrigation),
            accessNotes: property.access_notes || null,
            propertyNotes: property.property_notes || null,
            customerComment: property.customer_comment || null,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be saved.");
      setMessage(result.message || "Customer updated.");
      await loadDirectory();
      await openCustomer(selected.customer.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function transferCustomer() {
    if (!selected) return;
    setBusy(true);
    setMessage("Updating company...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "transfer", customerId: selected.customer.id, serviceCompanyId: transferCompany || null, reason: transferReason || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be moved.");
      setMessage(result.message || "Company updated.");
      await loadDirectory();
      await openCustomer(selected.customer.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer could not be moved.");
    } finally {
      setBusy(false);
    }
  }

  const currentRow = customers.find((customer) => customer.id === selectedId);
  const property = selected?.properties[propertyIndex];

  return <main style={ui.page}><div style={ui.shell}>
    <div style={ui.top}>
      <div><Link href="/master" style={ui.back}>← Master Control Plane</Link><h1 style={{ margin: "8px 0 4px", fontSize: 30 }}>Customers</h1><p style={{ margin: 0, color: "#587169" }}>Select any customer, search by name, then edit the profile and property.</p></div>
      <button style={ui.secondary} onClick={() => void loadDirectory()} disabled={loading}>Refresh</button>
    </div>

    {message && <div style={{ ...ui.card, marginBottom: 16, borderColor: "#bad7cb", background: "#eef8f4" }}>{message}</div>}

    <section style={{ ...ui.card, marginBottom: 18, position: "relative" }}>
      <label style={ui.label}>Customer</label>
      <button type="button" style={{ ...ui.input, display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", cursor: "pointer" }} onClick={() => setPickerOpen((open) => !open)}>
        <span>{currentRow ? `${currentRow.full_name}${currentRow.property?.address_line1 ? ` — ${currentRow.property.address_line1}` : ""}` : loading ? "Loading customers..." : "Select a customer"}</span><span>⌄</span>
      </button>
      {pickerOpen && <div style={{ position: "absolute", left: 20, right: 20, top: 86, zIndex: 40, background: "#fff", border: "1px solid #cfded7", borderRadius: 12, boxShadow: "0 18px 40px rgba(23,53,45,.18)", padding: 12 }}>
        <input autoFocus style={{ ...ui.input, marginBottom: 10 }} placeholder="Type a customer name, email or address" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div style={{ maxHeight: 340, overflowY: "auto", display: "grid", gap: 6 }}>
          {filtered.map((customer) => <button key={customer.id} type="button" onClick={() => void openCustomer(customer.id)} style={{ textAlign: "left", border: "1px solid #e1ebe6", borderRadius: 9, background: customer.id === selectedId ? "#eaf5f0" : "#fff", padding: "10px 12px", cursor: "pointer" }}>
            <strong style={{ display: "block" }}>{customer.full_name}</strong><small>{customer.email || customer.phone || "No contact"}{customer.property?.address_line1 ? ` · ${customer.property.address_line1}` : ""}</small>
          </button>)}
          {!filtered.length && <div style={{ padding: 12, color: "#587169" }}>No customer found.</div>}
        </div>
      </div>}
      <small style={{ display: "block", marginTop: 8, color: "#587169" }}>{customers.length.toLocaleString("en-CA")} customers available</small>
    </section>

    {!selected && <section style={ui.card}><strong>Select a customer above.</strong><p style={{ marginBottom: 0, color: "#587169" }}>The full profile will open here without loading a table with thousands of rows.</p></section>}

    {selected && <div style={{ display: "grid", gap: 18 }}>
      <section style={ui.card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><div><h2 style={{ margin: 0 }}>{selected.customer.full_name}</h2><small>{selected.customer.platform_managed || selected.customer.acquisition_source === "platform" ? "Platform-managed" : "Company-origin"}</small></div><button style={ui.button} onClick={() => void saveAll()} disabled={busy}>Save changes</button></div>
        <div style={{ ...ui.grid, marginTop: 18 }}>
          <label style={ui.label}>Name<input style={ui.input} value={selected.customer.full_name || ""} onChange={(event) => updateCustomer("full_name", event.target.value)} /></label>
          <label style={ui.label}>Email<input style={ui.input} type="email" value={selected.customer.email || ""} onChange={(event) => updateCustomer("email", event.target.value)} /></label>
          <label style={ui.label}>Phone<input style={ui.input} value={selected.customer.phone || ""} onChange={(event) => updateCustomer("phone", event.target.value)} /></label>
          <label style={{ ...ui.label, gridColumn: "1 / -1" }}>Customer notes<textarea style={{ ...ui.input, minHeight: 90 }} value={selected.customer.notes || ""} onChange={(event) => updateCustomer("notes", event.target.value)} /></label>
        </div>
      </section>

      <section style={ui.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}><h2 style={{ margin: 0 }}>Property</h2>{selected.properties.length > 1 && <select style={{ ...ui.input, width: 260 }} value={propertyIndex} onChange={(event) => setPropertyIndex(Number(event.target.value))}>{selected.properties.map((item, index) => <option key={item.id} value={index}>{item.address_line1 || `Property ${index + 1}`}</option>)}</select>}</div>
        {property ? <div style={{ ...ui.grid, marginTop: 18 }}>
          <label style={{ ...ui.label, gridColumn: "1 / -1" }}>Official address<input style={ui.input} value={property.address_line1 || ""} onChange={(event) => updateProperty("address_line1", event.target.value)} /></label>
          <label style={ui.label}>City<input style={ui.input} value={property.city || ""} onChange={(event) => updateProperty("city", event.target.value)} /></label>
          <label style={ui.label}>Province<input style={ui.input} value={property.province || ""} onChange={(event) => updateProperty("province", event.target.value)} /></label>
          <label style={ui.label}>Postal code<input style={ui.input} value={property.postal_code || ""} onChange={(event) => updateProperty("postal_code", event.target.value)} /></label>
          <label style={ui.label}>Lot size<select style={ui.input} value={property.lot_size || ""} onChange={(event) => updateProperty("lot_size", event.target.value || null)}><option value="">Not set</option><option value="xs">XS</option><option value="small">Small</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></label>
          <label style={ui.label}>Grass height<select style={ui.input} value={property.grass_height || ""} onChange={(event) => updateProperty("grass_height", event.target.value || null)}><option value="">Not set</option><option value="2in">2 in</option><option value="3in">3 in</option><option value="4in">4 in</option><option value="5in">5 in</option></select></label>
          <label style={{ ...ui.label, gridColumn: "1 / -1" }}>Access notes<textarea style={{ ...ui.input, minHeight: 80 }} value={property.access_notes || ""} onChange={(event) => updateProperty("access_notes", event.target.value)} /></label>
          <label style={{ ...ui.label, gridColumn: "1 / -1" }}>Property notes<textarea style={{ ...ui.input, minHeight: 80 }} value={property.property_notes || ""} onChange={(event) => updateProperty("property_notes", event.target.value)} /></label>
        </div> : <p>No property record found.</p>}
      </section>

      <section style={ui.card}>
        <h2 style={{ marginTop: 0 }}>Service company</h2>
        <div style={ui.grid}>
          <label style={ui.label}>Assigned company<select style={ui.input} value={transferCompany} onChange={(event) => setTransferCompany(event.target.value)}><option value="">Master assignment queue</option>{companies.filter((company) => company.active).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <label style={ui.label}>Reason<input style={ui.input} value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="Optional transfer note" /></label>
        </div>
        <button style={{ ...ui.button, marginTop: 14 }} disabled={busy} onClick={() => void transferCustomer()}>Update company</button>
      </section>
    </div>}
  </div></main>;
}
