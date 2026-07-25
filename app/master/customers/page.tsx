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
type Detail = { customer: any; properties: any[]; quotes: any[]; invoices: any[]; payments: any[]; companies: Company[] };

const blankProperty = {
  id: "",
  address_line1: "",
  city: "",
  province: "ON",
  postal_code: "",
  lot_size: "",
  grass_height: "",
  gate: false,
  dog: false,
  irrigation: false,
  access_notes: "",
  property_notes: "",
  customer_comment: "",
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
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [propertyIndex, setPropertyIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading customers...");
  const [transferCompany, setTransferCompany] = useState("");
  const [transferReason, setTransferReason] = useState("");

  async function loadDirectory() {
    const token = await accessToken();
    const response = await fetch("/api/master/customers", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Customers could not be loaded.");
    setCustomers(result.customers || []);
    setCompanies(result.companies || []);
    setMessage("");
  }

  useEffect(() => { void loadDirectory().catch((error) => setMessage(error.message)); }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return customers.filter((customer) => {
      if (!needle) return true;
      return `${customer.full_name} ${customer.email || ""} ${customer.phone || ""} ${customer.property?.address_line1 || ""} ${customer.property?.city || ""}`.toLowerCase().includes(needle);
    });
  }, [customers, search]);

  async function openCustomer(id: string) {
    setSelectedId(id);
    if (!id) { setDetail(null); return; }
    setBusy(true);
    setMessage("Opening customer...");
    try {
      const token = await accessToken();
      const response = await fetch(`/api/master/customers?id=${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be opened.");
      if (!result.properties?.length) result.properties = [{ ...blankProperty }];
      setDetail(result);
      setPropertyIndex(0);
      setTransferCompany(result.customer.service_company_id || "");
      setTransferReason("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer could not be opened.");
    } finally { setBusy(false); }
  }

  function updateCustomer(field: string, value: unknown) {
    setDetail((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateProperty(field: string, value: unknown) {
    setDetail((current) => {
      if (!current) return current;
      const properties = current.properties.map((property, index) => index === propertyIndex ? { ...property, [field]: value } : property);
      return { ...current, properties };
    });
  }

  async function save() {
    if (!detail) return;
    const property = detail.properties[propertyIndex] || blankProperty;
    setBusy(true);
    setMessage("Saving customer and property...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "save",
          customerId: detail.customer.id,
          customer: { fullName: detail.customer.full_name, email: detail.customer.email, phone: detail.customer.phone || null, notes: detail.customer.notes || null },
          property: {
            propertyId: property.id || null,
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
      await openCustomer(detail.customer.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer could not be saved."); }
    finally { setBusy(false); }
  }

  async function transfer() {
    if (!detail) return;
    setBusy(true);
    setMessage("Updating service company...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "transfer", customerId: detail.customer.id, serviceCompanyId: transferCompany || null, reason: transferReason || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be moved.");
      setMessage(result.message || "Company updated.");
      await loadDirectory();
      await openCustomer(detail.customer.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer could not be moved."); }
    finally { setBusy(false); }
  }

  const property = detail?.properties[propertyIndex] || null;
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #dfe8e3", borderRadius: 18, padding: 20, boxShadow: "0 10px 30px rgba(15,55,42,.06)" };
  const input: React.CSSProperties = { width: "100%", minHeight: 44, border: "1px solid #cad8d1", borderRadius: 10, padding: "10px 12px", background: "#fff" };
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 };

  return <main className="master-shell">
    <aside className="master-sidebar">
      <div><span className="master-kicker">CONTROL PLANE</span><h1>4Ever Seasons <b>Master</b></h1></div>
      <nav><Link href="/master">Companies</Link><Link href="/master/customers" className="active">Customers <span>{customers.length}</span></Link><Link href="/master">Trash</Link><Link href="/master">Lead Center</Link><Link href="/master">Quote Review</Link><Link href="/master">Payouts</Link></nav>
    </aside>

    <section className="master-content" style={{ maxWidth: 1180 }}>
      {message && <div className="master-alert">{message}<button onClick={() => setMessage("")}>×</button></div>}
      <header className="master-header"><div><span className="master-kicker">CUSTOMER CONTROL</span><h2>Customers</h2><p>Select a customer, then edit the profile, property and service assignment in one clean workspace.</p></div></header>

      <section style={{ ...card, marginBottom: 18 }}>
        <label style={{ display: "block", fontWeight: 800, marginBottom: 8 }}>Find a customer</label>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(260px,2fr)", gap: 12 }}>
          <input style={input} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by name, email, phone or address" />
          <select style={input} value={selectedId} onChange={(event) => void openCustomer(event.target.value)} disabled={busy}>
            <option value="">Select a customer ({filtered.length} available)</option>
            {filtered.map((customer) => <option value={customer.id} key={customer.id}>{customer.full_name} — {customer.property?.address_line1 || customer.email || "No property yet"}</option>)}
          </select>
        </div>
      </section>

      {!detail && <section style={{ ...card, textAlign: "center", padding: 48 }}><h3 style={{ marginBottom: 8 }}>Choose a customer to begin</h3><p style={{ margin: 0, color: "#60746b" }}>The editor will open here without showing a large customer table.</p></section>}

      {detail && <div style={{ display: "grid", gap: 18 }}>
        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}><div><span className="master-kicker">CUSTOMER PROFILE</span><h3 style={{ margin: "4px 0" }}>{detail.customer.full_name}</h3><small>{detail.customer.platform_managed ? "Platform-managed" : "Company-origin"}</small></div><span className="master-status">{detail.customer.assignment_status?.replaceAll("_", " ") || "unassigned"}</span></div>
          <div style={grid}>
            <label>Name<input style={input} value={detail.customer.full_name || ""} onChange={(e) => updateCustomer("full_name", e.target.value)} /></label>
            <label>Email<input style={input} type="email" value={detail.customer.email || ""} onChange={(e) => updateCustomer("email", e.target.value)} /></label>
            <label>Phone<input style={input} value={detail.customer.phone || ""} onChange={(e) => updateCustomer("phone", e.target.value)} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Customer notes<textarea style={{ ...input, minHeight: 90 }} value={detail.customer.notes || ""} onChange={(e) => updateCustomer("notes", e.target.value)} /></label>
          </div>
        </section>

        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}><div><span className="master-kicker">PROPERTY</span><h3 style={{ margin: "4px 0" }}>{property?.id ? "Property record" : "Create property record"}</h3><small>{property?.id ? "Edit the operational property information." : "No property exists yet. Complete the fields below and save."}</small></div>{detail.properties.length > 1 && <select style={input} value={propertyIndex} onChange={(e) => setPropertyIndex(Number(e.target.value))}>{detail.properties.map((item, index) => <option key={item.id || index} value={index}>{item.address_line1 || `Property ${index + 1}`}</option>)}</select>}</div>
          {property && <div style={grid}>
            <label style={{ gridColumn: "1 / -1" }}>Address<input style={input} value={property.address_line1 || ""} onChange={(e) => updateProperty("address_line1", e.target.value)} placeholder="Street address" /></label>
            <label>City<input style={input} value={property.city || ""} onChange={(e) => updateProperty("city", e.target.value)} /></label>
            <label>Province<input style={input} value={property.province || "ON"} onChange={(e) => updateProperty("province", e.target.value)} /></label>
            <label>Postal code<input style={input} value={property.postal_code || ""} onChange={(e) => updateProperty("postal_code", e.target.value)} /></label>
            <label>Property / lawn size<select style={input} value={property.lot_size || ""} onChange={(e) => updateProperty("lot_size", e.target.value)}><option value="">Select size</option><option value="xs">Extra small</option><option value="small">Small</option><option value="legacy">Medium / standard</option><option value="oversize">Large / oversize</option></select></label>
            <label>Mowing height<select style={input} value={property.grass_height || ""} onChange={(e) => updateProperty("grass_height", e.target.value)}><option value="">Not set</option><option value="2in">2 inches</option><option value="3in">3 inches</option><option value="4in">4 inches</option><option value="5in">5 inches</option></select></label>
            <label>Gate<select style={input} value={property.gate ? "yes" : "no"} onChange={(e) => updateProperty("gate", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label>Dog on property<select style={input} value={property.dog ? "yes" : "no"} onChange={(e) => updateProperty("dog", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label>Irrigation<select style={input} value={property.irrigation ? "yes" : "no"} onChange={(e) => updateProperty("irrigation", e.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label>
            <label style={{ gridColumn: "1 / -1" }}>Contract / service plan<textarea style={{ ...input, minHeight: 80 }} value={property.property_notes || ""} onChange={(e) => updateProperty("property_notes", e.target.value)} placeholder="Example: Weekly lawn care, seasonal contract, snow removal only..." /></label>
            <label style={{ gridColumn: "1 / -1" }}>Worker alert / access note<textarea style={{ ...input, minHeight: 90, borderColor: "#e2a43b", background: "#fffaf0" }} value={property.access_notes || ""} onChange={(e) => updateProperty("access_notes", e.target.value)} placeholder="Important instructions shown to Admin and Employee before the visit" /></label>
            <label style={{ gridColumn: "1 / -1" }}>Customer property comment<textarea style={{ ...input, minHeight: 70 }} value={property.customer_comment || ""} onChange={(e) => updateProperty("customer_comment", e.target.value)} /></label>
          </div>}
        </section>

        <section style={card}>
          <span className="master-kicker">SERVICE COMPANY</span><h3 style={{ margin: "4px 0 16px" }}>Assignment</h3>
          <div style={grid}><label>Company<select style={input} value={transferCompany} onChange={(e) => setTransferCompany(e.target.value)}><option value="">Master assignment queue</option>{companies.filter((company) => company.active).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Transfer reason<input style={input} value={transferReason} onChange={(e) => setTransferReason(e.target.value)} placeholder="Optional internal reason" /></label></div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}><button className="master-inline-button" disabled={busy} onClick={() => void transfer()}>Update company</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save customer and property</button></div>
        </section>
      </div>}
    </section>
  </main>;
}
