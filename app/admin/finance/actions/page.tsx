"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  createInvoicePaymentLink,
  getPaymentActionWorkspace,
  requestAdvancePayment,
  updatePaymentPreference,
  type PaymentActionInvoice,
  type PaymentActionWorkspace,
} from "@/lib/repositories/paymentActionsRepository";
import styles from "../PaymentActions.module.css";

const empty:PaymentActionWorkspace={customers:[],invoices:[]};
function money(cents:number){return new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD"}).format((cents||0)/100)}
function date(value:string){return value?new Date(value).toLocaleDateString("en-CA"):""}

export default function PaymentActionsPage(){
  const[workspace,setWorkspace]=useState<PaymentActionWorkspace>(empty);
  const[selectedId,setSelectedId]=useState("");
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState("");
  const[message,setMessage]=useState("");
  const[paymentUrl,setPaymentUrl]=useState("");
  const[advanceAmount,setAdvanceAmount]=useState("");
  const[advanceNote,setAdvanceNote]=useState("");

  async function load(){
    setLoading(true);
    try{
      const data=await getPaymentActionWorkspace();setWorkspace(data);
      const requested=new URLSearchParams(window.location.search).get("customer")||"";
      setSelectedId(current=>data.customers.some(item=>item.id===current)?current:data.customers.some(item=>item.id===requested)?requested:data.customers[0]?.id||"");
      setMessage("");
    }catch(error){setMessage(error instanceof Error?error.message:"Payment actions could not be loaded.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load()},[]);

  const customer=workspace.customers.find(item=>item.id===selectedId)||null;
  const invoices=useMemo(()=>workspace.invoices.filter(item=>item.customerId===selectedId),[workspace.invoices,selectedId]);
  const openInvoices=invoices.filter(item=>item.status!=="paid"&&item.status!=="rejected");

  async function linkFor(invoice:PaymentActionInvoice,fresh:boolean){
    setBusy(invoice.id);setMessage("");setPaymentUrl("");
    try{
      const result=await createInvoicePaymentLink(invoice.id,{fresh});
      setPaymentUrl(result.url);
      setMessage(fresh?"A fresh Stripe Checkout link was created. The previous open Checkout, if any, was expired first.":result.reused?"The existing secure Stripe Checkout link is still valid and was reused.":"Secure Stripe Checkout link created.");
    }catch(error){setMessage(error instanceof Error?error.message:"Payment link could not be created.");}
    finally{setBusy("");}
  }

  async function saveMethod(method:"card"|"account_balance"){
    if(!customer)return;
    setBusy("method");
    try{await updatePaymentPreference(customer.id,method);setWorkspace(current=>({...current,customers:current.customers.map(item=>item.id===customer.id?{...item,servicePaymentMethod:method}:item)}));setMessage(`Preferred payment method changed to ${method==="card"?"card":"account balance"}.`)}
    catch(error){setMessage(error instanceof Error?error.message:"Payment preference could not be updated.")}
    finally{setBusy("")}
  }

  async function advance(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!customer)return;
    const amount=Number(advanceAmount);if(!Number.isFinite(amount)||amount<5)return setMessage("Enter an advance amount of at least $5 CAD.");
    setBusy("advance");setPaymentUrl("");
    try{const result=await requestAdvancePayment(customer.id,amount,advanceNote);setPaymentUrl(result.url);setMessage(`${money(Math.round(result.amount*100))} advance payment request created as account credit. It does not mark a future service Invoice as paid.`);setAdvanceAmount("");setAdvanceNote("")}
    catch(error){setMessage(error instanceof Error?error.message:"Advance request could not be created.")}
    finally{setBusy("")}
  }

  async function copyLink(){if(!paymentUrl)return;await navigator.clipboard.writeText(paymentUrl);setMessage("Secure payment link copied.")}

  return <AdminShell active="Payments">
    <div className={styles.shell}>
      <section className={styles.hero}><div><span>PAYMENT OPERATIONS</span><h1>Payment Actions</h1><p>Request payment, retry a failed/expired Checkout, offer a fresh payment-method link, or request an advance credit without bypassing Stripe verification.</p></div><Link href="/admin/finance">Back to Payments</Link></section>
      {message&&<div className={styles.message}>{message}</div>}
      <section className={styles.selector}><label><span>Customer</span><select value={selectedId} onChange={event=>{setSelectedId(event.target.value);setPaymentUrl("")}}><option value="">Select customer</option>{workspace.customers.map(item=><option key={item.id} value={item.id}>{item.name} · {item.origin.replaceAll("_"," ")}</option>)}</select></label><label><span>Preferred method</span><select disabled={!customer||busy==="method"} value={customer?.servicePaymentMethod||"card"} onChange={event=>void saveMethod(event.target.value as "card"|"account_balance")}><option value="card">Card / Stripe Checkout</option><option value="account_balance">Account balance</option></select></label></section>
      <section className={styles.layout}>
        <article className={styles.panel}><header className={styles.head}><span>OPEN INVOICES</span><h2>{customer?.name||"Select a customer"}</h2><p>Generating a link never marks the invoice paid. Only the Stripe webhook or a validated account-balance transaction can do that.</p></header><div className={styles.list}>{loading?<div className={styles.empty}><strong>Loading invoices…</strong></div>:!customer?<div className={styles.empty}><strong>Select a customer first.</strong></div>:openInvoices.length===0?<div className={styles.empty}><strong>No open invoices for this Customer.</strong><p>Paid invoices remain in the canonical ledger but do not need a payment action.</p></div>:openInvoices.map(invoice=><div className={styles.invoice} key={invoice.id}><div><strong>{invoice.number}</strong><span>{invoice.visitId?"Validated after-Visit invoice":"Service invoice"}</span><small>Created {date(invoice.createdAt)}{invoice.stripePaymentIntentId?" · Stripe attempt recorded":""}</small></div><div className={styles.amount}><b>{money(invoice.totalCents)}</b><span className={styles.badge}>{invoice.status.replaceAll("_"," ")}</span></div><div className={styles.invoiceActions}><button className={styles.primary} disabled={busy===invoice.id} onClick={()=>void linkFor(invoice,false)}>{busy===invoice.id?"Working…":"Request payment"}</button><button disabled={busy===invoice.id} onClick={()=>void linkFor(invoice,true)}>Retry / fresh link</button><button disabled={busy===invoice.id} onClick={()=>void linkFor(invoice,true)}>New payment method link</button></div></div>)}</div>{paymentUrl&&<div className={styles.linkBox}><strong>Secure Stripe link ready</strong><code>{paymentUrl}</code><div className={styles.linkActions}><a href={paymentUrl} target="_blank" rel="noreferrer">Open link</a><button type="button" onClick={()=>void copyLink()}>Copy link</button></div></div>}</article>
        <aside className={styles.panel}><header className={styles.head}><span>ADVANCE / MANUAL REQUEST</span><h2>Request account credit</h2><p>Use this when the Customer wants to pay ahead. Funds enter the canonical wallet only after Stripe confirms the payment.</p></header><form className={styles.actionForm} onSubmit={advance}><div className={styles.field}><label>Advance amount (CAD)</label><input type="number" min="5" max="10000" step="0.01" value={advanceAmount} onChange={event=>setAdvanceAmount(event.target.value)} placeholder="100.00" /></div><div className={styles.field}><label>Message / reason</label><textarea value={advanceNote} onChange={event=>setAdvanceNote(event.target.value)} placeholder="Optional note shown in Stripe Checkout" /></div><button disabled={!customer||busy==="advance"}>{busy==="advance"?"Creating request…":"Create advance payment link"}</button><div className={styles.notice}><strong>Accounting rule:</strong> this action creates prepaid account credit. It does not create a fake completed service and does not force an Invoice to “paid”.</div></form></aside>
      </section>
    </div>
  </AdminShell>
}
