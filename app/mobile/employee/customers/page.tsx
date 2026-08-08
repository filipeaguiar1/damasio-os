"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Stop={visitId:string;customerId:string|null;customerName:string;serviceName:string;addressLine1:string;city:string;province:string;postalCode:string;status:string};
type RoutePayload={employee:{name:string;avatarUrl:string|null};stops:Stop[]};

function todayKey(){const date=new Date();const year=date.getFullYear();const month=String(date.getMonth()+1).padStart(2,"0");const day=String(date.getDate()).padStart(2,"0");return `${year}-${month}-${day}`}

export default function EmployeeCustomersPage(){
  const [payload,setPayload]=useState<RoutePayload>({employee:{name:"Employee",avatarUrl:null},stops:[]});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    try{
      const{data}=await getSupabaseBrowserClient().auth.getSession();
      const token=data.session?.access_token;
      if(!token)throw new Error("Your Employee login expired. Sign in again.");
      const response=await fetch(`/api/mobile/employee/route?date=${todayKey()}`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Assigned customers could not be loaded.");
      setPayload(result as RoutePayload);
      setError("");
    }catch(nextError){setError(nextError instanceof Error?nextError.message:"Assigned customers could not be loaded.")}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{void load()},[load]);

  const customers=useMemo(()=>{
    const seen=new Set<string>();
    return payload.stops.filter(stop=>{
      const key=stop.customerId||`${stop.customerName}|${stop.addressLine1}`;
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    });
  },[payload.stops]);

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="mobile-app-shell employee-polish-subpage employee-customers-page">
      <header className="employee-polish-subpage-topbar">
        <div className="employee-polish-menu-slot" aria-hidden="true"/>
        <div><strong>Customers</strong><small>Assigned service accounts</small></div>
        <div className="employee-polish-mini-avatar">{payload.employee.avatarUrl?<img src={payload.employee.avatarUrl} alt="Employee"/>:(payload.employee.name||"E").slice(0,1)}</div>
      </header>

      <section className="employee-customers-hero">
        <small>FIELD DIRECTORY</small>
        <h1>Your assigned customers</h1>
        <p>A simple field view of customers already connected to today&apos;s canonical Employee route.</p>
        <div><strong>{customers.length}</strong><span>assigned today</span><b>{payload.stops.filter(stop=>stop.status==="completed").length} completed visits</b></div>
      </section>

      {error&&<p className="mobile-message mobile-error">{error}</p>}
      <section className="employee-customers-list" aria-busy={loading}>
        {loading?<div className="employee-customers-empty"><strong>Loading customers…</strong><span>Using the same live route data as the Employee app.</span></div>:customers.length?customers.map((customer,index)=><article key={customer.customerId||customer.visitId}>
          <div className="employee-customer-index">{String(index+1).padStart(2,"0")}</div>
          <div className="employee-customer-copy"><small>{customer.serviceName||"Property service"}</small><strong>{customer.customerName||"Customer"}</strong><span>{customer.addressLine1}{customer.city?`, ${customer.city}`:""}{customer.province?`, ${customer.province}`:""}</span></div>
          <em className={customer.status==="completed"?"done":customer.status==="in_progress"?"active":""}>{customer.status==="completed"?"Done":customer.status==="in_progress"?"Active":"Assigned"}</em>
        </article>):<div className="employee-customers-empty"><strong>No assigned customers today.</strong><span>Customers appear here automatically when Admin publishes Employee visits.</span></div>}
      </section>
      <Link className="employee-customers-route-link" href="/mobile/employee">Open today&apos;s route <span>→</span></Link>
    </main>
  </MobileRoleGuard>;
}
