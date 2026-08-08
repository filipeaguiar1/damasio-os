"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Stop={
  visitId:string;
  customerId:string|null;
  propertyId:string|null;
  customerName:string;
  serviceName:string;
  addressLine1:string;
  city:string;
  province:string;
  postalCode:string;
  status:string;
  employeeNotes?:string|null;
};
type RoutePayload={employee:{name:string;avatarUrl:string|null};stops:Stop[]};
type PropertyRecord={
  id:string;
  official_photo_url:string|null;
  address_line1:string;
  city:string;
  province:string;
  postal_code:string|null;
  lot_size:string|null;
  grass_height:string|null;
  gate:boolean;
  dog:boolean;
  irrigation:boolean;
  access_notes:string|null;
  property_notes:string|null;
};

function todayKey(){const date=new Date();const year=date.getFullYear();const month=String(date.getMonth()+1).padStart(2,"0");const day=String(date.getDate()).padStart(2,"0");return `${year}-${month}-${day}`}
function mapsHref(address:string){return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`}
function fullAddress(stop:Stop){return [stop.addressLine1,stop.city,stop.province,stop.postalCode].filter(Boolean).join(", ")}
function statusCopy(status:string){return status==="completed"?"Done":status==="in_progress"?"Active":"Assigned"}

export default function EmployeeCustomersPage(){
  const [payload,setPayload]=useState<RoutePayload>({employee:{name:"Employee",avatarUrl:null},stops:[]});
  const [properties,setProperties]=useState<Record<string,PropertyRecord>>({});
  const [selectedVisitId,setSelectedVisitId]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [propertyError,setPropertyError]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const client=getSupabaseBrowserClient() as any;
      const{data}=await client.auth.getSession();
      const token=data.session?.access_token;
      if(!token)throw new Error("Your Employee login expired. Sign in again.");
      const response=await fetch(`/api/mobile/employee/route?date=${todayKey()}`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Assigned customers could not be loaded.");
      const routePayload=result as RoutePayload;
      setPayload(routePayload);
      setError("");

      const propertyIds=[...new Set(routePayload.stops.map(stop=>stop.propertyId).filter((value):value is string=>Boolean(value)))];
      if(propertyIds.length){
        const propertyResult=await client
          .from("properties")
          .select("id,official_photo_url,address_line1,city,province,postal_code,lot_size,grass_height,gate,dog,irrigation,access_notes,property_notes")
          .in("id",propertyIds);
        if(propertyResult.error){
          setPropertyError("Property details are temporarily unavailable.");
          setProperties({});
        }else{
          setPropertyError("");
          setProperties(Object.fromEntries((propertyResult.data||[]).map((property:PropertyRecord)=>[property.id,property])));
        }
      }else{
        setPropertyError("");
        setProperties({});
      }
      setSelectedVisitId(current=>routePayload.stops.some(stop=>stop.visitId===current)?current:"");
    }catch(nextError){
      setError(nextError instanceof Error?nextError.message:"Assigned customers could not be loaded.");
      setPayload({employee:{name:"Employee",avatarUrl:null},stops:[]});
      setProperties({});
      setSelectedVisitId("");
    }finally{
      setLoading(false);
    }
  },[]);

  useEffect(()=>{void load()},[load]);

  const customers=useMemo(()=>{
    const seen=new Set<string>();
    return payload.stops.filter(stop=>{
      const key=stop.propertyId||stop.customerId||`${stop.customerName}|${stop.addressLine1}`;
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    });
  },[payload.stops]);

  const selected=useMemo(()=>customers.find(stop=>stop.visitId===selectedVisitId)||null,[customers,selectedVisitId]);
  const selectedProperty=selected?.propertyId?properties[selected.propertyId]||null:null;
  const selectedAddress=selected?fullAddress(selected):"";

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="mobile-app-shell employee-polish-subpage employee-customers-page">
      <header className="employee-polish-subpage-topbar">
        <div className="employee-polish-menu-slot" aria-hidden="true"/>
        <div><strong>{selected?"Property":"Customers"}</strong><small>{selected?"Assigned customer property":"Assigned service accounts"}</small></div>
        <div className="employee-polish-mini-avatar">{payload.employee.avatarUrl?<img src={payload.employee.avatarUrl} alt="Employee"/>:(payload.employee.name||"E").slice(0,1)}</div>
      </header>

      {!selected&&<section className="employee-customers-hero">
        <small>FIELD DIRECTORY</small>
        <h1>Your assigned customers</h1>
        <p>Customers and properties come from the same canonical Employee route you already use in the field.</p>
        <div><strong>{customers.length}</strong><span>assigned properties today</span><b>{payload.stops.filter(stop=>stop.status==="completed").length} completed visits</b></div>
      </section>}

      {error&&<p className="mobile-message mobile-error">{error}</p>}
      {!error&&propertyError&&<p className="mobile-message">{propertyError}</p>}

      {selected?<section className="employee-customer-property-card">
        <button type="button" className="employee-customer-property-back" onClick={()=>setSelectedVisitId("")}>← Customers</button>
        <div className="employee-customer-property-photo">
          {selectedProperty?.official_photo_url?<img src={selectedProperty.official_photo_url} alt={selectedAddress||"Customer property"}/>:<span>🏡</span>}
          <em className={selected.status==="completed"?"done":selected.status==="in_progress"?"active":""}>{statusCopy(selected.status)}</em>
        </div>
        <div className="employee-customer-property-heading">
          <small>{selected.serviceName||"Property service"}</small>
          <h1>{selected.addressLine1||"Property address"}</h1>
          <p>{selected.customerName||"Customer"} · {[selected.city,selected.province,selected.postalCode].filter(Boolean).join(", ")}</p>
        </div>
        <dl className="employee-customer-property-grid">
          <div><dt>Lot size</dt><dd>{selectedProperty?.lot_size?.toUpperCase()||"—"}</dd></div>
          <div><dt>Grass height</dt><dd>{selectedProperty?.grass_height||"—"}</dd></div>
          <div><dt>Gate</dt><dd>{selectedProperty?.gate?"Gated":"Open"}</dd></div>
          <div><dt>Irrigation</dt><dd>{selectedProperty?.irrigation?"Yes":"No"}</dd></div>
          <div><dt>Dog</dt><dd>{selectedProperty?.dog?"On property":"No note"}</dd></div>
          <div><dt>Visit</dt><dd>{statusCopy(selected.status)}</dd></div>
        </dl>
        {(selectedProperty?.access_notes||selectedProperty?.property_notes||selected.employeeNotes)&&<div className="employee-customer-property-note">
          <strong>Property notes</strong>
          <p>{selectedProperty?.access_notes||selectedProperty?.property_notes||selected.employeeNotes}</p>
        </div>}
        {selectedAddress&&<a className="employee-customer-property-directions" href={mapsHref(selectedAddress)} target="_blank" rel="noopener noreferrer">Get directions <span>↗</span></a>}
      </section>:<section className="employee-customers-list" aria-busy={loading}>
        {loading?<div className="employee-customers-empty"><strong>Loading customers…</strong><span>Using the same live route data as the Employee app.</span></div>:customers.length?customers.map((customer,index)=><button type="button" className="employee-customer-card" key={customer.propertyId||customer.customerId||customer.visitId} onClick={()=>setSelectedVisitId(customer.visitId)}>
          <div className="employee-customer-index">{String(index+1).padStart(2,"0")}</div>
          <div className="employee-customer-copy"><small>{customer.serviceName||"Property service"}</small><strong>{customer.customerName||"Customer"}</strong><span>{customer.addressLine1}{customer.city?`, ${customer.city}`:""}{customer.province?`, ${customer.province}`:""}</span></div>
          <em className={customer.status==="completed"?"done":customer.status==="in_progress"?"active":""}>{statusCopy(customer.status)}</em>
        </button>):<div className="employee-customers-empty"><strong>No assigned customers today.</strong><span>Customers appear here automatically when Admin publishes Employee visits.</span></div>}
      </section>}
      {!selected&&<Link className="employee-customers-route-link" href="/mobile/employee">Open today&apos;s route <span>→</span></Link>}
    </main>
  </MobileRoleGuard>;
}
