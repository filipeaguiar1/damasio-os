"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { EmployeePropertyPreview } from "@/components/master/EmployeePropertyPreview";
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
  offer_status?: string | null;
  offered_service_price?: number | null;
  property?: { id: string; address_line1: string; city: string; province: string; postal_code?: string | null; official_photo_url?: string | null } | null;
};
type Detail = { customer: any; properties: any[]; quotes: any[]; invoices: any[]; payments: any[]; companies: Company[] };
type ServicePlan = { serviceType: string; frequency: string; seasonStatus: string; operationalNotes: string };

const blankProperty = { id: "", address_line1: "", city: "", province: "ON", postal_code: "", lot_size: "", grass_height: "", gate: false, dog: false, irrigation: false, access_notes: "", property_notes: "", customer_comment: "", official_photo_url: "" };
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
  const provincePart = parts.find((part) => /\b(ON|Ontario|QC|Quebec|BC|AB|Alberta|MB|SK|NS|NB|PE|NL)\b/i.test(part)) || "ON";
  const map: Record<string, string> = { ontario: "ON", on: "ON", quebec: "QC", qc: "QC", alberta: "AB", ab: "AB", mb: "MB", sk: "SK", bc: "BC", ns: "NS", nb: "NB", pe: "PE", nl: "NL" };
  const cleanProvince = provincePart.replace(postal, "").trim();
  return { addressLine1: parts[0] || label, city: parts[1] || "", province: map[cleanProvince.toLowerCase()] || cleanProvince || "ON", postalCode: postal };
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
  const [offeredPrice, setOfferedPrice] = useState("");
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
      setOfferedPrice(result.customer.offered_service_price == null ? "" : String(result.customer.offered_service_price));
      setTransferReason(result.customer.last_transfer_reason || "");
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer could not be opened."); }
    finally { setBusy(false); }
  }

  function closeEditor(successMessage?: string) {
    setDetail(null);
    setSelectedId("");
    setPropertyIndex(0);
    setTransferCompany("");
    setTransferReason("");
    setOfferedPrice("");
    setServicePlan(blankPlan);
    setPreviewOpen(false);
    if (successMessage) setMessage(successMessage);
  }

  function updateCustomer(field: string, value: unknown) {
    setDetail((current) => current ? { ...current, customer: { ...current.customer, [field]: value } } : current);
  }

  function updateProperty(field: string, value: unknown) {
    setDetail((current) => current ? { ...current, properties: current.properties.map((property, index) => index === propertyIndex ? { ...property, [field]: value } : property) } : current);
  }

  async function save() {
    if (!detail) return;
    const property = detail.properties[propertyIndex] || blankProperty;
    setBusy(true);
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
      closeEditor(result.message || "Customer information saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer could not be saved."); }
    finally { setBusy(false); }
  }

  async function transfer() {
    if (!detail) return;
    const price = offeredPrice.trim() === "" ? null : Number(offeredPrice);
    if (transferCompany && (price == null || !Number.isFinite(price) || price < 0)) { setMessage("Enter a valid CAD service value before sending the offer."); return; }
    setBusy(true);
    try {
      const token = await accessToken();
      const response = await fetch("/api/master/customers", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "transfer", customerId: detail.customer.id, serviceCompanyId: transferCompany || null, offeredPrice: transferCompany ? price : null, reason: transferReason || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer offer could not be updated.");
      await loadDirectory();
      closeEditor(result.message || "Customer offer updated.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Customer offer could not be updated."); }
    finally { setBusy(false); }
  }

  const property = detail?.properties[propertyIndex] || null;

  return <main className="master-shell customer-master-shell">
    <aside className="master-sidebar customer-master-sidebar"><div><span className="master-kicker">CONTROL PLANE</span><h1>4Ever Seasons <b>Master</b></h1></div><nav><Link href="/master">Companies</Link><Link href="/master/customers" className="active">Customers <span>{customers.length}</span></Link><Link href="/master">Trash</Link><Link href="/master">Lead Center</Link><Link href="/master">Quote Review</Link><Link href="/master">Payouts</Link></nav></aside>
    <section className="master-content customer-master-content">
      {message && <div className="master-alert">{message}<button onClick={() => setMessage("")}>×</button></div>}
      <header className="master-header"><div><span className="master-kicker">CUSTOMER CONTROL</span><h2>Customers</h2><p>One canonical customer, property, service and company offer record.</p></div></header>

      <section className="customer-card picker-card"><div className="picker-title"><div><span>⌕</span><div><strong>Find a customer</strong><small>Results update while you type</small></div></div><b>{filtered.length} result{filtered.length === 1 ? "" : "s"}</b></div><div className="picker-grid"><div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone or address" />{search && <button type="button" onClick={() => setSearch("")}>×</button>}</div><select value={selectedId} onChange={(event) => void openCustomer(event.target.value)} disabled={busy}><option value="">Select a customer ({filtered.length})</option>{filtered.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name} — {fullAddress(customer.property)}</option>)}</select></div>{search && filtered.length === 1 && !detail && <button className="quick-result" type="button" onClick={() => void openCustomer(filtered[0].id)}><span><strong>{filtered[0].full_name}</strong><small>{fullAddress(filtered[0].property)}</small></span><b>Open ›</b></button>}</section>

      {!detail && <section className="customer-card empty-state"><span>◎</span><h3>Select a customer</h3><p>Customer, property, service plan and employee preview will appear here.</p></section>}

      {detail && <div className="customer-stack">
        <div className="editor-bar"><div><strong>{detail.customer.full_name}</strong><small>{fullAddress(property)}</small></div><div><button className="preview-btn" onClick={() => setPreviewOpen(true)}>▣ Employee preview</button><button className="close-btn" onClick={() => closeEditor()}>Close</button></div></div>

        <section className="customer-card"><div className="section-head"><span>01</span><div><small>CUSTOMER PROFILE</small><h3>{detail.customer.full_name}</h3></div><b>{detail.customer.offer_status || detail.customer.assignment_status || "Master hold"}</b></div><div className="form-grid"><label>Name<input value={detail.customer.full_name || ""} onChange={(event) => updateCustomer("full_name", event.target.value)} /></label><label>Email<input type="email" value={detail.customer.email || ""} onChange={(event) => updateCustomer("email", event.target.value)} /></label><label>Phone<input value={detail.customer.phone || ""} onChange={(event) => updateCustomer("phone", event.target.value)} /></label><label className="wide">Customer notes<textarea value={detail.customer.notes || ""} onChange={(event) => updateCustomer("notes", event.target.value)} /></label></div></section>

        <section className="customer-card"><div className="section-head"><span>02</span><div><small>PROPERTY</small><h3>{property?.address_line1 || "Property details"}</h3></div>{detail.properties.length > 1 && <select value={propertyIndex} onChange={(event) => { const index = Number(event.target.value); setPropertyIndex(index); setServicePlan(parseServicePlan(detail.properties[index]?.property_notes)); }}>{detail.properties.map((item, index) => <option key={item.id || index} value={index}>{item.address_line1 || `Property ${index + 1}`}</option>)}</select>}</div>{property && <div className="form-grid"><label className="wide">Full address<AddressAutocomplete value={property.address_line1 || ""} onChange={(value) => updateProperty("address_line1", value)} onSelect={(suggestion) => { const parsed = parseCanadianAddress(suggestion.label); updateProperty("address_line1", parsed.addressLine1); updateProperty("city", parsed.city); updateProperty("province", parsed.province); updateProperty("postal_code", parsed.postalCode); }} /></label><label>City<input value={property.city || ""} onChange={(event) => updateProperty("city", event.target.value)} /></label><label>Province<input value={property.province || "ON"} onChange={(event) => updateProperty("province", event.target.value)} /></label><label>Postal code<input value={property.postal_code || ""} onChange={(event) => updateProperty("postal_code", event.target.value)} /></label><label>Lawn size<select value={property.lot_size || ""} onChange={(event) => updateProperty("lot_size", event.target.value)}><option value="">Select size</option><option value="xs">Extra small</option><option value="small">Small</option><option value="legacy">Medium / standard</option><option value="oversize">Large / oversize</option></select></label><label>Mowing height<select value={property.grass_height || ""} onChange={(event) => updateProperty("grass_height", event.target.value)}><option value="">Not set</option><option value="2in">2 inches</option><option value="3in">3 inches</option><option value="4in">4 inches</option><option value="5in">5 inches</option></select></label><label>Gate<select value={property.gate ? "yes" : "no"} onChange={(event) => updateProperty("gate", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label>Dog<select value={property.dog ? "yes" : "no"} onChange={(event) => updateProperty("dog", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label>Irrigation<select value={property.irrigation ? "yes" : "no"} onChange={(event) => updateProperty("irrigation", event.target.value === "yes")}><option value="no">No</option><option value="yes">Yes</option></select></label><label className="wide">Worker access alert<textarea value={property.access_notes || ""} onChange={(event) => updateProperty("access_notes", event.target.value)} /></label></div>}</section>

        <section className="customer-card"><div className="section-head"><span>03</span><div><small>SERVICE PLAN</small><h3>Contract and visit settings</h3></div></div><div className="form-grid"><label>Service type<select value={servicePlan.serviceType} onChange={(event) => setServicePlan({ ...servicePlan, serviceType: event.target.value })}><option value="">Select service</option><option>Lawn mowing</option><option>Snow removal</option><option>Seasonal lawn care</option><option>Spring / fall cleanup</option><option>Property maintenance</option><option>Other</option></select></label><label>Frequency<select value={servicePlan.frequency} onChange={(event) => setServicePlan({ ...servicePlan, frequency: event.target.value })}><option value="">Select frequency</option><option>Weekly</option><option>Bi-weekly</option><option>Adaptive</option><option>One-time</option><option>On demand</option></select></label><label>Season status<select value={servicePlan.seasonStatus} onChange={(event) => setServicePlan({ ...servicePlan, seasonStatus: event.target.value })}><option value="">Select status</option><option>Active in season</option><option>Paused out of season</option><option>Year-round</option><option>On hold</option><option>Completed</option></select></label><label className="wide">Operational notes<textarea value={servicePlan.operationalNotes} onChange={(event) => setServicePlan({ ...servicePlan, operationalNotes: event.target.value })} /></label></div></section>

        <section className="customer-card offer-card"><div className="section-head"><span>04</span><div><small>SERVICE COMPANY OFFER</small><h3>Send, price and track acceptance</h3></div></div><div className="form-grid"><label>Company<select value={transferCompany} onChange={(event) => setTransferCompany(event.target.value)}><option value="">Master hold — choose later</option>{companies.filter((company) => company.active).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label>Company service value (CAD)<input type="number" min="0" step="0.01" value={offeredPrice} onChange={(event) => setOfferedPrice(event.target.value)} placeholder="50.00" disabled={!transferCompany} /></label><label className="wide">Offer note<input value={transferReason} onChange={(event) => setTransferReason(event.target.value)} placeholder="Optional note for the company Admin" /></label></div><div className="actions"><button className="secondary" disabled={busy} onClick={() => void transfer()}>{transferCompany ? "Send offer" : "Place on hold"}</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save all information"}</button></div><small className="save-note">The company must accept before this customer is released to Schedule, Dispatch and Route.</small></section>
      </div>}
    </section>

    <EmployeePropertyPreview open={previewOpen && Boolean(detail && property)} customerName={detail?.customer?.full_name || ""} address={fullAddress(property)} serviceType={servicePlan.serviceType} frequency={servicePlan.frequency} lawnSize={property?.lot_size || ""} mowingHeight={property?.grass_height || ""} hasGate={Boolean(property?.gate)} hasDog={Boolean(property?.dog)} hasIrrigation={Boolean(property?.irrigation)} accessNotes={property?.access_notes || ""} serviceNotes={servicePlan.operationalNotes || property?.customer_comment || ""} propertyPhotoUrl={property?.official_photo_url || null} onClose={() => setPreviewOpen(false)} />

    <style jsx global>{`
      .customer-master-content{max-width:1180px;min-width:0}.customer-card{background:#fff;border:1px solid #dce8e2;border-radius:20px;padding:24px;box-shadow:0 12px 34px rgba(15,55,42,.07)}.picker-card{margin-bottom:18px}.picker-title,.picker-title>div,.editor-bar,.editor-bar>div:last-child,.section-head,.actions{display:flex;align-items:center}.picker-title,.editor-bar,.section-head{justify-content:space-between;gap:14px}.picker-title>div{gap:11px}.picker-title>div>span,.section-head>span{width:40px;height:40px;border-radius:12px;background:#e8f3ee;color:#0b5c43;display:grid;place-items:center;font-weight:900}.picker-title small,.editor-bar small{display:block;color:#667a71}.picker-title b,.section-head>b{font-size:12px;background:#edf5f1;padding:7px 10px;border-radius:999px;color:#4f6b60}.picker-grid{display:grid;grid-template-columns:1fr 1.2fr;gap:12px;margin-top:14px}.search-field{display:grid;grid-template-columns:38px 1fr 38px;align-items:center;border:1px solid #c7d7cf;border-radius:12px;overflow:hidden}.search-field>span{display:grid;place-items:center}.search-field input,.search-field button{border:0;background:#fff;min-height:46px}.search-field input{width:100%;font:inherit}.picker-grid select,.form-grid input,.form-grid select,.form-grid textarea,.section-head select{width:100%;min-height:46px;border:1px solid #c7d7cf;border-radius:11px;padding:10px 12px;background:#fff;font:inherit;box-sizing:border-box}.quick-result{width:100%;margin-top:12px;border:1px solid #bcd8ca;background:#f3faf6;border-radius:14px;padding:13px 15px;display:flex;justify-content:space-between;text-align:left;cursor:pointer}.quick-result small{display:block;color:#61756c;margin-top:3px}.empty-state{text-align:center;padding:54px}.empty-state>span{display:grid;place-items:center;width:56px;height:56px;margin:auto;border-radius:18px;background:#edf5f1;color:#0b5c43;font-size:27px}.customer-stack{display:grid;gap:18px}.editor-bar>div:last-child{gap:8px}.preview-btn,.close-btn,.actions button{border-radius:11px;padding:10px 14px;font-weight:800;cursor:pointer}.preview-btn{border:1px solid #bcd8ca;background:#edf6f1;color:#0b5c43}.close-btn,.actions .secondary{border:1px solid #cad8d1;background:#fff}.section-head{align-items:flex-start;margin-bottom:20px}.section-head>div{flex:1}.section-head small{font-weight:900;letter-spacing:.09em;color:#527064}.section-head h3{margin:3px 0 0}.section-head select{max-width:260px}.form-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}.form-grid label{font-size:13px;font-weight:800;color:#31483f}.form-grid .wide{grid-column:1/-1}.form-grid textarea{min-height:92px;resize:vertical}.actions{justify-content:flex-end;gap:10px;margin-top:20px}.actions .primary{border:1px solid #0b5c43;background:#0b5c43;color:#fff}.save-note{display:block;text-align:right;color:#6d8178;margin-top:9px}.offer-card{border-color:#d6b25b;background:linear-gradient(180deg,#fffdf7,#fff)}.customer-card .address-autocomplete .input{width:100%;min-height:46px;border:1px solid #c7d7cf;border-radius:11px;padding:10px 12px;background:#fff;font:inherit;box-sizing:border-box}@media(max-width:820px){.customer-master-shell{display:block!important}.customer-master-sidebar{position:static!important;width:100%!important;min-height:auto!important;padding:16px!important}.customer-master-sidebar>div{display:none}.customer-master-sidebar nav{display:flex!important;gap:8px;overflow-x:auto}.customer-master-sidebar nav a{flex:0 0 auto;white-space:nowrap}.customer-master-content{width:100%!important;max-width:none!important;padding:16px!important}.picker-grid,.form-grid{grid-template-columns:1fr}.form-grid .wide{grid-column:auto}.customer-card{padding:16px;border-radius:16px}.editor-bar{align-items:flex-start;display:grid}.editor-bar>div:last-child{display:grid;grid-template-columns:1fr 1fr}.actions{display:grid;grid-template-columns:1fr}.actions button{width:100%}.save-note{text-align:left}.section-head{display:grid;grid-template-columns:auto 1fr}.section-head>b,.section-head>select{grid-column:1/-1;max-width:none}}
    `}</style>
  </main>;
}
