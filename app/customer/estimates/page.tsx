"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import { PortalShell } from "@/components/admin/PortalShell";
import { Estimate, finalizeEstimate, getEstimates, getInvoiceForEstimate } from "@/lib/storage";

export default function CustomerEstimatesPage(){
  const router=useRouter();
  const [estimates,setEstimates]=useState<Estimate[]>([]);
  const [message,setMessage]=useState("");
  function refresh(){setEstimates(getEstimates().filter(item=>item.status!=="draft"))}
  useEffect(()=>refresh(),[]);
  function decide(e:Estimate,status:"approved"|"declined"){
    if(e.status==="approved"||e.status==="declined"){
      setMessage("This quote is already closed. Final decisions cannot be changed.");
      return;
    }
    const text=status==="approved"
      ? "Are you sure you want to approve this quote? An invoice will be created and you will proceed to payment. This cannot be declined after approval."
      : "Are you sure you want to decline this quote? After decline it will be closed and cannot be approved.";
    if(!window.confirm(text)) return;
    const result=finalizeEstimate(e.id,status);
    setMessage(result.message);
    refresh();
    if(result.ok&&status==="approved")router.push("/customer/payments");
  }
  return <PortalShell type="Customer" active="Estimates">
    <div className="app-top"><div><span className="eyebrow">Customer Portal</span><h1>My Estimates</h1><p className="section-intro">Approve or decline only when you are sure. Approved quotes create an invoice and move to payment.</p></div></div>
    {message&&<div className="notice" style={{marginBottom:18}}>{message}</div>}
    <div className="estimate-list compact-estimates">{estimates.length===0?<div className="card profile-card"><h3>No estimates yet</h3><p>Estimates created by the admin will appear here.</p></div>:estimates.map(e=>{
      const closed=e.status==="approved"||e.status==="declined";
      const inv=getInvoiceForEstimate(e.id);
      return <div className="estimate-preview compact" key={e.id}><div className="estimate-compact-head"><div><span className={`estimate-status ${e.status}`}>{e.status}</span><h3>{e.title}</h3><p>{e.number} · ${e.total.toFixed(2)}</p></div></div><p className="estimate-description">{e.description}</p>{e.status==="approved"&&<div className="confirm-box"><h3>Approved</h3><p>Invoice: {inv?.number||"Creating..."} · {inv?.status.replace("_"," ")||"waiting payment"}</p>{inv?.status!=="paid"?<div className="row"><Link className="btn btn-primary" href="/customer/payments">Choose secure payment</Link><Link className="btn btn-outline" href="/customer/invoices">View Invoice</Link></div>:<Link className="btn btn-outline" href="/customer/invoices">View Paid Invoice</Link>}</div>}{e.status==="declined"&&<div className="confirm-box"><h3>Declined</h3><p>This quote is closed.</p></div>}{!closed&&<div className="row"><button className="btn btn-primary" onClick={()=>decide(e,"approved")}>Approve</button><button className="btn btn-outline" onClick={()=>decide(e,"declined")}>Decline</button></div>}</div>
    })}</div>
  </PortalShell>
}
