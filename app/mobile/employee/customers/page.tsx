"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type PortfolioProperty={
  jobId:string;
  customerId:string|null;
  propertyId:string;
  customerName:string;
  serviceName:string;
  frequency:string;
  nextVisitDate:string|null;
  officialPhotoUrl:string|null;
  addressLine1:string;
  city:string;
  province:string;
  postalCode:string;
  lotSize:string|null;
  grassHeight:string|null;
  gate:boolean;
  dog:boolean;
  irrigation:boolean;
  accessNotes:string|null;
  propertyNotes:string|null;
};
type PortfolioPayload={employee:{id:string;name:string;avatarUrl:string|null};properties:PortfolioProperty[]};

function mapsHref(address:string){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`}
function fullAddress(item:PortfolioProperty){return [item.addressLine1,item.city,item.province,item.postalCode].filter(Boolean).join(", ")}
function frequencyCopy(value:string){return value==="weekly"?"Weekly":value==="biweekly"?"Every 2 weeks":value==="monthly"?"Monthly":value==="custom"?"Custom":"One-time"}
function dateCopy(value:string|null){if(!value)return "Not scheduled";const date=new Date(`${value}T12:00:00`);return Number.isNaN(date.getTime())?value:date.toLocaleDateString("en-CA",{month:"short",day:"numeric",year:"numeric"})}

export default function EmployeeCustomersPage(){
  const[payload,setPayload]=useState<PortfolioPayload>({employee:{id:"",name:"Employee",avatarUrl:null},properties:[]});
  const[selectedPropertyId,setSelectedPropertyId]=useState("");
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const client=getSupabaseBrowserClient() as any;
      const{data}=await client.auth.getSession();
      const token=data.session?.access_token;
      if(!token)throw new Error("Your Employee login expired. Sign in again.");
      const response=await fetch("/api/mobile/employee/customers",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Assigned customers could not be loaded.");
      const next=result as PortfolioPayload;
      setPayload(next);
      setSelectedPropertyId(current=>next.properties.some(item=>item.propertyId===current)?current:"");
      setError("");
    }catch(nextError){
      setError(nextError instanceof Error?nextError.message:"Assigned customers could not be loaded.");
      setPayload({employee:{id:"",name:"Employee",avatarUrl:null},properties:[]});
      setSelectedPropertyId("");
    }finally{setLoading(false)}
  },[]);

  useEffect(()=>{void load()},[load]);

  const selected=useMemo(()=>payload.properties.find(item=>item.propertyId===selectedPropertyId)||null,[payload.properties,selectedPropertyId]);
  const uniqueCustomers=useMemo(()=>new Set(payload.properties.map(item=>item.customerId||item.customerName)).size,[payload.properties]);
  const selectedAddress=selected?fullAddress(selected):"";

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="mobile-app-shell employee-polish-subpage employee-customers-page">
      <header className="employee-polish-subpage-topbar">
        <div className="employee-polish-menu-slot" aria-hidden="true"/>
        <div><strong>{selected?"Property":"Customers"}</strong><small>{selected?"Assigned customer property":"Your permanent customer portfolio"}</small></div>
        <div className="employee-polish-mini-avatar">{payload.employee.avatarUrl?<img src={payload.employee.avatarUrl} alt="Employee"/>:(payload.employee.name||"E").slice(0,1)}</div>
      </header>

      {!selected&&<section className="employee-customers-hero">
        <small>YOUR PORTFOLIO</small>
        <h1>Your assigned customers</h1>
        <p>Homes assigned to you by Admin stay here even when they are not on today&apos;s route.</p>
        <div><strong>{payload.properties.length}</strong><span>assigned properties</span><b>{uniqueCustomers} customers</b></div>
      </section>}

      {error&&<p className="mobile-message mobile-error">{error}</p>}

      {selected?<section className="employee-customer-property-card">
        <button type="button" className="employee-customer-property-back" onClick={()=>setSelectedPropertyId("")}>← Customers</button>
        <div className="employee-customer-property-photo">
          {selected.officialPhotoUrl?<img src={selected.officialPhotoUrl} alt={selectedAddress||"Customer property"}/>:<span>🏡</span>}
          <em className="active">Assigned</em>
        </div>
        <div className="employee-customer-property-heading">
          <small>{selected.serviceName||"Property service"}</small>
          <h1>{selected.addressLine1||"Property address"}</h1>
          <p>{selected.customerName||"Customer"} · {[selected.city,selected.province,selected.postalCode].filter(Boolean).join(", ")}</p>
        </div>
        <dl className="employee-customer-property-grid">
          <div><dt>Lot size</dt><dd>{selected.lotSize?.toUpperCase()||"—"}</dd></div>
          <div><dt>Grass height</dt><dd>{selected.grassHeight||"—"}</dd></div>
          <div><dt>Gate</dt><dd>{selected.gate?"Gated":"Open"}</dd></div>
          <div><dt>Irrigation</dt><dd>{selected.irrigation?"Yes":"No"}</dd></div>
          <div><dt>Dog</dt><dd>{selected.dog?"On property":"No note"}</dd></div>
          <div><dt>Frequency</dt><dd>{frequencyCopy(selected.frequency)}</dd></div>
          <div><dt>Next visit</dt><dd>{dateCopy(selected.nextVisitDate)}</dd></div>
          <div><dt>Assignment</dt><dd>Permanent</dd></div>
        </dl>
        {(selected.accessNotes||selected.propertyNotes)&&<div className="employee-customer-property-note"><strong>Property notes</strong><p>{selected.accessNotes||selected.propertyNotes}</p></div>}
        {selectedAddress&&<a className="employee-customer-property-directions" href={mapsHref(selectedAddress)} target="_blank" rel="noopener noreferrer">Get directions <span>↗</span></a>}
      </section>:<section className="employee-customers-list" aria-busy={loading}>
        {loading?<div className="employee-customers-empty"><strong>Loading customers…</strong><span>Reading your permanent Job assignments.</span></div>:payload.properties.length?payload.properties.map((item,index)=><button type="button" className="employee-customer-card" key={item.propertyId} onClick={()=>setSelectedPropertyId(item.propertyId)}>
          <div className="employee-customer-index">{String(index+1).padStart(2,"0")}</div>
          <div className="employee-customer-copy"><small>{item.serviceName||"Property service"}</small><strong>{item.customerName||"Customer"}</strong><span>{item.addressLine1}{item.city?`, ${item.city}`:""}{item.province?`, ${item.province}`:""}</span></div>
          <em className="active">Assigned</em>
        </button>):<div className="employee-customers-empty"><strong>No assigned customers yet.</strong><span>Customers appear here automatically when Admin assigns a Job to you in Build.</span></div>}
      </section>}
      {!selected&&<Link className="employee-customers-route-link" href="/mobile/employee">Open today&apos;s route <span>→</span></Link>}
    </main>
  </MobileRoleGuard>;
}
