"use client";

import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { GrassHandling, LawnSize, GrassHeight } from "@/lib/storage";
import { addCustomerWithProperty } from "@/lib/services/customerPropertyService";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {uploadPropertyProfilePhoto} from "@/lib/services/propertyPhotoService";

export default function AddClientPage(){
  const [form,setForm]=useState({
    name:"",phone:"",email:"",address:"",
    service:"Weekly Lawn Care",
    subtotal:"45",
    tax:"5.85",
    total:"50.85",
    notes:"",
    lawnSize:"small" as LawnSize,
    grassHeight:"3in" as GrassHeight,
    grassHandling:"mulched" as GrassHandling,
    backyard:"yes",
    gated:"no",
    adminNotes:"",
    propertyAlerts:"",
    accessNotes:""
  });
  const [message,setMessage]=useState("");
  const [sendInvite,setSendInvite]=useState(true);
  const [propertyPhoto,setPropertyPhotoFile]=useState<File|null>(null);
  const [propertyPhotoPreview,setPropertyPhotoPreview]=useState("");

  function updatePrice(subtotalValue:string){
    const subtotal=Number(subtotalValue||0);
    const tax=Math.round(subtotal*0.13*100)/100;
    const total=Math.round((subtotal+tax)*100)/100;
    setForm({...form,subtotal:subtotalValue,tax:String(tax),total:String(total)});
  }

  async function submit(){
    setMessage("Saving to Supabase...");
    try {
      const record=await addCustomerWithProperty({
        fullName: form.name,
        phone: form.phone,
        email: form.email,
        customerNotes: form.notes,
        addressLine1: form.address,
        lotSize: form.lawnSize === "legacy" || form.lawnSize === "oversize" || form.lawnSize === "xs" || form.lawnSize === "small" ? form.lawnSize : "small",
        grassHeight: form.grassHeight,
        gate: form.gated === "yes",
        accessNotes: form.accessNotes,
        propertyNotes: [form.adminNotes, form.propertyAlerts, `Grass handling: ${form.grassHandling}`].filter(Boolean).join(" | "),
        serviceName:form.service,
        frequency:form.service.includes("Biweekly")?"biweekly":form.service.includes("Weekly")?"weekly":form.service.includes("Monthly")?"monthly":"one_time",
        subtotal:Number(form.subtotal||0),
      });
      if(propertyPhoto)await uploadPropertyProfilePhoto(record.propertyId,propertyPhoto);
      if(sendInvite&&form.email&&isSupabaseConfigured()){
        const supabase=getSupabaseBrowserClient() as any;const{data:session}=await supabase.auth.getSession();const token=session.session?.access_token;
        if(!token)throw new Error("Client was saved, but your session expired before the invitation was sent.");
        const response=await fetch("/api/admin/users",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({fullName:form.name,email:form.email,phone:form.phone,role:"customer"})});
        const result=await response.json();if(!response.ok)throw new Error(`Client, property and service were saved, but the invitation failed: ${result.error||"unknown error"}`);
        setMessage(`Client, property, service and price saved across the platform. Invitation sent to ${form.email}.`);
      }else setMessage("Client, property, service and price saved across Customers, Dispatch, Visits and Payments.");
    } catch (error) {
      setMessage(error instanceof Error ? `Action needed: ${error.message}` : "Could not save client.");
    }
  }

  return <AdminShell active="Add Client">
    <div className="app-top"><div><span className="eyebrow">CUSTOMER & PROPERTY</span><h1>Add Customer</h1><p className="section-intro">One synchronized record for the customer, property, service, price and official house photo.</p></div></div>
    <div className="card profile-card">
      <div className="add-form">
        <h2>Customer</h2>
        <div className="form-grid">
          <div className="field"><label>Name</label><input className="input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div>
          <div className="field"><label>Phone</label><input className="input" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div>
          <div className="field"><label>Email</label><input className="input" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div>
          <div className="field"><label>Address</label><AddressAutocomplete value={form.address} onChange={address=>setForm({...form,address})} ariaLabel="Customer address"/></div>
        </div>

        <h2>Property Profile Photo</h2>
        <div className="property-profile-uploader"><div>{propertyPhotoPreview?<img src={propertyPhotoPreview} alt="Property profile preview"/>:<span>⌂</span>}</div><label><strong>Choose the official house photo</strong><small>This is the only image used as the property profile. Service photos stay in visit history.</small><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{const file=event.target.files?.[0]||null;setPropertyPhotoFile(file);setPropertyPhotoPreview(file?URL.createObjectURL(file):"")}}/></label></div>

        <h2>Property Preferences</h2>
        <div className="form-grid">
          <div className="field"><label>Lawn Size</label><select className="input" value={form.lawnSize} onChange={e=>setForm({...form,lawnSize:e.target.value as LawnSize})}><option value="xs">XS</option><option value="small">Small</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></div>
          <div className="field"><label>Grass Height</label><select className="input" value={form.grassHeight} onChange={e=>setForm({...form,grassHeight:e.target.value as GrassHeight})}><option value="2in">2&quot;</option><option value="3in">3&quot;</option><option value="4in">4&quot;</option><option value="5in">5&quot;</option></select></div>
          <div className="field"><label>Grass Handling</label><select className="input" value={form.grassHandling} onChange={e=>setForm({...form,grassHandling:e.target.value as GrassHandling})}><option value="mulched">Mulched</option><option value="bag_green_bin">Bag to green bin</option><option value="bag_leave_property">Bag and leave on property</option><option value="no_preference">No preference</option></select></div>
          <div className="field"><label>Backyard</label><select className="input" value={form.backyard} onChange={e=>setForm({...form,backyard:e.target.value})}><option value="yes">Yes</option><option value="no">No</option></select></div>
          <div className="field"><label>Gated</label><select className="input" value={form.gated} onChange={e=>setForm({...form,gated:e.target.value})}><option value="yes">Yes</option><option value="no">No</option></select></div>
        </div>

        <h2>Service</h2>
        <div className="form-grid">
          <div className="field"><label>Service</label><select className="input" value={form.service} onChange={e=>setForm({...form,service:e.target.value})}><option>Weekly Lawn Care</option><option>Biweekly Lawn Care</option><option>Spring Cleanup</option><option>Fall Cleanup</option><option>Snow Removal</option><option>Extra Service Request</option></select></div>
          <div className="field"><label>Subtotal</label><input className="input" type="number" value={form.subtotal} onChange={e=>updatePrice(e.target.value)}/></div>
          <div className="field"><label>HST</label><input className="input" value={form.tax} onChange={e=>setForm({...form,tax:e.target.value})}/></div>
          <div className="field"><label>Total</label><input className="input" value={form.total} onChange={e=>setForm({...form,total:e.target.value})}/></div>
        </div>

        <h2>Admin Notes</h2>
        <div className="field"><label>Access Notes</label><textarea className="input" value={form.accessNotes} onChange={e=>setForm({...form,accessNotes:e.target.value})}/></div>
        <div className="field"><label>Property Alerts</label><textarea className="input" value={form.propertyAlerts} onChange={e=>setForm({...form,propertyAlerts:e.target.value})}/></div>
        <div className="field"><label>Admin Notes</label><textarea className="input" value={form.adminNotes} onChange={e=>setForm({...form,adminNotes:e.target.value})}/></div>
        <div className="field"><label>Customer Notes</label><textarea className="input" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>

        <label className="permission-row"><span><strong>Invite customer account</strong><small>Send an activation link and connect this customer to the Customer Portal.</small></span><input type="checkbox" checked={sendInvite} onChange={e=>setSendInvite(e.target.checked)}/></label>

        <button className="btn btn-primary" onClick={submit}>Add Customer</button>
        {message&&<div className="payment-message">{message}</div>}
      </div>
    </div>
  </AdminShell>
}
