"use client";
import { createId } from "@/lib/id";
import {useEffect,useMemo,useState} from "react";
import {AdminShell} from "@/components/admin/AdminShell";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

type Role="admin"|"employee"|"customer";
type LocalUser={id:string;full_name:string;email:string;role:Role;phone?:string;active:boolean;created_at:string};
const KEY="damasio_os_v411_users";
const demo:LocalUser[]=[
 {id:"u1",full_name:"Filipe Damasio",email:"admin@damasioos.demo",role:"admin",active:true,created_at:new Date().toISOString()},
 {id:"u2",full_name:"Field Employee",email:"employee@damasioos.demo",role:"employee",active:true,created_at:new Date().toISOString()},
 {id:"u3",full_name:"Customer Demo",email:"customer@damasioos.demo",role:"customer",active:true,created_at:new Date().toISOString()}
];
function loadUsers(){if(typeof window==="undefined")return demo;const raw=localStorage.getItem(KEY);if(!raw){localStorage.setItem(KEY,JSON.stringify(demo));return demo}try{return JSON.parse(raw) as LocalUser[]}catch{return demo}}
function saveUsers(users:LocalUser[]){localStorage.setItem(KEY,JSON.stringify(users))}

export default function UsersPage(){
 const[users,setUsers]=useState<LocalUser[]>([]);const[fullName,setFullName]=useState("");const[email,setEmail]=useState("");const[phone,setPhone]=useState("");const[role,setRole]=useState<Role>("customer");const[msg,setMsg]=useState("");
 useEffect(()=>{setUsers(loadUsers())},[]);
 const counts=useMemo(()=>({admins:users.filter(u=>u.role==="admin").length,employees:users.filter(u=>u.role==="employee").length,customers:users.filter(u=>u.role==="customer").length}),[users]);
 async function createUser(){
  if(!fullName||!email){setMsg("Full name and email are required.");return}
  const row:LocalUser={id:createId(),full_name:fullName,email,phone,role,active:true,created_at:new Date().toISOString()};
  const next=[row,...users];setUsers(next);saveUsers(next);setFullName("");setEmail("");setPhone("");setRole("customer");
  if(isSupabaseConfigured()){
    try{const supabase=getSupabaseBrowserClient() as any; const {error}=await supabase.from("profiles").insert({full_name:row.full_name,email:row.email,phone:row.phone,role:row.role,active:true}); setMsg(error?`Saved locally. Supabase profile insert needs auth user id: ${error.message}`:"User saved to Supabase profile table.");}
    catch(err){setMsg(err instanceof Error?`Saved locally. Supabase: ${err.message}`:"Saved locally. Supabase insert failed.")}
  } else setMsg("User saved in local demo mode. Configure Supabase to save real users.");
 }
 function toggle(id:string){const next=users.map(u=>u.id===id?{...u,active:!u.active}:u);setUsers(next);saveUsers(next)}
 return <AdminShell active="Users">
  <div className="business-hero"><div><span className="eyebrow">V41.1 User Foundation</span><h1>Users and roles</h1><p>Create the people who will access Admin, Employee and Customer portals. Employees still cannot see finance.</p></div></div>
  <section className="business-metrics"><div className="business-metric"><span>Admins</span><strong>{counts.admins}</strong><small>Can see everything</small></div><div className="business-metric"><span>Employees</span><strong>{counts.employees}</strong><small>No finance access</small></div><div className="business-metric"><span>Customers</span><strong>{counts.customers}</strong><small>Only their properties</small></div></section>
  <section className="card table-card" style={{marginTop:20}}><div className="table-head"><div><h2>Create user</h2><p className="section-intro">Simple first: name, email, role. Later we will add invite emails and password reset.</p></div></div><div className="form-grid four"><label>Full name<input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Customer or employee name"/></label><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@company.com"/></label><label>Phone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="905..."/></label><label>Role<select value={role} onChange={e=>setRole(e.target.value as Role)}><option value="admin">Admin</option><option value="employee">Employee</option><option value="customer">Customer</option></select></label></div><button className="btn btn-primary" onClick={createUser}>Create User</button>{msg&&<p className="auth-message inline">{msg}</p>}</section>
  <section className="card table-card" style={{marginTop:20}}><div className="table-head"><div><h2>Workspace users</h2><p className="section-intro">This is the visible beginning of real login and permissions.</p></div></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td>{u.full_name}</td><td>{u.email}</td><td><span className="pill">{u.role}</span></td><td>{u.active?"Active":"Inactive"}</td><td><button className="btn btn-outline dark-safe" onClick={()=>toggle(u.id)}>{u.active?"Deactivate":"Activate"}</button></td></tr>)}</tbody></table></div></section>
 </AdminShell>
}
