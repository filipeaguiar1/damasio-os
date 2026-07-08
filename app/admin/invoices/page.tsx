"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { createInvoiceFromLead, getInvoices, getLeads, Invoice, updateInvoiceStatus, seedDemoLeads } from "@/lib/storage";

export default function InvoicesPage(){
  const [invoices,setInvoices]=useState<Invoice[]>([]);
  const [leads,setLeads]=useState(getLeads());
  function refresh(){setInvoices(getInvoices());setLeads(getLeads())}
  useEffect(()=>refresh(),[]);

  function generateAll(){
    const current=getLeads().filter(l=>l.total>0);
    current.forEach(createInvoiceFromLead);
    refresh();
  }

  return <AdminShell active="Invoices">
    <div className="app-top"><div><span className="eyebrow">Billing</span><h1>Invoices</h1><p className="section-intro">Generate simple invoice records from quoted or completed services.</p></div><div className="row"><button className="btn btn-outline" onClick={()=>{seedDemoLeads(true);refresh()}}>Load Demo Leads</button><button className="btn btn-primary" onClick={generateAll}>Generate Invoices</button></div></div>
    <div className="grid-3" style={{marginBottom:20}}><div className="card dash-card"><div className="mini-label">Invoices</div><div className="mini-value">{invoices.length}</div></div><div className="card dash-card"><div className="mini-label">Leads Available</div><div className="mini-value">{leads.filter(l=>l.total>0).length}</div></div><div className="card dash-card"><div className="mini-label">Total</div><div className="mini-value">${invoices.reduce((s,i)=>s+i.total,0).toFixed(2)}</div></div></div>
    <section className="card table-card"><div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Service</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{invoices.length===0?<tr><td colSpan={6}>No invoices yet.</td></tr>:invoices.map(i=><tr key={i.id}><td><strong>{i.number||i.id}</strong></td><td>{i.customer}</td><td>{i.service}</td><td>${i.total.toFixed(2)}</td><td><span className="status">{i.status}</span></td><td><select className="input" value={i.status} onChange={e=>{updateInvoiceStatus(i.id,e.target.value as Invoice["status"]);refresh()}}><option value="draft">Draft</option><option value="sent">Sent</option><option value="waiting_payment">Waiting Payment</option><option value="processing">Processing</option><option value="paid">Paid</option><option value="overdue">Overdue</option><option value="rejected">Rejected</option></select></td></tr>)}</tbody></table></div></section>
  </AdminShell>
}
