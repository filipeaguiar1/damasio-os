"use client";
import {useEffect,useState} from "react";
import {PortalShell}from"@/components/admin/PortalShell";
import {Invoice,getInvoices} from "@/lib/storage";
function money(n:number){return `$${n.toFixed(2)}`}
export default function Invoices(){
  const[invoices,setInvoices]=useState<Invoice[]>([]);const[msg,setMsg]=useState("");
  function refresh(){setInvoices(getInvoices())}
  useEffect(()=>refresh(),[]);
  function explainPayment(){setMsg("Online payment is temporarily unavailable while secure Stripe confirmation and webhooks are being finalized. No payment was recorded.")}
  return <PortalShell type="Customer" active="Invoices"><div className="app-top"><div><span className="eyebrow">Billing</span><h1>Invoices</h1><p className="section-intro">Approved quotes appear here automatically before payment.</p></div></div>{msg&&<div className="notice" style={{marginBottom:18}}>{msg}</div>}<section className="card table-card"><div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Service</th><th>Total</th><th>Payment</th><th>Action</th></tr></thead><tbody>{invoices.length===0?<tr><td colSpan={5}>No invoices yet.</td></tr>:invoices.map(inv=><tr key={inv.id}><td><strong>{inv.number}</strong><br/><small>{new Date(inv.createdAt).toLocaleDateString()}</small></td><td>{inv.service}</td><td>{money(inv.total)}</td><td><span className="pay-pill">{inv.status.replace("_"," ")}</span>{inv.paymentMethod&&<><br/><small>{inv.paymentMethod}</small></>}</td><td>{inv.status==="paid"?<span className="status">Paid</span>:<button className="btn btn-outline" onClick={explainPayment}>Payment status</button>}</td></tr>)}</tbody></table></div></section></PortalShell>
}
