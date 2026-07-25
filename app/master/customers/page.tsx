"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

 type Company = { id: string; name: string; active: boolean };
 type CustomerRow = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
  acquisition_source?: string;
  assignment_status?: string;
  origin_company_id?: string | null;
  service_company_id?: string | null;
  originCompanyName: string;
  serviceCompanyName: string;
  platformManaged: boolean;
  property?: { id: string; address_line1: string; city: string; province: string; postal_code?: string | null; official_photo_url?: string | null } | null;
 };
 type CustomerDetail = {
  customer: any;
  properties: any[];
  quotes: any[];
  invoices: any[];
  payments: any[];
  companies: Company[];
 };

 function money(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value || 0));
 }

 async function token() {
  const supabase = getSupabaseBrowserClient() as any;
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your Master session expired. Sign in again.");
  return value;
 }

 export default function MasterCustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<CustomerDetail | null>(null);
  const [propertyIndex, setPropertyIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("all");
  const [assignment, setAssignment] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading platform customers...");
  const [transferCompany, setTransferCompany] = useState("");
  const [transferReason, setTransferReason] = useState("");

  async function loadDirectory() {
   setLoading(true);
   try {
    const accessToken = await token();
    const response = await fetch("/api/master/customers", { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Customers could not be loaded.");
    setCustomers(result.customers || []);
    setCompanies(result.companies || []);
    setMessage("");
   } catch (error) {
    setMessage(error instanceof Error ? error.message : "Customers could not be loaded.");
   } finally {
    setLoading(false);
   }
  }

  useEffect(() => { void loadDirectory(); }, []);

  const visible = useMemo(() => customers.filter((customer) => {
   const haystack = `${customer.full_name} ${customer.email || ""} ${customer.phone || ""} ${customer.property?.address_line1 || ""} ${customer.property?.city || ""} ${customer.originCompanyName} ${customer.serviceCompanyName}`.toLowerCase();
   if (query && !haystack.includes(query.toLowerCase())) return false;
   if (origin === "platform" && !customer.platformManaged) return false;
   if (origin === "company" && customer.platformManaged) return false;
   if (assignment !== "all" && customer.assignment_status !== assignment) return false;
   return true;
  }), [customers, query, origin, assignment]);

  async function openCustomer(customerId: string) {
   setBusy(true);
   setMessage("Opening customer record...");
   try {
    const accessToken = await token();
    const response = await fetch(`/api/master/customers?id=${encodeURIComponent(customerId)}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
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
    const properties = current.properties.map((property, index) => index === propertyIndex ? { ...property, [field]: value } : property);
    return { ...current, properties };
   });
  }

  async function saveAll() {
   if (!selected) return;
   const property = selected.properties[propertyIndex];
   if (!property) { setMessage("This customer has no property record to edit."); return; }
   setBusy(true);
   setMessage("Saving customer and property...");
   try {
    const accessToken = await token();
    const response = await fetch("/api/master/customers", {
     method: "PATCH",
     headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
     body: JSON.stringify({
      action: "save",
      customerId: selected.customer.id,
      customer: {
       fullName: selected.customer.full_name,
       email: selected.customer.email,
       phone: selected.customer.phone || null,
       notes: selected.customer.notes || null,
      },
      property: {
       propertyId: property.id,
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
   const targetName = companies.find((company) => company.id === transferCompany)?.name || "Master assignment queue";
   if (!window.confirm(`Move ${selected.customer.full_name} to ${targetName}? The commercial origin will be preserved.`)) return;
   setBusy(true);
   setMessage("Updating service company...");
   try {
    const accessToken = await token();
    const response = await fetch("/api/master/customers", {
     method: "PATCH",
     headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
     body: JSON.stringify({ action: "transfer", customerId: selected.customer.id, serviceCompanyId: transferCompany || null, reason: transferReason || null }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Customer could not be moved.");
    setMessage(result.message);
    await loadDirectory();
    await openCustomer(selected.customer.id);
   } catch (error) {
    setMessage(error instanceof Error ? error.message : "Customer could not be moved.");
   } finally {
    setBusy(false);
   }
  }

  async function signOut() {
   const supabase = getSupabaseBrowserClient() as any;
   await supabase.auth.signOut();
   router.replace("/login");
  }

  const property = selected?.properties[propertyIndex];

  return <main className="master-shell">
   <aside className="master-sidebar">
    <div><span className="master-kicker">CONTROL PLANE</span><h1>4Ever Seasons <b>Master</b></h1></div>
    <nav>
     <Link href="/master">Companies</Link>
     <button className="active">Customers <span>{customers.length}</span></button>
     <Link href="/master">Lead Center</Link>
     <Link href="/master">Quote Review</Link>
     <Link href="/master">Payouts</Link>
     <Link href="/master">Health Check</Link>
    </nav>
    <div className="master-user"><strong>Master</strong><small>Platform customer control</small><button onClick={signOut}>Sign out</button></div>
   </aside>

   <section className="master-content">
    {message && <div className="master-alert">{message}<button onClick={() => setMessage("")}>×</button></div>}
    <header className="master-header"><div><span className="master-kicker">PLATFORM CUSTOMER CONTROL</span><h2>Customers</h2><p>Edit every customer and property, preserve commercial origin, and move service responsibility without a new code or quote.</p></div><div className="master-summary"><b>{visible.length}</b><span>visible</span></div></header>

    <div className="master-toolbar">
     <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, address or company" />
     <select value={origin} onChange={(event) => setOrigin(event.target.value)}><option value="all">All origins</option><option value="platform">Platform customers</option><option value="company">Company-owned</option></select>
     <select value={assignment} onChange={(event) => setAssignment(event.target.value)}><option value="all">All assignments</option><option value="pending_payment">Pending payment</option><option value="ready_for_assignment">Ready for assignment</option><option value="assigned">Assigned</option><option value="paused">Paused</option></select>
     <button onClick={() => void loadDirectory()}>Refresh</button>
    </div>

    <div className="master-table-wrap"><table className="master-table"><thead><tr><th>Customer</th><th>Property</th><th>Origin</th><th>Service company</th><th>Status</th><th>Action</th></tr></thead><tbody>
     {loading && <tr><td colSpan={6}>Loading customers...</td></tr>}
     {!loading && visible.map((customer) => <tr key={customer.id}><td><strong>{customer.full_name}</strong><small>{customer.email || customer.phone || "No contact"}</small></td><td>{customer.property?.address_line1 || "No property"}<small>{[customer.property?.city, customer.property?.province].filter(Boolean).join(", ")}</small></td><td><span className="master-status">{customer.platformManaged ? "Platform" : "Company"}</span><small>{customer.originCompanyName}</small></td><td>{customer.serviceCompanyName}</td><td><span className="master-status">{String(customer.assignment_status || "unknown").replaceAll("_", " ")}</span></td><td><button className="master-inline-button" disabled={busy} onClick={() => void openCustomer(customer.id)}>Open / edit</button></td></tr>)}
    </tbody></table>{!loading && !visible.length && <div className="master-empty">No customers match these filters.</div>}</div>
   </section>

   {selected && <div className="master-modal-backdrop"><section className="master-modal master-customer-modal"><header><div><span className="master-kicker">MASTER EDITOR</span><h2>{selected.customer.full_name}</h2><p>{selected.customer.platform_managed || selected.customer.acquisition_source === "platform" ? "Platform-managed customer" : "Company-origin customer"}</p></div><button onClick={() => setSelected(null)}>×</button></header>
    <div className="master-customer-editor-grid">
     <section className="master-season-panel"><h3>Customer profile</h3><div className="form-grid"><label>Name<input value={selected.customer.full_name || ""} onChange={(event) => updateCustomer("full_name", event.target.value)} /></label><label>Email<input type="email" value={selected.customer.email || ""} onChange={(event) => updateCustomer("email", event.target.value)} /></label><label>Phone<input value={selected.customer.phone || ""} onChange={(event) => updateCustomer("phone", event.target.value)} /></label><label className="wide">Customer notes<textarea rows={4} value={selected.customer.notes || ""} onChange={(event) => updateCustomer("notes", event.target.value)} /></label></div></section>

     <section className="master-season-panel"><div className="master-season-save"><div><h3>Property profile</h3><small>{selected.properties.length} property record(s)</small></div>{selected.properties.length > 1 && <select value={propertyIndex} onChange={(event) => setPropertyIndex(Number(event.target.value))}>{selected.properties.map((item, index) => <option value={index} key={item.id}>{item.address_line1 || `Property ${index + 1}`}</option>)}</select>}</div>
      {property ? <div className="form-grid"><label className="wide">Primary address<input value={property.address_line1 || ""} onChange={(event) => updateProperty("address_line1", event.target.value)} /></label><label>City<input value={property.city || ""} onChange={(event) => updateProperty("city", event.target.value)} /></label><label>Province<input value={property.province || ""} onChange={(event) => updateProperty("province", event.target.value)} /></label><label>Postal code<input value={property.postal_code || ""} onChange={(event) => updateProperty("postal_code", event.target.value)} /></label><label>Lot size<select value={property.lot_size || ""} onChange={(event) => updateProperty("lot_size", event.target.value || null)}><option value="">Not set</option><option value="xs">XS</option><option value="small">Small</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></label><label>Grass height<select value={property.grass_height || ""} onChange={(event) => updateProperty("grass_height", event.target.value || null)}><option value="">Not set</option><option value="2in">2 in</option><option value="3in">3 in</option><option value="4in">4 in</option><option value="5in">5 in</option></select></label><label>Gate<select value={property.gate ? "yes" : "no"} onChange={(event) => updateProperty("gate", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label>Dog<select value={property.dog ? "yes" : "no"} onChange={(event) => updateProperty("dog", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label>Irrigation<select value={property.irrigation ? "yes" : "no"} onChange={(event) => updateProperty("irrigation", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label className="wide">Access notes<textarea rows={3} value={property.access_notes || ""} onChange={(event) => updateProperty("access_notes", event.target.value)} /></label><label className="wide">Admin property notes<textarea rows={3} value={property.property_notes || ""} onChange={(event) => updateProperty("property_notes", event.target.value)} /></label><label className="wide">Customer comment<textarea rows={3} value={property.customer_comment || ""} onChange={(event) => updateProperty("customer_comment", event.target.value)} /></label></div> : <div className="master-empty">No property is connected to this customer.</div>}
     </section>

     <section className="master-season-panel"><h3>Move service company</h3><p>Changing the service company does not erase the acquisition source, referral ownership, invoices or history.</p><div className="form-grid"><label>Service company<select value={transferCompany} onChange={(event) => setTransferCompany(event.target.value)}><option value="">Master assignment queue</option>{companies.filter((company) => company.active).map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label className="wide">Transfer reason<textarea rows={3} value={transferReason} placeholder="Reason recorded in the Master audit log" onChange={(event) => setTransferReason(event.target.value)} /></label></div><button className="master-inline-button" disabled={busy} onClick={() => void transferCustomer()}>{busy ? "Updating..." : "Move customer"}</button></section>

     <section className="master-season-panel"><h3>Financial and service history</h3><div className="master-payout-metrics"><article><span>Quotes</span><strong>{selected.quotes.length}</strong></article><article><span>Invoices</span><strong>{selected.invoices.length}</strong></article><article><span>Payments</span><strong>{selected.payments.length}</strong></article><article><span>Paid value</span><strong>{money(selected.payments.filter((item) => ["paid", "completed", "succeeded"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount || 0), 0))}</strong></article></div></section>
    </div>
    <footer className="master-season-save"><span>Master changes apply to the canonical Customer and Property records.</span><div className="row"><button onClick={() => setSelected(null)}>Close</button><button className="master-primary" disabled={busy || !property} onClick={() => void saveAll()}>{busy ? "Saving..." : "Save all changes"}</button></div></footer>
   </section></div>}
  </main>;
 }
