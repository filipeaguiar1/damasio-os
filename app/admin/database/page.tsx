"use client";
import {useEffect, useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {isSupabaseConfigured} from "@/lib/supabase/client";
import {CORE_DATABASE_TABLES, STORAGE_BUCKETS} from "@/lib/config/database";
import {runSupabaseHealthCheck, type HealthItem} from "@/lib/services/healthService";

type CheckStatus="ready"|"missing"|"checking"|"connected"|"error";

const setupSteps=[
  "Confirm .env.local is configured.",
  "If tables/buckets fail, run supabase/00_run_this_first_database_setup.sql in Supabase SQL Editor.",
  "Restart npm run dev.",
  "Click Run Live Health Check.",
  "Only after green status, migrate Customers and Properties."
];

function initialItems(names: readonly string[], label="Not tested yet"): HealthItem[]{
  return names.map(name=>({name,status:"pending",details:label}));
}

function StatusTable({title,items}:{title:string;items:HealthItem[]}){
  return <section className="card table-card" style={{marginTop:20}}>
    <div className="table-head"><div><h2>{title}</h2></div></div>
    <div className="table-wrap"><table><thead><tr><th>Item</th><th>Status</th><th>Details</th></tr></thead><tbody>
      {items.map(row=><tr key={row.name}><td>{row.name}</td><td>{row.status==="ok"?"OK":row.status==="error"?"Error":"Pending"}</td><td>{row.details}</td></tr>)}
    </tbody></table></div>
  </section>
}

export default function DatabasePage(){
  const[status,setStatus]=useState<CheckStatus>(isSupabaseConfigured()?"ready":"missing");
  const[hasRun,setHasRun]=useState(false);
  const[message,setMessage]=useState(isSupabaseConfigured()?"Environment keys found. Run the SQL setup file, restart the app, then test health.":"Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.");
  const[environment,setEnvironment]=useState<HealthItem[]>(initialItems(["Project URL","Publishable key"]));
  const[auth,setAuth]=useState<HealthItem[]>(initialItems(["Supabase Auth"]));
  const[storage,setStorage]=useState<HealthItem[]>(initialItems(STORAGE_BUCKETS));
  const[tables,setTables]=useState<HealthItem[]>(initialItems(CORE_DATABASE_TABLES));

  async function testConnection(){
    setHasRun(true);
    if(!isSupabaseConfigured()){
      setStatus("missing");
      setMessage("Supabase is not configured yet. Fill .env.local first.");
      return;
    }
    setStatus("checking");
    setMessage("Testing Supabase environment, auth, storage and database...");
    try{
      const report=await runSupabaseHealthCheck();
      setEnvironment(report.environment);
      setAuth(report.auth.length?report.auth:initialItems(["Supabase Auth"],"Skipped"));
      setStorage(report.storage.length?report.storage:initialItems(STORAGE_BUCKETS,"Skipped"));
      setTables(report.tables.length?report.tables:initialItems(CORE_DATABASE_TABLES,"Skipped"));
      setStatus(report.ok?"connected":"error");
      setMessage(report.ok?"Supabase foundation is healthy. We can safely start migrating Customers and Properties.":"Some checks failed. Review the red rows and run the setup SQL again if needed.");
    }catch(err){
      setStatus("error");
      setMessage(err instanceof Error?err.message:"Could not test Supabase connection.");
    }
  }

  useEffect(()=>{
    if(isSupabaseConfigured() && !hasRun){
      void testConnection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  return <AdminShell active="Database">
    <div className="business-hero">
      <div>
        <span className="eyebrow">V42.0.3 Live Supabase Health Check</span>
        <h1>Database foundation</h1>
        <p>This page runs a real Supabase test from the app. Click the button or wait for the automatic check.</p>
      </div>
      <div className="hero-actions"><button className="btn btn-primary" onClick={testConnection} disabled={status==="checking"}>{status==="checking"?"Checking...":"Run Live Health Check"}</button><Link className="btn btn-white" href="/login">Demo Login</Link></div>
    </div>

    <section className="business-metrics">
      <div className={`business-metric ${status==="connected"?"":"warn"}`}><span>Health</span><strong>{status==="connected"?"Healthy":status==="checking"?"Checking":status==="ready"?"Ready":"Action needed"}</strong><small>{message}</small></div>
      <div className="business-metric"><span>Architecture</span><strong>UI → Service → Repository</strong><small>No screen talks directly to Supabase</small></div>
      <div className="business-metric"><span>Storage</span><strong>{STORAGE_BUCKETS.length} buckets</strong><small>Prepared for future photos and documents</small></div>
      <div className="business-metric"><span>Core tables</span><strong>{CORE_DATABASE_TABLES.length}</strong><small>Checked through database_health_check()</small></div>
    </section>

    <section className="suite-grid">
      {setupSteps.map((step,index)=><div className="suite-card crm" key={step}><b>{String(index+1).padStart(2,"0")}</b><h2>{step}</h2><p>{index===1?"Use the single setup file. It includes schema, RLS policies, storage buckets, demo data and the health check function.":"Complete this step before moving to the next one."}</p><span>{index===1?"supabase/00_run_this_first_database_setup.sql":"Setup step →"}</span></div>)}
    </section>

    <StatusTable title="Environment check" items={environment}/>
    <StatusTable title="Auth check" items={auth}/>
    <StatusTable title="Storage bucket check" items={storage}/>
    <StatusTable title="Database table check" items={tables}/>

    <section className="card" style={{marginTop:20}}>
      <h2>Next after all checks pass</h2>
      <p className="section-intro">Start V42.1 by connecting Customers and Properties to real Supabase repositories, one module at a time.</p>
    </section>
  </AdminShell>
}
