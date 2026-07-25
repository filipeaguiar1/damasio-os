"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type RecordData = {
  customer: { id: string; full_name: string; phone: string | null; email: string; notes: string | null };
  property: {
    id: string; address_line1: string; city: string; province: string; postal_code: string | null;
    lot_size: string | null; grass_height: string | null; gate: boolean; dog: boolean; irrigation: boolean;
    access_notes: string | null; property_notes: string | null; customer_comment: string | null;
  };
};

async function token() {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session?.access_token) throw new Error("Your session expired. Sign in again.");
  return data.session.access_token;
}

export default function AdminCustomerEditor({ params }: { params: { id: string } }) {
  const [record, setRecord] = useState<RecordData | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const accessToken = await token();
      const response = await fetch(`/api/admin/customers/${params.id}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Customer profile could not be loaded.");
      setRecord(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Customer profile could not be loaded.");
    } finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [params.id]);

  async function save() {
    if (!record) return;
    setBusy(true); setMessage("Saving canonical customer and property records...");
    try {
      const accessToken = await token();
      const response = await fetch(`/api/admin/customers/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          customer: { fullName: record.customer.full_name, phone: record.customer.phone, email: record.customer.email, notes: record.customer.notes },
          property: {
            addressLine1: record.property.address_line1, city: record.property.city, province: record.property.province,
            postalCode: record.property.postal_code, lotSize: record.property.lot_size, grassHeight: record.property.grass_height,
            gate: record.property.gate, dog: record.property.dog, irrigation: record.property.irrigation,
            accessNotes: record.property.access_notes, propertyNotes: record.property.property_notes,
            customerComment: record.property.customer_comment,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Changes could not be saved.");
      setMessage("Saved. Customer, property, quotes, jobs and routes now use this canonical record.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Changes could not be saved."); }
    finally { setBusy(false); }
  }

  function customer(patch: Partial<RecordData["customer"]>) { if (record) setRecord({ ...record, customer: { ...record.customer, ...patch } }); }
  function property(patch: Partial<RecordData["property"]>) { if (record) setRecord({ ...record, property: { ...record.property, ...patch } }); }

  return <AdminShell active="Customers">
    <div className="app-top"><div><span className="eyebrow">Canonical Record</span><h1>Edit Customer & Property</h1><p className="section-intro">Admin/Master controls the customer identity and the primary property used across the workflow.</p></div><div className="toolbar-inline"><Link className="btn btn-outline" href={`/admin/customers/${params.id}`}>Open history</Link><Link className="btn btn-outline" href="/admin/customers">Back</Link><button className="btn btn-primary" disabled={busy || !record} onClick={() => void save()}>{busy ? "Saving..." : "Save all changes"}</button></div></div>
    {message && <div className="payment-message" style={{marginBottom:16}}>{message}</div>}
    {!record ? <section className="card profile-card"><h2>{busy ? "Loading..." : "Customer not found"}</h2></section> : <>
      <section className="card profile-card"><div className="table-head"><div><h2>Customer Profile</h2><p className="section-intro">Personal and account contact information.</p></div></div><div className="form-grid">
        <div className="field"><label>Full name</label><input className="input" value={record.customer.full_name || ""} onChange={e=>customer({full_name:e.target.value})}/></div>
        <div className="field"><label>Phone</label><input className="input" value={record.customer.phone || ""} onChange={e=>customer({phone:e.target.value})}/></div>
        <div className="field"><label>Email</label><input className="input" type="email" value={record.customer.email || ""} onChange={e=>customer({email:e.target.value})}/></div>
        <div className="field"><label>Customer notes</label><textarea className="input field-note" value={record.customer.notes || ""} onChange={e=>customer({notes:e.target.value})}/></div>
      </div></section>
      <section className="card profile-card"><div className="table-head"><div><h2>Primary Property</h2><p className="section-intro">This address is the source of truth for quotes, jobs, schedules, dispatch and routes.</p></div></div><div className="form-grid">
        <div className="field"><label>Street address</label><input className="input" value={record.property.address_line1 || ""} onChange={e=>property({address_line1:e.target.value})}/></div>
        <div className="field"><label>City</label><input className="input" value={record.property.city || ""} onChange={e=>property({city:e.target.value})}/></div>
        <div className="field"><label>Province</label><input className="input" value={record.property.province || ""} onChange={e=>property({province:e.target.value})}/></div>
        <div className="field"><label>Postal code</label><input className="input" value={record.property.postal_code || ""} onChange={e=>property({postal_code:e.target.value})}/></div>
        <div className="field"><label>Lot size</label><select className="input" value={record.property.lot_size || "small"} onChange={e=>property({lot_size:e.target.value})}><option value="xs">XS</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></div>
        <div className="field"><label>Grass height</label><select className="input" value={record.property.grass_height || "3in"} onChange={e=>property({grass_height:e.target.value})}><option value="2in">2 inches</option><option value="3in">3 inches</option><option value="4in">4 inches</option><option value="5in">5 inches</option></select></div>
        <div className="field"><label>Gate</label><select className="input" value={record.property.gate?"yes":"no"} onChange={e=>property({gate:e.target.value==="yes"})}><option value="no">No</option><option value="yes">Yes</option></select></div>
        <div className="field"><label>Dog</label><select className="input" value={record.property.dog?"yes":"no"} onChange={e=>property({dog:e.target.value==="yes"})}><option value="no">No</option><option value="yes">Yes</option></select></div>
        <div className="field"><label>Irrigation</label><select className="input" value={record.property.irrigation?"yes":"no"} onChange={e=>property({irrigation:e.target.value==="yes"})}><option value="no">No</option><option value="yes">Yes</option></select></div>
      </div><div className="field"><label>Access notes</label><textarea className="input field-note" value={record.property.access_notes || ""} onChange={e=>property({access_notes:e.target.value})}/></div><div className="field"><label>Admin property notes</label><textarea className="input field-note" value={record.property.property_notes || ""} onChange={e=>property({property_notes:e.target.value})}/></div><div className="field"><label>Customer comment</label><textarea className="input field-note" value={record.property.customer_comment || ""} onChange={e=>property({customer_comment:e.target.value})}/></div></section>
    </>}
  </AdminShell>;
}
