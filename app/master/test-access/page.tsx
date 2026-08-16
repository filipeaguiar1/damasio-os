"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import styles from "./test-access.module.css";

type Company={id:string;name:string};
type Account={id:string;auth_user_id:string;company_id:string;role:string;email:string;display_name:string;customer_id?:string|null;employee_id?:string|null;expires_at?:string|null;disabled_at?:string|null;disabled_reason?:string|null;created_at:string};
type Credential={email:string;password:string;role:string;company:string;expiresAt:string|null;displayName?:string};

async function accessToken(){const supabase=getSupabaseBrowserClient() as any;const{data}=await supabase.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Your Master session expired. Sign in again.");return token}

export default function MasterTestAccessPage(){
  const[companies,setCompanies]=useState<Company[]>([]);
  const[accounts,setAccounts]=useState<Account[]>([]);
  const[loading,setLoading]=useState(true);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");
  const[credential,setCredential]=useState<Credential|null>(null);
  const[universeCredentials,setUniverseCredentials]=useState<Credential[]>([]);
  const[editing,setEditing]=useState<Account|null>(null);
  const[editName,setEditName]=useState("");
  const[role,setRole]=useState("company");
  const[companyId,setCompanyId]=useState("");
  const[duration,setDuration]=useState("240");
  const[password,setPassword]=useState("");
  const[confirm,setConfirm]=useState("");
  const[universeName,setUniverseName]=useState("4Ever Seasons Test Universe");
  const[employeeCount,setEmployeeCount]=useState("1");
  const[customerCount,setCustomerCount]=useState("8");
  const[universePassword,setUniversePassword]=useState("Test@12345");
  const[universeDuration,setUniverseDuration]=useState("10080");

  async function load(){
    setLoading(true);
    try{const token=await accessToken();const response=await fetch("/api/master/test-accounts",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});const result=await response.json();if(!response.ok)throw new Error(result.error||"Test accounts could not be loaded.");setCompanies(result.companies||[]);setAccounts(result.accounts||[]);setCompanyId(current=>current||(result.companies?.[0]?.id||""));setMessage("")}
    catch(error){setMessage(error instanceof Error?error.message:"Test accounts could not be loaded.")}
    finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[]);

  const activeCount=useMemo(()=>accounts.filter(item=>!item.disabled_at&&(!item.expires_at||new Date(item.expires_at)>new Date())).length,[accounts]);
  const companyName=(id:string)=>companies.find(item=>item.id===id)?.name||"Company";

  async function createUniverse(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setCredential(null);setUniverseCredentials([]);
    const employees=Number(employeeCount);const customers=Number(customerCount);
    if(!universeName.trim())return setMessage("Name the test company.");
    if(!Number.isInteger(employees)||employees<1||employees>8)return setMessage("Choose 1 to 8 workers.");
    if(!Number.isInteger(customers)||customers<1||customers>40)return setMessage("Choose 1 to 40 customers.");
    if(universePassword.length<10)return setMessage("Use at least 10 characters for the ecosystem password.");
    setBusy(true);
    try{const token=await accessToken();const expiresInMinutes=universeDuration==="unlimited"?null:Number(universeDuration);const response=await fetch("/api/master/test-accounts",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({mode:"ecosystem",companyName:universeName.trim(),employeeCount:employees,customerCount:customers,password:universePassword,expiresInMinutes})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Connected test universe could not be created.");setUniverseCredentials(result.credentials||[]);setMessage(result.message);await load()}
    catch(error){setMessage(error instanceof Error?error.message:"Connected test universe could not be created.")}
    finally{setBusy(false)}
  }

  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const formElement=event.currentTarget;
    setCredential(null);setUniverseCredentials([]);
    if(!companyId)return setMessage("Choose a company.");
    if(password.length<10)return setMessage("Use at least 10 characters for the temporary password.");
    if(password!==confirm)return setMessage("Password confirmation does not match.");
    const form=new FormData(formElement);const fullName=String(form.get("fullName")||"").trim();const email=String(form.get("email")||"").trim().toLowerCase();const address=String(form.get("address")||"").trim();
    setBusy(true);
    try{const token=await accessToken();const expiresInMinutes=duration==="unlimited"?null:Number(duration);const response=await fetch("/api/master/test-accounts",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({mode:"single",companyId,role,fullName,email,password,expiresInMinutes,address:address||undefined})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Temporary account could not be created.");setCredential({email,password,role:result.account.role,company:result.companyName,expiresAt:result.account.expires_at||null,displayName:result.account.display_name});setMessage(result.message);setPassword("");setConfirm("");formElement.reset();setRole("company");setDuration("240");await load()}
    catch(error){setMessage(error instanceof Error?error.message:"Temporary account could not be created.")}
    finally{setBusy(false)}
  }

  async function disable(account:Account){
    if(account.disabled_at)return;if(!window.confirm(`Disable ${account.email}? Existing sessions will lose Damasio OS authorization when profile access is revoked.`))return;
    setBusy(true);
    try{const token=await accessToken();const response=await fetch("/api/master/test-accounts",{method:"DELETE",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({id:account.id})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Temporary account could not be disabled.");setMessage("Temporary test account disabled.");await load()}
    catch(error){setMessage(error instanceof Error?error.message:"Temporary account could not be disabled.")}
    finally{setBusy(false)}
  }

  function beginEdit(account:Account){setEditing(account);setEditName(account.display_name||"")}

  async function saveEdit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!editing)return;
    const displayName=editName.trim();
    if(displayName.length<2)return setMessage("Enter at least 2 characters for the profile name.");
    setBusy(true);
    try{const token=await accessToken();const response=await fetch("/api/master/test-accounts",{method:"PATCH",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({id:editing.id,displayName})});const result=await response.json();if(!response.ok)throw new Error(result.error||"Test profile could not be updated.");setAccounts(current=>current.map(item=>item.id===editing.id?result.account:item));setMessage(result.message||"Test profile updated.");setEditing(null);setEditName("")}
    catch(error){setMessage(error instanceof Error?error.message:"Test profile could not be updated.")}
    finally{setBusy(false)}
  }

  return <main className={styles.shell}><div className={styles.wrap}>
    <section className={styles.hero}><div><span>MASTER TEST ACCESS</span><h1>Temporary Test Universe</h1><p>Create a connected company demo with company admin, worker route, customer login, properties, services and route history. Existing real users are never overwritten.</p></div><Link href="/master">Back to Master</Link></section>
    {message&&<div className={styles.message}>{message}</div>}
    <section className={styles.grid}>
      <article className={`${styles.panel} ${styles.ecosystem}`}><header className={styles.head}><span>CONNECTED TEST PROFILE</span><h2>Create a full test ecosystem</h2><p>Master defines how many workers and customers are created. The first customer receives a login, every worker receives a login, and the customer jobs are published into worker routes.</p></header><form className={styles.form} onSubmit={createUniverse}>
        <div className={styles.miniGrid}><div className={styles.field}><label>Company / profile name</label><input value={universeName} onChange={event=>setUniverseName(event.target.value)} required /></div><div className={styles.field}><label>Workers</label><input type="number" min={1} max={8} value={employeeCount} onChange={event=>setEmployeeCount(event.target.value)} required /></div><div className={styles.field}><label>Customers</label><input type="number" min={1} max={40} value={customerCount} onChange={event=>setCustomerCount(event.target.value)} required /></div></div>
        <div className={styles.two}><div className={styles.field}><label>Shared test password</label><input type="text" value={universePassword} onChange={event=>setUniversePassword(event.target.value)} required /></div><div className={styles.field}><label>Access duration</label><select value={universeDuration} onChange={event=>setUniverseDuration(event.target.value)}><option value="240">4 hours</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="43200">30 days</option><option value="unlimited">No time limit</option></select></div></div>
        <button className={styles.submit} disabled={busy||loading}>{busy?"Building ecosystem...":"Create connected test profile"}</button>
        <div className={styles.note}>After creation, use Edit name below for quick profile fixes, or log in as the Company Admin to edit customers/workers and continue the full test.</div>
      </form>{universeCredentials.length>0&&<div className={styles.credentialList}>{universeCredentials.map(item=><div className={styles.credentialCard} key={item.email}><strong>{item.role}</strong><span>{item.displayName||item.role}</span><code>{item.email}</code><code>{item.password}</code><small>{item.company}{item.expiresAt?` · expires ${new Date(item.expiresAt).toLocaleString("en-CA")}`:" · no time limit"}</small></div>)}</div>}</article>
      <article className={styles.panel}><header className={styles.head}><span>CREATE ONE LOGIN</span><h2>New test login</h2><p>Use this only when you want one extra account inside an existing company.</p></header><form className={styles.form} onSubmit={create}>
        <div className={styles.field}><label>Company</label><select value={companyId} onChange={event=>setCompanyId(event.target.value)} required><option value="">Select company</option>{companies.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className={styles.field}><label>Test role</label><select value={role} onChange={event=>setRole(event.target.value)}><option value="company">Company Admin</option><option value="customer">Customer</option><option value="employee">Employee / Worker</option></select></div>
        <div className={styles.field}><label>Display name</label><input name="fullName" required placeholder="QA Tester" /></div>
        <div className={styles.field}><label>Email</label><input name="email" type="email" required placeholder="tester@example.com" /></div>
        {role==="customer"&&<div className={styles.field}><label>Temporary property address</label><input name="address" placeholder="100 Test Access Lane" /></div>}
        <div className={styles.two}><div className={styles.field}><label>Password</label><input type="password" value={password} onChange={event=>setPassword(event.target.value)} required autoComplete="new-password" /></div><div className={styles.field}><label>Confirm password</label><input type="password" value={confirm} onChange={event=>setConfirm(event.target.value)} required autoComplete="new-password" /></div></div>
        <div className={styles.field}><label>Access duration</label><select value={duration} onChange={event=>setDuration(event.target.value)}><option value="60">1 hour</option><option value="240">4 hours</option><option value="1440">24 hours</option><option value="10080">7 days</option><option value="43200">30 days</option><option value="unlimited">No time limit</option></select></div>
        <button className={styles.submit} disabled={busy||loading}>{busy?"Creating...":"Create test account"}</button>
        <div className={styles.note}>Single Employee accounts are now connected to their own worker and crew record, so they can be routed later.</div>
      </form>{credential&&<div className={styles.credential}><strong>Share these credentials now</strong><code>{credential.email}</code><code>{credential.password}</code><span>{credential.company} · {credential.role}{credential.expiresAt?` · expires ${new Date(credential.expiresAt).toLocaleString("en-CA")}`:" · no time limit"}</span></div>}</article>
      <article className={styles.panel}><header className={styles.head}><span>ACTIVE & RECENT</span><h2>{activeCount} active test account{activeCount===1?"":"s"}</h2><p>Expired accounts are disabled automatically every minute. Unlimited accounts stay active until Master disables them.</p></header><div className={styles.list}>{loading?<div className={styles.empty}><strong>Loading test accounts...</strong></div>:accounts.length===0?<div className={styles.empty}><strong>No temporary accounts yet.</strong></div>:accounts.map(account=>{const expired=Boolean(account.expires_at&&new Date(account.expires_at)<=new Date());const disabled=Boolean(account.disabled_at)||expired;return <div className={styles.row} key={account.id}><div><strong>{account.display_name}</strong><span>{account.email} · {companyName(account.company_id)}</span><small>{account.role} · {account.expires_at?`expires ${new Date(account.expires_at).toLocaleString("en-CA")}`:"no time limit"}</small></div><span className={`${styles.badge} ${disabled?styles.off:""}`}>{disabled?account.disabled_reason||"disabled":"active"}</span><div className={styles.rowActions}><button type="button" onClick={()=>beginEdit(account)} disabled={busy}>Edit name</button><button type="button" disabled={disabled||busy} onClick={()=>void disable(account)}>{disabled?"Disabled":"Disable now"}</button></div></div>})}</div></article>
    </section>
    {editing&&<div className={styles.editOverlay} onMouseDown={()=>setEditing(null)}><form className={styles.editModal} onSubmit={saveEdit} onMouseDown={event=>event.stopPropagation()}><header><div><span>EDIT TEST PROFILE</span><h2>{editing.email}</h2></div><button type="button" onClick={()=>setEditing(null)} aria-label="Close edit panel">x</button></header><div className={styles.field}><label>Display name</label><input value={editName} onChange={event=>setEditName(event.target.value)} autoFocus required /></div><p>This updates the test account, the signed-in profile, and the linked customer or worker name when that record exists.</p><button className={styles.submit} disabled={busy}>{busy?"Saving...":"Save profile name"}</button></form></div>}
  </div></main>
}
