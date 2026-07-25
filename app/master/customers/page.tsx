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

type ServicePlan = {
  serviceType: string;
  frequency: string;
  seasonStatus: string;
  operationalNotes: string;
};

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

function parseServicePlan(value?: string | null): ServicePlan {
  const text = String(value || "");
  const read = (label: string) => text.match(new RegExp(`^${label}:\\s*(.*)$`, "mi"))?.[1]?.trim() || "";
  const structured = /^(Service type|Frequency|Season status):/mi.test(text);
  return {
    serviceType: read("Service type"),
    frequency: read("Frequency"),
    seasonStatus: read("Season status"),
    operationalNotes: structured ? read("Operational notes") : text,
  };
}

function composeServicePlan(plan: ServicePlan) {
  return [
    `Service type: ${plan.serviceType || "Not set"}`,
    `Frequency: ${plan.frequency || "Not set"}`,
    `Season status: ${plan.seasonStatus || "Not set"}`,
    `Operational notes: ${plan.operationalNotes || "None"}`,
  ].join("\n");
}

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
  const [servicePlan, setServicePlan] = useState<ServicePlan>({ serviceType: "", frequency: "", seasonStatus: "", operationalNotes: "" });

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
    return customers.filter((customer) => !needle || `${customer.full_name} ${customer.email || ""} ${customer.phone || ""} ${customer.property?.address_line1 || ""} ${customer.property?.city || ""}`.toLowerCase().includes(needle));
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
      setServicePlan(parseServicePlan(result.properties[0]?.property_notes));
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

  function changeProperty(index: number) {
    setPropertyIndex(index);
    setServicePlan(parseServicePlan(detail?.properties[index]?.property_notes));
  }

  async function save() {
    if (!detail) return;
    const property = detail.properties[propertyIndex] || blankProperty;
    setBusy(true);
    setMessage("Saving customer, property and service plan...");
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
            gate: Boolean(property.gate),
            dog: Boolean(property.dog),
            irrigation: Boolean(property.irrigation),
            accessNotes: property.access_notes || null,
            propertyNotes: composeServicePlan(servicePlan),
            customerComment: property.customer_comment || null,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be saved.");
      await loadDirectory();
      await openCustomer(detail.customer.id);
      setMessage(result.message || "Customer, property and service plan saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer could not be saved.");
    } finally { setBusy(false); }
  }

  async function transfer() {
    if (!detail) return;
    setBusy(true);
    setMessage(transferCompany ? "Assigning service company..." : "Placing customer on Master hold...");
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "transfer", customerId: detail.customer.id, serviceCompanyId: transferCompany || null, reason: transferReason || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer assignment could not be updated.");
      await loadDirectory();
      await openCustomer(detail.customer.id);
      setMessage(result.message || "Assignment updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer assignment could not be updated.");
    } finally { setBusy(false); }
  }

  const property = detail?.properties[propertyIndex] || null;
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #dce8e2", borderRadius: 18, padding: 22, boxShadow: "0 12px 34px rgba(15,55,42,.07)" };
  const input: React.CSSProperties = { width: "100%", minHeight: 44, border: "1px solid #c7d7cf", borderRadius: 10, padding: "10px 12px", background: "#fff", font: "inherit" };
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 14 };

  return <main className="master-shell">
    <aside className="master-sidebar">
      <div><span className="master-kicker">CONTROL PLANE</span><h1>4Ever Seasons <b>Master</b></h1></div>
      <nav><Link href="/master">Companies</Link><Link href="/master/customers" className="active">Customers <span>{customers.length}</span></Link><Link href="/master">Trash</Link><Link href="/master">Lead Center</Link><Link href="/master">Quote Review</Link><Link href="/master">Payouts</Link></nav>
    </aside>

    <section className="master-content" style={{ maxWidth: 1180 }}>
      {message && <div className="master-alert">{message}<button onClick={() => setMessage("")}>×</button></div>}
      <header className="master-header"><div><span className="master-kicker">CUSTOMER CONTROL</span><h2>Customers</h2><p>Select a customer and maintain one connected operational record for Master, Admin and Employee.</p></div></header>

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

      {!detail && <section style={{ ...card, textAlign: "center", padding: 48 }}><h3 style={{ marginBottom: 8 }}>Choose a customer to begin</h3><p style={{ margin: 0, color: "#60746b" }}>Customer, property, service and assignment information will appear here.</p></section>}

      {detail && <div style={{ display: "grid", gap: 18 }}>
        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", marginBottom: 18 }}><div><span className="master-kicker">CUSTOMER PROFILE</span><h3 style={{ margin: "4px 0" }}>{detail.customer.full_name}</h3><small>{detail.customer.platform_managed ? "Platform-managed" : "Company-origin"}</small></div><span className="master-status">{detail.customer.service_company_id ? detail.customer.assignment_status?.replaceAll("_", " ") : "Master hold"}</span></div>
          <div style={grid}>
            <label>Name<input style={input} value={detail.customer.full_name || ""} onChange={(e) => updateCustomer("full_name", e.target.value)} /></label>
            <label>Email<input style={input} type="email" value={detail.customer.email || ""} onChange={(e) => updateCustomer("email", e.target.value)} /></label>
            <label>Phone<input style={input} value={detail.customer.phone || ""} onChange={(e) => updateCustomer("phone", e.target.value)} /></label>
            <label style={{ gridColumn: "1 / -1" }}>Customer notes<textarea style={{ ...input, minHeight: 88 }} value={detail.customer.notes || ""} onChange={(e) => updateCustomer("notes", e.target.value)} /></label>
          </div>
        </section>

        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 18 }}><div><span className="master-kicker">PROPERTY</span><h3 style={{ margin: "4px 0" }}>{property?.id ? property.address_line1 || "Property record" : "Create property record"}</h3><small>{property?.id ? "This record feeds Admin and Employee views." : "Complete the property information and save."}</small></div>{detail.properties.length > 1 && <select style={{ ...input, width: 260 }} value={propertyIndex} onChange={(e) => changeProperty(Number(e.target.value))}>{detail.properties.map((item, index) => <option key={item.id || index} value={index}>{item.address_line1 || `Property ${index + 1}`}</option>)}</select>}</div>
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
          </div>}
        </section>

        <section style={card}>
          <span className="master-kicker">SERVICE PLAN</span><h3 style={{ margin: "4px 0 16px" }}>Contract and visit settings</h3>
          <div style={grid}>
            <label>Service type<select style={input} value={servicePlan.serviceType} onChange={(e) => setServicePlan((v) => ({ ...v, serviceType: e.target.value }))}><option value="">Select service</option><option value="Lawn mowing">Lawn mowing</option><option value="Snow removal">Snow removal</option><option value="Seasonal lawn care">Seasonal lawn care</option><option value="Spring / fall cleanup">Spring / fall cleanup</option><option value="Property maintenance">Property maintenance</option><option value="Other">Other</option></select></label>
            <label>Frequency<select style={input} value={servicePlan.frequency} onChange={(e) => setServicePlan((v) => ({ ...v, frequency: e.target.value }))}><option value="">Select frequency</option><option value="Weekly">Weekly</option><option value="Bi-weekly">Bi-weekly</option><option value="Adaptive">Adaptive</option><option value="One-time">One-time</option><option value="On demand">On demand</option></select></label>
            <label>Season status<select style={input} value={servicePlan.seasonStatus} onChange={(e) => setServicePlan((v) => ({ ...v, seasonStatus: e.target.value }))}><option value="">Select status</option><option value="Active in season">Active in season</option><option value="Paused out of season">Paused out of season</option><option value="Year-round">Year-round</option><option value="On hold">On hold</option><option value="Completed">Completed</option></select></label>
            <label style={{ gridColumn: "1 / -1" }}>Operational service notes<textarea style={{ ...input, minHeight: 82 }} value={servicePlan.operationalNotes} onChange={(e) => setServicePlan((v) => ({ ...v, operationalNotes: e.target.value }))} placeholder="Contract details, preferred day, special scope or recurring instructions" /></label>
          </div>
        </section>

        <section style={{ ...card, borderColor: property?.access_notes ? "#e4a63b" : "#dce8e2" }}>
          <span className="master-kicker">VISIT INFORMATION</span><h3 style={{ margin: "4px 0 16px" }}>What Admin and Employee need to know</h3>
          <div style={grid}>
            <label style={{ gridColumn: "1 / -1" }}>Worker alert / access note<textarea style={{ ...input, minHeight: 92, borderColor: "#e2a43b", background: "#fffaf0" }} value={property?.access_notes || ""} onChange={(e) => updateProperty("access_notes", e.target.value)} placeholder="Gate code, dog warning, access route, fragile area or important visit instruction" /></label>
            <label style={{ gridColumn: "1 / -1" }}>Customer property comment<textarea style={{ ...input, minHeight: 72 }} value={property?.customer_comment || ""} onChange={(e) => updateProperty("customer_comment", e.target.value)} /></label>
          </div>
        </section>

        <section style={card}>
          <span className="master-kicker">SERVICE COMPANY</span><h3 style={{ margin: "4px 0 16px" }}>Assignment</h3>
          <div style={grid}><label>Company / hold queue<select style={input} value={transferCompany} onChange={(e) => setTransferCompany(e.target.value)}><option value="">Master hold — choose company later</option>{companies.filter((company) => company.active).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Assignment note<input style={input} value={transferReason} onChange={(e) => setTransferReason(e.target.value)} placeholder="Optional internal reason" /></label></div>
          <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 10, marginTop: 18 }}><button className="master-inline-button" disabled={busy} onClick={() => void transfer()}>{transferCompany ? "Assign company" : "Place on hold"}</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save all customer information</button></div>
        </section>
      </div>}
    </section>
  </main>;
}
