"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clearDemoSession, readDemoSession } from "@/lib/auth/demoAuth";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {Estimate,getEstimates,reviseEstimateTotal,updateEstimateStatus} from "@/lib/storage";
import {loadSeasonTheme,saveLocalSeasonTheme,updateSeasonTheme,type Season,type SeasonMode} from "@/lib/seasonTheme";

type Tab = "companies" | "leads" | "quotes" | "theme" | "access" | "health" | "audit";
type Company = { id:string; name:string; slug:string; active:boolean; plan_name:string; contact_email?:string; created_at?:string };
type CompanyMember = { id:string; company_id:string; kind:"admin"|"employee"|"customer"; name:string; email?:string; active:boolean };
type Lead = { id:string; full_name:string; email?:string; phone?:string; address?:string; service_requested?:string; status:string; assigned_company_id?:string; created_at?:string };
type AccessRequest = { id:string; company_id:string; access_level:string; delivery_channel:string; request_reason?:string; code_expires_at:string; approved_at?:string; revoked_at?:string; created_at?:string; demo_code?:string };
type Audit = { id:string; action:string; company_id?:string; details?:Record<string,unknown>; created_at?:string };
type Profile = { id:string; role:string; full_name?:string; email?:string };

const DEMO_COMPANIES:Company[]=[
  {id:"demo-company",name:"Damasio Seasons",slug:"damasio-seasons",active:true,plan_name:"Professional",contact_email:"admin@damasioos.demo"},
  {id:"demo-company-2",name:"Green North Landscaping",slug:"green-north",active:true,plan_name:"Standard",contact_email:"owner@greennorth.demo"},
];
const DEMO_MEMBERS:CompanyMember[]=[
  {id:"m1",company_id:"demo-company",kind:"admin",name:"Filipe Damasio",email:"admin@damasioos.demo",active:true},
  {id:"m2",company_id:"demo-company",kind:"employee",name:"Lucas Field",email:"lucas@damasioos.demo",active:true},
  {id:"m3",company_id:"demo-company",kind:"employee",name:"Andre Crew",email:"andre@damasioos.demo",active:true},
  {id:"m4",company_id:"demo-company",kind:"customer",name:"John Smith",email:"john@example.com",active:true},
  {id:"m5",company_id:"demo-company",kind:"customer",name:"Maria Costa",email:"maria@example.com",active:true},
  {id:"m6",company_id:"demo-company-2",kind:"admin",name:"Emma Green",email:"owner@greennorth.demo",active:true},
  {id:"m7",company_id:"demo-company-2",kind:"employee",name:"Noah Crew",email:"noah@greennorth.demo",active:true},
  {id:"m8",company_id:"demo-company-2",kind:"customer",name:"William Brown",email:"will@example.com",active:true},
];
const DEMO_LEADS:Lead[]=[
  {id:"lead-demo-1",full_name:"Sophie Martin",email:"sophie@example.com",phone:"905-555-0144",address:"120 King St W, Hamilton, ON",service_requested:"Weekly Lawn Care",status:"offered",assigned_company_id:"demo-company",created_at:new Date().toISOString()},
];
function uid(prefix:string){return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`}
function now(){return new Date().toISOString()}
function readLocal<T>(key:string,fallback:T):T{try{return JSON.parse(localStorage.getItem(key)||"") as T}catch{return fallback}}

export default function MasterPage(){
  const router=useRouter();
  const[tab,setTab]=useState<Tab>("companies");
  const[profile,setProfile]=useState<Profile|null>(null);
  const[companies,setCompanies]=useState<Company[]>([]);
  const[members,setMembers]=useState<CompanyMember[]>([]);
  const[leads,setLeads]=useState<Lead[]>([]);
  const[quotes,setQuotes]=useState<Estimate[]>([]);
  const[requests,setRequests]=useState<AccessRequest[]>([]);
  const[audit,setAudit]=useState<Audit[]>([]);
  const[selectedCompany,setSelectedCompany]=useState<Company|null>(null);
  const[loading,setLoading]=useState(true);
  const[message,setMessage]=useState("Checking Master access...");
  const[query,setQuery]=useState("");
  const[showCompanyForm,setShowCompanyForm]=useState(false);
  const[showLeadForm,setShowLeadForm]=useState(false);
  const[accessCompany,setAccessCompany]=useState<Company|null>(null);
  const[approveRequest,setApproveRequest]=useState<AccessRequest|null>(null);
  const[isDemo,setIsDemo]=useState(false);
  const[quoteAmounts,setQuoteAmounts]=useState<Record<string,string>>({});
  const[seasonMode,setSeasonMode]=useState<SeasonMode>("auto");
  const[season,setSeason]=useState<Season>("summer");
  const[savingTheme,setSavingTheme]=useState(false);

  function refreshQuotes(){const rows=getEstimates();setQuotes(rows);setQuoteAmounts(Object.fromEntries(rows.map(quote=>[quote.id,String(quote.total)])))}
  useEffect(()=>{refreshQuotes();const on=()=>refreshQuotes();window.addEventListener("storage",on);return()=>window.removeEventListener("storage",on)},[]);
  useEffect(()=>{void loadSeasonTheme().then(config=>{setSeasonMode(config.mode);setSeason(config.season)})},[]);
  function reviseQuote(quote:Estimate){const next=reviseEstimateTotal(quote.id,Number(quoteAmounts[quote.id]||quote.total));if(next){refreshQuotes();setMessage(`${quote.number} revised to $${next.total.toFixed(2)}.`)}}
  function sendQuote(quote:Estimate){reviseEstimateTotal(quote.id,Number(quoteAmounts[quote.id]||quote.total));updateEstimateStatus(quote.id,"sent");refreshQuotes();setMessage(`${quote.number} sent to ${quote.email}. Invitation: /signup?quote=${encodeURIComponent(quote.number)}`)}
  async function saveSeason(){setSavingTheme(true);try{const config=await updateSeasonTheme(seasonMode,season);setMessage(`Saved. ${config.effectiveSeason} is now the platform theme and will load for every user after refresh or app restart.`)}catch(error){saveLocalSeasonTheme(seasonMode,season);setMessage(error instanceof Error?`${error.message} Only this device was updated. Sign in as a real Master and confirm the season migration is installed to publish globally.`:"Only this device was updated.")}finally{setSavingTheme(false)}}

  useEffect(()=>{let alive=true;void(async()=>{
    const demo=readDemoSession();
    if(demo?.role==="master"){
      if(!alive)return;setIsDemo(true);setProfile({id:"demo-master",role:"master",full_name:demo.name,email:demo.email});
      setCompanies(readLocal("damasio_master_companies",DEMO_COMPANIES));
      setMembers(readLocal("damasio_master_members",DEMO_MEMBERS));
      setLeads(readLocal("damasio_master_leads",DEMO_LEADS));
      setRequests(readLocal("damasio_master_access",[]));setAudit(readLocal("damasio_master_audit",[]));setMessage("");setLoading(false);return;
    }
    if(!isSupabaseConfigured()){router.replace("/login");return;}
    const supabase=getSupabaseBrowserClient() as any;const {data:auth}=await supabase.auth.getUser();const user=auth?.user;
    if(!user){router.replace("/login");return;}
    const {data:p}=await supabase.from("profiles").select("id,role,full_name,email").eq("id",user.id).single();
    if(p?.role!=="master"){router.replace("/login");return;}
    const [c,l,r,a,admins,employees,customers]=await Promise.all([
      supabase.from("organizations").select("id,name,slug,active,plan_name,contact_email,created_at").order("created_at",{ascending:false}),
      supabase.from("lead_center").select("*").order("created_at",{ascending:false}),
      supabase.from("master_company_access_requests").select("*").order("created_at",{ascending:false}),
      supabase.from("master_audit_log").select("*").order("created_at",{ascending:false}).limit(100),
      supabase.from("profiles").select("id,company_id,organization_id,full_name,email,active").eq("role","admin"),
      supabase.from("employees").select("id,organization_id,full_name,email,active"),
      supabase.from("customers").select("id,organization_id,full_name,email"),
    ]);
    if(!alive)return;setProfile(p);setCompanies(c.data||[]);setLeads(l.data||[]);setRequests(r.data||[]);setAudit(a.data||[]);
    setMembers([
      ...(admins.data||[]).map((x:any)=>({id:x.id,company_id:x.company_id||x.organization_id,kind:"admin",name:x.full_name,email:x.email,active:x.active})),
      ...(employees.data||[]).map((x:any)=>({id:x.id,company_id:x.organization_id,kind:"employee",name:x.full_name,email:x.email,active:x.active})),
      ...(customers.data||[]).map((x:any)=>({id:x.id,company_id:x.organization_id,kind:"customer",name:x.full_name,email:x.email,active:true})),
    ]);setMessage(c.error?.message||l.error?.message||"");setLoading(false);
  })();return()=>{alive=false}},[router]);

  useEffect(()=>{if(isDemo)localStorage.setItem("damasio_master_companies",JSON.stringify(companies))},[companies,isDemo]);
  useEffect(()=>{if(isDemo)localStorage.setItem("damasio_master_members",JSON.stringify(members))},[members,isDemo]);
  useEffect(()=>{if(isDemo)localStorage.setItem("damasio_master_leads",JSON.stringify(leads))},[leads,isDemo]);
  useEffect(()=>{if(isDemo)localStorage.setItem("damasio_master_access",JSON.stringify(requests))},[requests,isDemo]);
  useEffect(()=>{if(isDemo)localStorage.setItem("damasio_master_audit",JSON.stringify(audit))},[audit,isDemo]);

  const companyName=(id?:string)=>companies.find(c=>c.id===id)?.name||"Unassigned";
  const filteredCompanies=useMemo(()=>companies.filter(c=>`${c.name} ${c.slug} ${c.contact_email||""}`.toLowerCase().includes(query.toLowerCase())),[companies,query]);
  const companyMembers=(id:string,kind?:CompanyMember["kind"])=>members.filter(m=>m.company_id===id&&(!kind||m.kind===kind));
  const addAudit=(action:string,company_id?:string,details:Record<string,unknown>={})=>setAudit(v=>[{id:uid("audit"),action,company_id,details,created_at:now()},...v]);

  async function createCompany(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const name=String(fd.get("name")||"").trim();if(!name)return;
    const row:Company={id:uid("company"),name,slug:String(fd.get("slug")||name.toLowerCase().replace(/[^a-z0-9]+/g,"-")).replace(/^-|-$/g,""),active:true,plan_name:String(fd.get("plan")||"standard"),contact_email:String(fd.get("email")||"")};
    if(isDemo){setCompanies(v=>[row,...v]);setMembers(v=>[{id:uid("admin"),company_id:row.id,kind:"admin",name:String(fd.get("adminName")||"Company Admin"),email:row.contact_email,active:true},...v]);addAudit("company.created",row.id,{name:row.name});setShowCompanyForm(false);return;}
    const supabase=getSupabaseBrowserClient() as any;const {data,error}=await supabase.from("organizations").insert({...row,id:undefined}).select().single();if(error){setMessage(error.message);return;}setCompanies(v=>[data,...v]);setShowCompanyForm(false);
  }
  async function createLead(e:FormEvent<HTMLFormElement>){e.preventDefault();const fd=new FormData(e.currentTarget);const row:Lead={id:uid("lead"),full_name:String(fd.get("name")||""),email:String(fd.get("email")||""),phone:String(fd.get("phone")||""),address:String(fd.get("address")||""),service_requested:String(fd.get("service")||""),assigned_company_id:String(fd.get("company")||"")||undefined,status:String(fd.get("company")||"")?"offered":"new",created_at:now()};
    if(isDemo){setLeads(v=>[row,...v]);addAudit("lead.created",row.assigned_company_id,{lead:row.full_name});setShowLeadForm(false);return;}
    const supabase=getSupabaseBrowserClient() as any;const {data,error}=await supabase.from("lead_center").insert({...row,id:undefined,created_by_master_id:profile?.id}).select().single();if(error){setMessage(error.message);return;}setLeads(v=>[data,...v]);setShowLeadForm(false);
  }
  async function requestAccess(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!accessCompany)return;const fd=new FormData(e.currentTarget);const code=String(Math.floor(100000+Math.random()*900000));const row:AccessRequest={id:uid("access"),company_id:accessCompany.id,access_level:String(fd.get("level")),delivery_channel:String(fd.get("channel")),request_reason:String(fd.get("reason")||""),code_expires_at:new Date(Date.now()+30*60000).toISOString(),created_at:now(),demo_code:code};
    if(isDemo){setRequests(v=>[row,...v]);addAudit("access.requested",row.company_id,{level:row.access_level,channel:row.delivery_channel});setMessage(`Authorization code ${code} sent by ${row.delivery_channel}. It expires in 30 minutes.`);setAccessCompany(null);return;}
    setAccessCompany(null);setMessage("Production temporary access is disabled until server-side code hashing and delivery are configured.");
  }
  async function authorizeAccess(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!approveRequest)return;const code=String(new FormData(e.currentTarget).get("code")||"");if(new Date(approveRequest.code_expires_at).getTime()<Date.now()){setMessage("This code expired. Create a new request.");return;}if(isDemo&&code!==approveRequest.demo_code){setMessage("Invalid authorization code.");return;}
    if(!isDemo){setApproveRequest(null);setMessage("Production access cannot be approved in the browser. Server-side verification is required.");return;}
    const approvedAt=now();setRequests(v=>v.map(r=>r.id===approveRequest.id?{...r,approved_at:approvedAt}:r));addAudit("access.approved",approveRequest.company_id,{level:approveRequest.access_level});setSelectedCompany(companies.find(c=>c.id===approveRequest.company_id)||null);setApproveRequest(null);setTab("companies");setMessage(`Temporary ${approveRequest.access_level.replaceAll("_"," ")} access approved for 30 minutes.`);
  }
  function toggleCompany(c:Company){setCompanies(v=>v.map(x=>x.id===c.id?{...x,active:!x.active}:x));addAudit(c.active?"company.deactivated":"company.activated",c.id);}
  async function signOut(){if(isDemo)clearDemoSession();else{const supabase=getSupabaseBrowserClient() as any;await supabase.auth.signOut()}router.replace("/login")}

  if(loading)return <main className="master-gate"><div className="master-gate-card"><strong>Damasio OS</strong><p>{message}</p></div></main>;
  return <main className="master-shell">
    <aside className="master-sidebar"><div><span className="master-kicker">CONTROL PLANE</span><h1>Damasio <b>Master</b></h1></div><nav>
      <button className={tab==="companies"?"active":""} onClick={()=>setTab("companies")}>Companies <span>{companies.length}</span></button>
      <button className={tab==="leads"?"active":""} onClick={()=>setTab("leads")}>Lead Center <span>{leads.length}</span></button>
      <button className={tab==="quotes"?"active":""} onClick={()=>setTab("quotes")}>Quote Review <span>{quotes.filter(q=>q.status==="draft").length}</span></button>
      <button className={tab==="theme"?"active":""} onClick={()=>setTab("theme")}>Season Theme <span>◉</span></button>
      <button className={tab==="access"?"active":""} onClick={()=>setTab("access")}>Access Requests <span>{requests.length}</span></button>
      <button className={tab==="health"?"active":""} onClick={()=>setTab("health")}>Health Check <span>{companies.length}</span></button>
      <button className={tab==="audit"?"active":""} onClick={()=>setTab("audit")}>Audit Logs <span>{audit.length}</span></button>
    </nav><div className="master-user"><strong>{profile?.full_name||"Master"}</strong><small>{profile?.email}</small>{isDemo&&<small className="master-demo-badge">Visible demo access</small>}<button onClick={signOut}>Sign out</button></div></aside>
    <section className="master-content">{message&&<div className="master-alert">{message}<button onClick={()=>setMessage("")}>×</button></div>}
      {tab==="companies"&&<><header className="master-header"><div><span className="master-kicker">V51.1 MULTI COMPANY COMPLETE</span><h2>Companies</h2><p>Company data, people, leads and temporary access now work together.</p></div><div className="master-summary"><b>{companies.filter(c=>c.active).length}</b><span>active</span></div></header>
      <div className="master-toolbar"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search companies"/><button onClick={()=>setShowCompanyForm(true)}>+ New company</button></div>
      <div className="master-company-grid">{filteredCompanies.map(c=><article className="master-company-card" key={c.id}><div className="master-company-top"><span>{c.name[0]}</span><em className={c.active?"active":"inactive"}>{c.active?"Active":"Inactive"}</em></div><h3>{c.name}</h3><p>{c.contact_email||c.slug}</p><dl><div><dt>Plan</dt><dd>{c.plan_name}</dd></div><div><dt>Admins</dt><dd>{companyMembers(c.id,"admin").length}</dd></div><div><dt>Employees</dt><dd>{companyMembers(c.id,"employee").length}</dd></div><div><dt>Customers</dt><dd>{companyMembers(c.id,"customer").length}</dd></div></dl><div className="master-card-actions"><button onClick={()=>setSelectedCompany(c)}>Open company</button><button className="secondary" onClick={()=>setAccessCompany(c)}>Request access</button></div></article>)}</div></>}
      {tab==="leads"&&<><header className="master-header"><div><span className="master-kicker">LEAD DISTRIBUTION</span><h2>Lead Center</h2><p>Master offers the client. The selected company accepts or declines from its own Referral Inbox.</p></div><button className="master-primary" onClick={()=>setShowLeadForm(true)}>+ New lead</button></header><div className="master-table-wrap"><table className="master-table"><thead><tr><th>Lead</th><th>Service</th><th>Company</th><th>Status</th><th></th></tr></thead><tbody>{leads.map(l=><tr key={l.id}><td><strong>{l.full_name}</strong><small>{l.address||l.email||l.phone}</small></td><td>{l.service_requested||"—"}</td><td>{companyName(l.assigned_company_id)}</td><td><span className="master-status">{l.status}</span></td><td><small>{l.status==="offered"?"Waiting for company":l.status}</small></td></tr>)}</tbody></table>{!leads.length&&<div className="master-empty">No leads yet.</div>}</div></>}
      {tab==="quotes"&&<><header className="master-header"><div><span className="master-kicker">MASTER QUOTE DESK</span><h2>Quote Review</h2><p>Review website requests, change the final amount and send the customer an account invitation.</p></div><div className="master-summary"><b>{quotes.filter(q=>q.status==="draft").length}</b><span>waiting review</span></div></header><div className="master-table-wrap"><table className="master-table"><thead><tr><th>Quote / customer</th><th>Service</th><th>Requested</th><th>Final total</th><th>Status</th><th>Action</th></tr></thead><tbody>{quotes.map(q=><tr key={q.id}><td><strong>{q.number}</strong><small>{q.customer} · {q.email}</small></td><td>{q.title}<small>{q.address}</small></td><td>${q.total.toFixed(2)}</td><td><input className="input" type="number" min="0" step="0.01" value={quoteAmounts[q.id]??q.total} onChange={e=>setQuoteAmounts(v=>({...v,[q.id]:e.target.value}))}/></td><td><span className="master-status">{q.status}</span></td><td><div className="row"><button className="master-inline-button" onClick={()=>reviseQuote(q)}>Save</button><button className="master-inline-button" disabled={q.status==="approved"||q.status==="declined"} onClick={()=>sendQuote(q)}>Send + invite</button></div></td></tr>)}</tbody></table>{!quotes.length&&<div className="master-empty">Website quote requests will appear here.</div>}</div></>}
      {tab==="theme"&&<><header className="master-header"><div><span className="master-kicker">GLOBAL EXPERIENCE</span><h2>Season Theme</h2><p>Select the experience, then publish it to desktop and the Employee app.</p></div><div className="master-summary"><b>{seasonMode==="auto"?"Auto":season}</b><span>selected mode</span></div></header><section className="master-season-panel"><div className="master-season-mode"><button className={seasonMode==="auto"?"active":""} onClick={()=>setSeasonMode("auto")}>Automatic</button><button className={seasonMode==="manual"?"active":""} onClick={()=>setSeasonMode("manual")}>Manual</button></div><p>{seasonMode==="auto"?"Northern hemisphere schedule: Spring Mar–May, Summer Jun–Aug, Autumn Sep–Nov, Winter Dec–Feb.":"The selected season remains active until Master changes and saves it."}</p><div className="master-season-grid">{([['spring','🌸','Spring','Fresh green with petals on the left'],['summer','🌿','Summer','Lawn mowing and bright greens'],['autumn','🍂','Autumn','Warm colours, leaves and rake'],['winter','❄','Winter','Falling snow and snow shovel']] as [Season,string,string,string][]).map(([key,icon,label,description])=><button key={key} className={season===key?"active":""} onClick={()=>{setSeasonMode("manual");setSeason(key)}}><i>{icon}</i><strong>{label}</strong><small>{description}</small></button>)}</div><div className="master-season-save"><span>Changes are published only after saving.</span><button className="master-primary" disabled={savingTheme} onClick={()=>void saveSeason()}>{savingTheme?"Saving…":"Save for everyone"}</button></div></section></>}
      {tab==="access"&&<><header className="master-header"><div><span className="master-kicker">TEMPORARY AUTHORIZATION</span><h2>Access Requests</h2><p>Codes expire in 30 minutes and approve only the selected company and level.</p></div></header><div className="master-list">{requests.map(r=><article key={r.id}><div><strong>{companyName(r.company_id)}</strong><small>{r.request_reason||"No reason provided"}</small></div><div><span>{r.access_level.replaceAll("_"," ")}</span><span>{r.delivery_channel}</span>{r.approved_at?<span className="approved">Approved</span>:<button className="master-inline-button" onClick={()=>setApproveRequest(r)}>Enter code</button>}</div></article>)}{!requests.length&&<div className="master-empty">No access requests yet.</div>}</div></>}
      {tab==="health"&&<><header className="master-header"><div><span className="master-kicker">MULTI COMPANY INTEGRITY</span><h2>Health Check</h2><p>Operational score and tenant integrity overview for every company.</p></div><div className="master-summary"><b>{Math.round(companies.reduce((sum,c)=>sum+Math.max(70,100-(companyMembers(c.id,"customer").length===0?12:0)-(companyMembers(c.id,"admin").length===0?18:0)),0)/Math.max(1,companies.length))}%</b><span>platform score</span></div></header><div className="master-company-grid master-health-grid">{companies.map(c=>{const admins=companyMembers(c.id,"admin").length;const employees=companyMembers(c.id,"employee").length;const customers=companyMembers(c.id,"customer").length;const openLeads=leads.filter(l=>l.assigned_company_id===c.id&&l.status!=="converted").length;const openAccess=requests.filter(r=>r.company_id===c.id&&!r.revoked_at&&(!r.approved_at||new Date(r.code_expires_at)>new Date())).length;const score=Math.max(70,100-(admins===0?18:0)-(customers===0?12:0)-(c.active?0:10)-Math.min(10,openLeads*2));return <article className="master-company-card" key={c.id}><div className="master-health-score"><strong>{score}%</strong><span className={score>=90?"healthy":score>=80?"warning":"critical"}>{score>=90?"Healthy":score>=80?"Review":"Attention"}</span></div><h3>{c.name}</h3><dl><div><dt>Admins</dt><dd>{admins}</dd></div><div><dt>Employees</dt><dd>{employees}</dd></div><div><dt>Customers</dt><dd>{customers}</dd></div><div><dt>Open leads</dt><dd>{openLeads}</dd></div><div><dt>Access sessions</dt><dd>{openAccess}</dd></div></dl><button onClick={()=>setSelectedCompany(c)}>Open company</button></article>})}</div></>}
      {tab==="audit"&&<><header className="master-header"><div><span className="master-kicker">SECURITY HISTORY</span><h2>Audit Logs</h2><p>Company creation, lead conversion and Master access are recorded.</p></div></header><div className="master-list">{audit.map(a=><article key={a.id}><div><strong>{a.action}</strong><small>{companyName(a.company_id)}</small></div><time>{a.created_at?new Date(a.created_at).toLocaleString():""}</time></article>)}{!audit.length&&<div className="master-empty">No audit events yet.</div>}</div></>}
    </section>
    {selectedCompany&&<Modal title={selectedCompany.name} onClose={()=>setSelectedCompany(null)}><div className="master-company-detail"><div className="master-detail-summary"><span className={selectedCompany.active?"active":"inactive"}>{selectedCompany.active?"Active":"Inactive"}</span><strong>{selectedCompany.plan_name}</strong><small>{selectedCompany.contact_email}</small></div>{(["admin","employee","customer"] as const).map(kind=><section key={kind}><h4>{kind==="admin"?"Admins":kind==="employee"?"Employees":"Customers"} <span>{companyMembers(selectedCompany.id,kind).length}</span></h4>{companyMembers(selectedCompany.id,kind).map(m=><div className="master-person" key={m.id}><div><strong>{m.name}</strong><small>{m.email}</small></div><em>{m.active?"Active":"Inactive"}</em></div>)}{!companyMembers(selectedCompany.id,kind).length&&<p className="master-muted">No {kind}s yet.</p>}</section>)}<div className="master-detail-actions"><button onClick={()=>toggleCompany(selectedCompany)}>{selectedCompany.active?"Deactivate company":"Activate company"}</button><button className="secondary" onClick={()=>{setSelectedCompany(null);setAccessCompany(selectedCompany)}}>Request temporary access</button></div></div></Modal>}
    {showCompanyForm&&<Modal title="New company" onClose={()=>setShowCompanyForm(false)}><form className="master-form" onSubmit={createCompany}><label>Company name<input name="name" required/></label><label>Slug<input name="slug" placeholder="generated automatically"/></label><label>First Admin name<input name="adminName" required/></label><label>Admin email<input name="email" type="email" required/></label><label>Plan<select name="plan"><option>standard</option><option>professional</option><option>enterprise</option></select></label><button>Create company + Admin</button></form></Modal>}
    {showLeadForm&&<Modal title="New lead" onClose={()=>setShowLeadForm(false)}><form className="master-form" onSubmit={createLead}><label>Customer name<input name="name" required/></label><label>Email<input name="email" type="email"/></label><label>Phone<input name="phone"/></label><label>Address<input name="address" required/></label><label>Service requested<input name="service" required/></label><label>Assign company<select name="company"><option value="">Unassigned</option>{companies.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button>Create and notify</button></form></Modal>}
    {accessCompany&&<Modal title={`Access ${accessCompany.name}`} onClose={()=>setAccessCompany(null)}><form className="master-form" onSubmit={requestAccess}><label>Access level<select name="level"><option value="read_only">Read only</option><option value="operational_support">Operational support</option><option value="full_temporary">Full temporary access</option></select></label><label>Code delivery<select name="channel"><option value="system">System</option><option value="email">Email</option><option value="both">System + Email</option></select></label><label>Reason<textarea name="reason" placeholder="Support reason (optional)"/></label><p className="master-form-note">The one-time code expires in 30 minutes.</p><button>Send authorization code</button></form></Modal>}
    {approveRequest&&<Modal title="Authorize temporary access" onClose={()=>setApproveRequest(null)}><form className="master-form" onSubmit={authorizeAccess}><p className="master-form-note">Enter the 6-digit code received by the company.</p>{isDemo&&<p className="master-demo-code">Demo code: <strong>{approveRequest.demo_code}</strong></p>}<label>Authorization code<input name="code" inputMode="numeric" maxLength={6} required/></label><button>Approve access</button></form></Modal>}
  </main>
}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){return <div className="master-modal-backdrop" onMouseDown={onClose}><section className="master-modal" role="dialog" aria-modal="true" onMouseDown={e=>e.stopPropagation()}><header><h3>{title}</h3><button onClick={onClose}>×</button></header>{children}</section></div>}
