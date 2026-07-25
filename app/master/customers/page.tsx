"use client";

import Link from "next/link";
import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Company = { id: string; name: string; active: boolean };
type CustomerRow = {
  id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  service_company_id?: string | null;
  originCompanyName: string;
  serviceCompanyName: string;
  platformManaged: boolean;
  property?: { id: string; address_line1: string; city: string; province: string; postal_code?: string | null } | null;
};
type Detail = { customer: any; properties: any[]; quotes: any[]; invoices: any[]; payments: any[]; companies: Company[] };
type ServicePlan = { serviceType: string; frequency: string; seasonStatus: string; operationalNotes: string };

const blankProperty = { id: "", address_line1: "", city: "", province: "ON", postal_code: "", lot_size: "", grass_height: "", gate: false, dog: false, irrigation: false, access_notes: "", property_notes: "", customer_comment: "" };
const blankPlan: ServicePlan = { serviceType: "", frequency: "", seasonStatus: "", operationalNotes: "" };

function parseServicePlan(value?: string | null): ServicePlan {
  const text = String(value || "");
  const read = (label: string) => text.match(new RegExp(`^${label}:\\s*(.*)$`, "mi"))?.[1]?.trim() || "";
  const structured = /^(Service type|Frequency|Season status):/mi.test(text);
  return { serviceType: read("Service type"), frequency: read("Frequency"), seasonStatus: read("Season status"), operationalNotes: structured ? read("Operational notes") : text };
}

function composeServicePlan(plan: ServicePlan) {
  return [`Service type: ${plan.serviceType || "Not set"}`, `Frequency: ${plan.frequency || "Not set"}`, `Season status: ${plan.seasonStatus || "Not set"}`, `Operational notes: ${plan.operationalNotes || "None"}`].join("\n");
}

function parseCanadianAddress(label: string) {
  const parts = label.split(",").map((value) => value.trim()).filter(Boolean);
  const postal = label.match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i)?.[0]?.toUpperCase() || "";
  const provinceIndex = parts.findIndex((value) => /^(ON|Ontario|QC|Quebec|BC|Alberta|AB|Manitoba|MB|Saskatchewan|SK|Nova Scotia|NS|New Brunswick|NB|PE|Prince Edward Island|Newfoundland.*|NL)$/i.test(value.replace(postal, "").trim()));
  const provinceRaw = provinceIndex >= 0 ? parts[provinceIndex].replace(postal, "").trim() : "ON";
  const provinceMap: Record<string, string> = { ontario: "ON", on: "ON", quebec: "QC", qc: "QC", alberta: "AB", ab: "AB", manitoba: "MB", mb: "MB", saskatchewan: "SK", sk: "SK", "british columbia": "BC", bc: "BC", "nova scotia": "NS", ns: "NS", "new brunswick": "NB", nb: "NB", "prince edward island": "PE", pe: "PE", "newfoundland and labrador": "NL", nl: "NL" };
  return { addressLine1: parts[0] || label, city: parts[1] || "", province: provinceMap[provinceRaw.toLowerCase()] || provinceRaw || "ON", postalCode: postal };
}

function fullAddress(property: any) {
  return [property?.address_line1, property?.city, property?.province, property?.postal_code].filter(Boolean).join(", ") || "Address not set";
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
  const [servicePlan, setServicePlan] = useState<ServicePlan>(blankPlan);
  const [previewOpen, setPreviewOpen] = useState(false);

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
    return customers.filter((customer) => !needle || `${customer.full_name} ${customer.email || ""} ${customer.phone || ""} ${customer.property?.address_line1 || ""} ${customer.property?.city || ""} ${customer.property?.province || ""} ${customer.property?.postal_code || ""}`.toLowerCase().includes(needle));
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

  function runSearch() {
    if (!search.trim()) { setMessage(`${customers.length} customer${customers.length === 1 ? "" : "s"} available.`); return; }
    if (filtered.length === 1) { void openCustomer(filtered[0].id); return; }
    setMessage(filtered.length ? `${filtered.length} customers match your search. Choose one from the list.` : "No customer matches this search.");
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); runSearch(); }
  }

  function closeEditor(successMessage?: string) {
    setDetail(null);
    setSelectedId("");
    setPropertyIndex(0);
    setTransferCompany("");
    setTransferReason("");
    setServicePlan(blankPlan);
    setPreviewOpen(false);
    if (successMessage) setMessage(successMessage);
  }

  function updateCustomer(field: string, value: unknown) {
    setDetail((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateProperty(field: string, value: unknown) {
    setDetail((current) => {
      if (!current) return current;
      return { ...current, properties: current.properties.map((property, index) => index === propertyIndex ? { ...property, [field]: value } : property) };
    });
  }

  function changeProperty(index: number) {
    setPropertyIndex(index);
    setServicePlan(parseServicePlan(detail?.properties[index]?.property_notes));
  }

  function notifyAssignmentChanged() {
    window.dispatchEvent(new CustomEvent("damasio:company-customers-changed"));
    localStorage.setItem("damasio_company_customers_changed", String(Date.now()));
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
          property: { propertyId: property.id || null, addressLine1: property.address_line1, city: property.city, province: property.province, postalCode: property.postal_code || null, lotSize: property.lot_size || null, grassHeight: property.grass_height || null, gate: Boolean(property.gate), dog: Boolean(property.dog), irrigation: Boolean(property.irrigation), accessNotes: property.access_notes || null, propertyNotes: composeServicePlan(servicePlan), customerComment: property.customer_comment || null },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer could not be saved.");
      await loadDirectory();
      notifyAssignmentChanged();
      closeEditor(result.message || "Customer information saved.");
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
      notifyAssignmentChanged();
      closeEditor(result.message || "Assignment updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer assignment could not be updated.");
    } finally { setBusy(false); }
  }

  const property = detail?.properties[propertyIndex] || null;

  return <main className="master-shell customer-master-shell">
    <aside className="master-sidebar customer-master-sidebar">
      <div><span className="master-kicker">CONTROL PLANE</span><h1>4Ever Seasons <b>Master</b></h1></div>
      <nav><Link href="/master">Companies</Link><Link href="/master/customers" className="active">Customers <span>{customers.length}</span></Link><Link href="/master">Trash</Link><Link href="/master">Lead Center</Link><Link href="/master">Quote Review</Link><Link href="/master">Payouts</Link></nav>
    </aside>

    <section className="master-content customer-master-content">
      {message && <div className="master-alert">{message}<button onClick={() => setMessage("")}>×</button></div>}
      <header className="master-header customer-master-header"><div><span className="master-kicker">CUSTOMER CONTROL</span><h2>Customers</h2><p>Select a customer and maintain one connected operational record for Master, Admin and Employee.</p></div></header>

      <section className="customer-card customer-picker">
        <div className="picker-heading"><div><span className="section-icon">⌕</span><div><strong>Find a customer</strong><small>Search by name, contact or full address</small></div></div><span className="result-count">{filtered.length} result{filtered.length === 1 ? "" : "s"}</span></div>
        <div className="customer-picker-grid">
          <div className="search-box"><span aria-hidden="true">⌕</span><input className="customer-input" value={search} onKeyDown={handleSearchKey} onChange={(event) => setSearch(event.target.value)} placeholder="Type a name, email, phone or address"/><button type="button" onClick={runSearch}>Search</button></div>
          <select className="customer-input" value={selectedId} onChange={(event) => void openCustomer(event.target.value)} disabled={busy}><option value="">Select a customer ({filtered.length} available)</option>{filtered.map((customer) => <option value={customer.id} key={customer.id}>{customer.full_name} — {[customer.property?.address_line1, customer.property?.city, customer.property?.province, customer.property?.postal_code].filter(Boolean).join(", ") || customer.email || "No property yet"}</option>)}</select>
        </div>
      </section>

      {!detail && <section className="customer-card customer-empty"><div className="empty-icon">◎</div><h3>Choose a customer to begin</h3><p>Customer, property, service and assignment information will appear here.</p></section>}

      {detail && <div className="customer-stack">
        <div className="editor-toolbar"><div><strong>{detail.customer.full_name}</strong><span>{fullAddress(property)}</span></div><div><button className="preview-button" type="button" onClick={() => setPreviewOpen(true)}>▣ Employee preview</button><button className="close-button" type="button" onClick={() => closeEditor()}>Close</button></div></div>

        <section className="customer-card"><div className="customer-card-head"><div className="section-title"><span className="section-number">01</span><div><span className="master-kicker">CUSTOMER PROFILE</span><h3>{detail.customer.full_name}</h3><small>{detail.customer.platform_managed ? "Platform-managed customer" : "Company-origin customer"}</small></div></div><span className="master-status">{detail.customer.service_company_id ? detail.customer.assignment_status?.replaceAll("_", " ") : "Master hold"}</span></div><div className="customer-grid"><label><span>Name</span><input className="customer-input" value={detail.customer.full_name || ""} onChange={(event) => updateCustomer("full_name", event.target.value)}/></label><label><span>Email</span><input className="customer-input" type="email" value={detail.customer.email || ""} onChange={(event) => updateCustomer("email", event.target.value)}/></label><label><span>Phone</span><input className="customer-input" value={detail.customer.phone || ""} onChange={(event) => updateCustomer("phone", event.target.value)}/></label><label className="wide"><span>Customer notes</span><textarea className="customer-input textarea" value={detail.customer.notes || ""} onChange={(event) => updateCustomer("notes", event.target.value)}/></label></div></section>

        <section className="customer-card"><div className="customer-card-head"><div className="section-title"><span className="section-number">02</span><div><span className="master-kicker">PROPERTY</span><h3>{property?.id ? property.address_line1 || "Property record" : "Create property record"}</h3><small>{property?.id ? "This record feeds Admin and Employee views." : "Complete the property information and save."}</small></div></div>{detail.properties.length > 1 && <select className="customer-input property-select" value={propertyIndex} onChange={(event) => changeProperty(Number(event.target.value))}>{detail.properties.map((item, index) => <option key={item.id || index} value={index}>{item.address_line1 || `Property ${index + 1}`}</option>)}</select>}</div>{property && <div className="customer-grid"><label className="wide"><span>Full address</span><AddressAutocomplete value={property.address_line1 || ""} onChange={(value) => updateProperty("address_line1", value)} onSelect={(suggestion) => { const parsed = parseCanadianAddress(suggestion.label); updateProperty("address_line1", parsed.addressLine1); if (parsed.city) updateProperty("city", parsed.city); if (parsed.province) updateProperty("province", parsed.province); if (parsed.postalCode) updateProperty("postal_code", parsed.postalCode); }} placeholder="Start typing the full property address"/></label><label><span>City</span><input className="customer-input" value={property.city || ""} onChange={(event) => updateProperty("city", event.target.value)}/></label><label><span>Province</span><input className="customer-input" value={property.province || "ON"} onChange={(event) => updateProperty("province", event.target.value)}/></label><label><span>Postal code</span><input className="customer-input" value={property.postal_code || ""} onChange={(event) => updateProperty("postal_code", event.target.value)}/></label><label><span>Property / lawn size</span><select className="customer-input" value={property.lot_size || ""} onChange={(event) => updateProperty("lot_size", event.target.value)}><option value="">Select size</option><option value="xs">Extra small</option><option value="small">Small</option><option value="legacy">Medium / standard</option><option value="oversize">Large / oversize</option></select></label><label><span>Mowing height</span><select className="customer-input" value={property.grass_height || ""} onChange={(event) => updateProperty("grass_height", event.target.value)}><option value="">Not set</option><option value="2in">2 inches</option><option value="3in">3 inches</option><option value="4in">4 inches</option><option value="5in">5 inches</option></select></label><label><span>Gate</span><select className="customer-input" value={property.gate ? "yes" : "no"} onChange={(event) => updateProperty("gate", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label><span>Dog on property</span><select className="customer-input" value={property.dog ? "yes" : "no"} onChange={(event) => updateProperty("dog", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label><span>Irrigation</span><select className="customer-input" value={property.irrigation ? "yes" : "no"} onChange={(event) => updateProperty("irrigation", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label></div>}</section>

        <section className="customer-card"><div className="section-title"><span className="section-number">03</span><div><span className="master-kicker">SERVICE PLAN</span><h3>Contract and visit settings</h3></div></div><div className="customer-grid"><label><span>Service type</span><select className="customer-input" value={servicePlan.serviceType} onChange={(event) => setServicePlan((value) => ({ ...value, serviceType: event.target.value }))}><option value="">Select service</option><option>Lawn mowing</option><option>Snow removal</option><option>Seasonal lawn care</option><option>Spring / fall cleanup</option><option>Property maintenance</option><option>Other</option></select></label><label><span>Frequency</span><select className="customer-input" value={servicePlan.frequency} onChange={(event) => setServicePlan((value) => ({ ...value, frequency: event.target.value }))}><option value="">Select frequency</option><option>Weekly</option><option>Bi-weekly</option><option>Adaptive</option><option>One-time</option><option>On demand</option></select></label><label><span>Season status</span><select className="customer-input" value={servicePlan.seasonStatus} onChange={(event) => setServicePlan((value) => ({ ...value, seasonStatus: event.target.value }))}><option value="">Select status</option><option>Active in season</option><option>Paused out of season</option><option>Year-round</option><option>On hold</option><option>Completed</option></select></label><label className="wide"><span>Operational service notes</span><textarea className="customer-input textarea" value={servicePlan.operationalNotes} onChange={(event) => setServicePlan((value) => ({ ...value, operationalNotes: event.target.value }))}/></label></div></section>

        <section className="customer-card customer-alert-card"><div className="section-title"><span className="section-number warning">!</span><div><span className="master-kicker">VISIT INFORMATION</span><h3>What Admin and Employee need to know</h3></div></div><div className="customer-grid"><label className="wide"><span>Worker alert / access note</span><textarea className="customer-input textarea alert-input" value={property?.access_notes || ""} onChange={(event) => updateProperty("access_notes", event.target.value)} placeholder="Gate code, dog warning, access route or important visit instruction"/></label><label className="wide"><span>Customer property comment</span><textarea className="customer-input textarea" value={property?.customer_comment || ""} onChange={(event) => updateProperty("customer_comment", event.target.value)}/></label></div></section>

        <section className="customer-card"><div className="section-title"><span className="section-number">04</span><div><span className="master-kicker">SERVICE COMPANY</span><h3>Assignment</h3></div></div><div className="customer-grid"><label><span>Company / hold queue</span><select className="customer-input" value={transferCompany} onChange={(event) => setTransferCompany(event.target.value)}><option value="">Master hold — choose company later</option>{companies.filter((company) => company.active).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label><span>Assignment note</span><input className="customer-input" value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="Optional internal reason"/></label></div><div className="customer-actions"><button className="master-inline-button" disabled={busy} onClick={() => void transfer()}>{transferCompany ? "Assign company" : "Place on hold"}</button><button className="btn btn-primary save-button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save all information"}</button></div><small className="save-hint">After a successful save, this editor closes automatically.</small></section>
      </div>}
    </section>

    {previewOpen && detail && property && <div className="employee-preview-backdrop" onMouseDown={() => setPreviewOpen(false)}><section className="employee-preview" onMouseDown={(event) => event.stopPropagation()}><header><div><span>EMPLOYEE VIEW PREVIEW</span><h2>{detail.customer.full_name}</h2><p>{fullAddress(property)}</p></div><button onClick={() => setPreviewOpen(false)}>×</button></header><div className="preview-status"><span>{servicePlan.serviceType || "Service not set"}</span><b>{servicePlan.frequency || "Frequency not set"}</b></div><div className="preview-grid"><article><small>PROPERTY</small><strong>{property.lot_size ? String(property.lot_size).replace("legacy", "Medium / standard") : "Size not set"}</strong><span>Mowing height: {property.grass_height || "Not set"}</span></article><article><small>ACCESS</small><strong>{property.gate ? "Gate" : "No gate"} · {property.dog ? "Dog on property" : "No dog noted"}</strong><span>{property.irrigation ? "Irrigation present" : "No irrigation noted"}</span></article></div><article className="preview-alert"><small>IMPORTANT BEFORE START</small><strong>{property.access_notes || "No special access alert."}</strong></article><article className="preview-notes"><small>SERVICE NOTES</small><p>{servicePlan.operationalNotes || property.customer_comment || "No additional instructions."}</p></article><footer><button onClick={() => setPreviewOpen(false)}>Close preview</button></footer></section></div>}

    <style jsx global>{`
      .customer-master-content{max-width:1180px;min-width:0}.customer-card{background:#fff;border:1px solid #dce8e2;border-radius:20px;padding:24px;box-shadow:0 12px 34px rgba(15,55,42,.07)}.customer-picker{margin-bottom:18px}.customer-picker-grid{display:grid;grid-template-columns:minmax(260px,1fr) minmax(300px,1.45fr);gap:12px}.picker-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}.picker-heading>div{display:flex;align-items:center;gap:11px}.picker-heading strong{display:block;font-size:17px}.picker-heading small{display:block;color:#60746b;margin-top:2px}.section-icon{width:38px;height:38px;border-radius:12px;background:#e8f3ee;color:#0b5c43;display:grid;place-items:center;font-size:22px;font-weight:900}.result-count{font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:#527064;background:#edf5f1;padding:7px 10px;border-radius:999px}.search-box{position:relative;display:grid;grid-template-columns:38px 1fr auto;align-items:center;border:1px solid #c7d7cf;border-radius:12px;background:#fff;overflow:hidden}.search-box>span{display:grid;place-items:center;color:#597168;font-size:18px}.search-box .customer-input{border:0;border-radius:0;padding-left:0}.search-box button{height:100%;border:0;border-left:1px solid #dce8e2;background:#0b5c43;color:#fff;font-weight:850;padding:0 16px;cursor:pointer}.customer-stack{display:grid;gap:18px}.editor-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:4px 2px}.editor-toolbar>div:first-child strong,.editor-toolbar>div:first-child span{display:block}.editor-toolbar>div:first-child strong{font-size:18px}.editor-toolbar>div:first-child span{font-size:13px;color:#60746b;margin-top:3px}.editor-toolbar>div:last-child{display:flex;gap:8px}.preview-button,.close-button{border:1px solid #c8d8d0;border-radius:10px;padding:9px 12px;background:#fff;font-weight:800;cursor:pointer}.preview-button{color:#0b5c43;background:#edf6f1;border-color:#bcd8ca}.customer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}.customer-grid label{min-width:0;color:#31483f;font-size:13px;font-weight:800}.customer-grid label>span{display:block;margin-bottom:7px}.customer-grid .wide{grid-column:1/-1}.customer-input{width:100%;min-height:46px;border:1px solid #c7d7cf;border-radius:11px;padding:10px 12px;background:#fff;font:inherit;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}.customer-input:focus{outline:0;border-color:#2c8064;box-shadow:0 0 0 3px rgba(44,128,100,.12)}.textarea{min-height:92px;resize:vertical}.alert-input{border-color:#e2a43b;background:#fffaf0}.customer-alert-card{border-color:#e4a63b;background:linear-gradient(180deg,#fffdf8,#fff)}.customer-card-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.customer-card h3{margin:3px 0 18px;font-size:20px}.customer-card-head h3,.section-title h3{margin:3px 0 0}.section-title{display:flex;align-items:flex-start;gap:12px;margin-bottom:20px}.section-number{width:34px;height:34px;flex:0 0 34px;border-radius:11px;background:#e9f4ef;color:#0b5c43;display:grid;place-items:center;font-size:12px;font-weight:950}.section-number.warning{background:#fff0cf;color:#9b6400}.customer-empty{text-align:center;padding:54px}.customer-empty p{margin:0;color:#60746b}.empty-icon{width:54px;height:54px;margin:0 auto 12px;border-radius:18px;background:#edf5f1;color:#0b5c43;display:grid;place-items:center;font-size:27px}.property-select{max-width:260px}.customer-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:20px}.save-button{min-width:180px}.save-hint{display:block;text-align:right;color:#6d8178;margin-top:9px}.customer-card .address-autocomplete .input{width:100%;min-height:46px;border:1px solid #c7d7cf;border-radius:11px;padding:10px 12px;background:#fff;font:inherit;box-sizing:border-box}.employee-preview-backdrop{position:fixed;inset:0;z-index:500;background:rgba(3,20,14,.64);display:grid;place-items:center;padding:20px}.employee-preview{width:min(520px,100%);max-height:92vh;overflow:auto;background:#f3f7f5;border-radius:24px;box-shadow:0 30px 90px rgba(0,0,0,.35)}.employee-preview header{padding:24px;background:linear-gradient(145deg,#073f30,#0b684c);color:#fff;display:flex;justify-content:space-between;gap:12px}.employee-preview header span{font-size:11px;font-weight:900;letter-spacing:.12em;color:#a8dbc8}.employee-preview header h2{margin:5px 0 3px;font-size:27px}.employee-preview header p{margin:0;color:#d6eee5}.employee-preview header button{border:0;background:rgba(255,255,255,.14);color:#fff;width:38px;height:38px;border-radius:12px;font-size:23px;cursor:pointer}.preview-status{display:flex;justify-content:space-between;gap:10px;padding:15px 20px;background:#dff1e9;color:#0b5c43;font-weight:900}.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px}.preview-grid article,.preview-alert,.preview-notes{background:#fff;border:1px solid #dce8e2;border-radius:16px;padding:16px}.preview-grid small,.preview-alert small,.preview-notes small{display:block;font-size:10px;font-weight:950;letter-spacing:.1em;color:#698077;margin-bottom:7px}.preview-grid strong,.preview-grid span{display:block}.preview-grid span{font-size:13px;color:#5d7168;margin-top:6px}.preview-alert{margin:0 18px 12px;border-color:#e1a23c;background:#fff9eb}.preview-alert strong{color:#754b00}.preview-notes{margin:0 18px 18px}.preview-notes p{margin:0;color:#40564d}.employee-preview footer{padding:0 18px 18px}.employee-preview footer button{width:100%;min-height:46px;border:0;border-radius:12px;background:#0b5c43;color:#fff;font-weight:900;cursor:pointer}
      @media(max-width:820px){.customer-master-shell{display:block!important;min-height:100vh}.customer-master-sidebar{position:static!important;width:100%!important;min-height:auto!important;padding:16px!important}.customer-master-sidebar>div{display:none}.customer-master-sidebar nav{display:flex!important;gap:8px;overflow-x:auto;padding-bottom:4px}.customer-master-sidebar nav a,.customer-master-sidebar nav button{flex:0 0 auto;white-space:nowrap;min-height:40px;padding:9px 12px!important}.customer-master-content{width:100%!important;max-width:none!important;padding:16px!important;overflow:visible!important}.customer-master-header h2{font-size:32px}.customer-picker-grid,.customer-grid,.preview-grid{grid-template-columns:1fr}.customer-grid .wide{grid-column:auto}.customer-card{padding:16px;border-radius:16px}.customer-card-head,.editor-toolbar{display:grid}.editor-toolbar>div:last-child{display:grid;grid-template-columns:1fr 1fr}.property-select{max-width:none}.customer-actions{display:grid;grid-template-columns:1fr}.customer-actions button{width:100%;min-height:48px}.customer-empty{padding:34px 18px}.address-suggestions{max-width:calc(100vw - 64px)}.picker-heading{align-items:flex-start}.search-box{grid-template-columns:34px 1fr}.search-box button{grid-column:1/-1;min-height:42px;border-left:0;border-top:1px solid #dce8e2}.save-hint{text-align:center}.employee-preview-backdrop{padding:10px}.employee-preview{border-radius:19px}.preview-status{display:grid}}
    `}</style>
  </main>;
}
