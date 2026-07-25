"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { AddressAutocomplete } from "@/components/home/AddressAutocomplete";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { readDemoSession } from "@/lib/auth/demoAuth";

type Employee={id:string;full_name:string;email:string;phone?:string|null;active:boolean;avatar_url?:string|null;address_line1?:string|null;city?:string|null;province?:string|null;postal_code?:string|null;route_start_address?:string|null;invite_status?:string|null};
type Form={fullName:string;email:string;phone:string;addressLine1:string;city:string;province:string;postalCode:string;routeStartAddress:string;avatarUrl:string;active:boolean};
const blank:Form={fullName:"",email:"",phone:"",addressLine1:"",city:"",province:"ON",postalCode:"",routeStartAddress:"",avatarUrl:"",active:true};

async function api(options?:RequestInit){const client=getSupabaseBrowserClient()as any;const{data}=await client.auth.getSession();const token=data.session?.access_token;if(!token)throw new Error("Sign in with a real Admin account to manage employees.");const response=await fetch("/api/admin/users",{...options,headers:{"content-type":"application/json",authorization:`Bearer ${token}`,...(options?.headers||{})}});const result=await response.json();if(!response.ok)throw new Error(result.error||"Employee operation failed.");return result}

function fromEmployee(employee:Employee):Form{return{fullName:employee.full_name,email:employee.email,phone:employee.phone||"",addressLine1:employee.address_line1||"",city:employee.city||"",province:employee.province||"ON",postalCode:employee.postal_code||"",routeStartAddress:employee.route_start_address||employee.address_line1||"",avatarUrl:employee.avatar_url||"",active:employee.active}}

export default function EmployeesPage(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[selected,setSelected]=useState<Employee|null>(null);
  const[creating,setCreating]=useState(false);
  const[form,setForm]=useState<Form>(blank);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  const demo=Boolean(readDemoSession());

  async function refresh(){if(demo){setEmployees([]);setMessage("Real employee profiles require a company Admin account.");return}setBusy(true);try{const result=await api();setEmployees(result.users||[]);setMessage("")}catch(error){setMessage(error instanceof Error?error.message:"Employees could not be loaded.")}finally{setBusy(false)}}
  useEffect(()=>{void refresh()},[]);
  const counts=useMemo(()=>({active:employees.filter(item=>item.active).length,inactive:employees.filter(item=>!item.active).length,pending:employees.filter(item=>item.invite_status==="sent"||item.invite_status==="pending").length}),[employees]);
  function open(employee:Employee){setCreating(false);setSelected(employee);setForm(fromEmployee(employee))}
  function startCreate(){setSelected(null);setCreating(true);setForm(blank);setMessage("")}
  function close(){setSelected(null);setCreating(false);setForm(blank)}

  async function uploadPhoto(file:File){const client=getSupabaseBrowserClient()as any;const ext=file.name.split(".").pop()||"jpg";const path=`${crypto.randomUUID()}.${ext}`;const{error}=await client.storage.from("employee-avatars").upload(path,file,{upsert:false});if(error)throw new Error(error.message);const{data}=client.storage.from("employee-avatars").getPublicUrl(path);setForm(current=>({...current,avatarUrl:data.publicUrl}))}

  async function save(){if(demo)return;setBusy(true);try{const payload={...form,phone:form.phone||null,addressLine1:form.addressLine1||null,city:form.city||null,postalCode:form.postalCode||null,routeStartAddress:form.routeStartAddress||form.addressLine1||null,avatarUrl:form.avatarUrl||null};const result=await api({method:creating?"POST":"PATCH",body:JSON.stringify(creating?payload:{id:selected?.id,...payload})});await refresh();setMessage(result.message||`${form.fullName} saved.`);close()}catch(error){setMessage(error instanceof Error?error.message:"Employee could not be saved.")}finally{setBusy(false)}}
  async function remove(employee:Employee){if(demo||!window.confirm(`Delete ${employee.full_name}'s access? Historical visits remain preserved.`))return;setBusy(true);try{const result=await api({method:"DELETE",body:JSON.stringify({id:employee.id})});await refresh();close();setMessage(result.message)}catch(error){setMessage(error instanceof Error?error.message:"Employee could not be deleted.")}finally{setBusy(false)}}

  const modalOpen=creating||Boolean(selected);
  return <AdminShell active="Employees">
    <div className="app-top"><div><span className="eyebrow">WORKFORCE</span><h1>Employees</h1><p className="section-intro">Invite real workers, save their route start address and maintain one profile used by Admin, Dispatch and Employee Route.</p></div><div className="toolbar-inline"><button className="btn btn-primary" disabled={busy||demo} onClick={startCreate}>＋ Add Employee</button><button className="btn btn-outline" disabled={busy} onClick={()=>void refresh()}>Refresh</button></div></div>
    <section className="business-metrics"><div className="business-metric"><span>Active</span><strong>{counts.active}</strong><small>field access enabled</small></div><div className="business-metric"><span>Pending invites</span><strong>{counts.pending}</strong><small>email invitation sent</small></div><div className="business-metric"><span>Inactive</span><strong>{counts.inactive}</strong><small>history preserved</small></div></section>
    {message&&<div className="payment-message" style={{marginTop:18}}>{message}</div>}
    <section className="card table-card" style={{marginTop:20}}><div className="table-head"><div><h2>Employee profiles</h2><p className="section-intro">The route start address is the default origin for this employee's route.</p></div></div><div className="table-wrap"><table><thead><tr><th>Employee</th><th>Contact</th><th>Route start</th><th>Invite</th><th>Status</th><th>Action</th></tr></thead><tbody>{!employees.length?<tr><td colSpan={6}>{busy?"Loading employees…":"No employees yet. Use Add Employee."}</td></tr>:employees.map(employee=><tr key={employee.id}><td><div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:40,height:40,borderRadius:"50%",overflow:"hidden",background:"#e9f4ef",display:"grid",placeItems:"center"}}>{employee.avatar_url?<img src={employee.avatar_url} alt={employee.full_name} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span>{employee.full_name.slice(0,1)}</span>}</div><strong>{employee.full_name}</strong></div></td><td>{employee.email}<br/><small>{employee.phone||"No phone"}</small></td><td>{employee.route_start_address||employee.address_line1||"Not set"}</td><td>{employee.invite_status||"pending"}</td><td>{employee.active?"Active":"Inactive"}</td><td><button className="btn btn-outline" onClick={()=>open(employee)}>Edit profile</button></td></tr>)}</tbody></table></div></section>

    {modalOpen&&<div className="master-modal-backdrop" onMouseDown={close}><section className="master-modal" role="dialog" aria-modal="true" onMouseDown={event=>event.stopPropagation()}><header><h3>{creating?"Add Employee":selected?.full_name}</h3><button onClick={close}>×</button></header><div className="master-form">
      <div style={{display:"flex",alignItems:"center",gap:14}}><div style={{width:72,height:72,borderRadius:"50%",overflow:"hidden",background:"#e9f4ef",display:"grid",placeItems:"center",fontSize:28}}>{form.avatarUrl?<img src={form.avatarUrl} alt="Employee" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span>{form.fullName.slice(0,1)||"+"}</span>}</div><label>Profile photo<input type="file" accept="image/*" onChange={event=>{const file=event.target.files?.[0];if(file)void uploadPhoto(file).catch(error=>setMessage(error.message))}}/></label></div>
      <label>Full name<input value={form.fullName} onChange={event=>setForm({...form,fullName:event.target.value})}/></label>
      <label>Email used to sign in<input type="email" value={form.email} onChange={event=>setForm({...form,email:event.target.value})}/></label>
      <label>Phone<input value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})}/></label>
      <label>Home address<AddressAutocomplete value={form.addressLine1} onChange={value=>setForm({...form,addressLine1:value,routeStartAddress:form.routeStartAddress||value})} placeholder="Employee home or regular starting address"/></label>
      <label>City<input value={form.city} onChange={event=>setForm({...form,city:event.target.value})}/></label>
      <label>Province<input value={form.province} onChange={event=>setForm({...form,province:event.target.value})}/></label>
      <label>Postal code<input value={form.postalCode} onChange={event=>setForm({...form,postalCode:event.target.value})}/></label>
      <label>Default route start address<AddressAutocomplete value={form.routeStartAddress} onChange={value=>setForm({...form,routeStartAddress:value})} placeholder="Where this employee normally starts routes"/></label>
      {!creating&&<label>Status<select value={form.active?"active":"inactive"} onChange={event=>setForm({...form,active:event.target.value==="active"})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}
      <button disabled={busy} onClick={()=>void save()}>{busy?"Saving…":creating?"Send invitation":"Save profile"}</button>
      {!creating&&selected&&<button className="btn btn-danger" disabled={busy} onClick={()=>void remove(selected)}>Delete employee</button>}
    </div></section></div>}
  </AdminShell>;
}