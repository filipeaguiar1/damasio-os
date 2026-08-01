"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

type Role="master"|"admin"|"manager"|"employee"|"customer";
function roleHome(role:Role){if(role==="master")return"/master";if(role==="admin"||role==="manager")return"/mobile/admin";if(role==="employee")return"/mobile/employee";return"/mobile/customer"}

const LEGACY_LOCAL_KEYS=[
  "damasio_os_session","damasio_os_leads","damasio_os_expenses","damasio_os_invoices","damasio_os_daily_checklists","damasio_os_notifications","damasio_os_customer_recommendations","damasio_os_recurrences","damasio_os_estimates","damasio_os_service_sessions","damasio_os_employee_tasks","damasio_os_activity_log","damasio_os_workflow_events","damasio_os_service_requests","damasio_os_customer_payment_profile","damasio_os_crews","damasio_os_users","damasio_os_routes","damasio_os_fuel","damasio_os_gas","damasio_os_demo_loaded"
];
function clearLegacyLocalData(){
  if(typeof window==="undefined")return;
  try{LEGACY_LOCAL_KEYS.forEach(key=>window.localStorage.removeItem(key));}catch{/* browser storage must never block secure access */}
}

async function bootstrapEmployee(client:any){
  try{const{data}=await client.auth.getSession();const token=data.session?.access_token;if(!token)return;await fetch("/api/mobile/employee/bootstrap",{method:"POST",headers:{authorization:`Bearer ${token}`},cache:"no-store"});}catch{/* account repair must not block field access */}
}

export function MobileRoleGuard({allowed,children}:{allowed:Role[];children:React.ReactNode}){
  const router=useRouter();const[ready,setReady]=useState(false);const allowedKey=allowed.join(",");
  useEffect(()=>{let active=true;void(async()=>{if(!isSupabaseConfigured()){router.replace("/mobile/login");return}const client=getSupabaseBrowserClient() as any;const{data:auth}=await client.auth.getUser();if(!auth?.user){router.replace("/mobile/login");return}const{data:profile}=await client.from("profiles").select("role,active").eq("id",auth.user.id).single();if(!profile?.active){await client.auth.signOut();router.replace("/mobile/login?inactive=1");return}clearLegacyLocalData();const role=profile.role as Role;if(allowed.includes(role)){if(role==="employee")await bootstrapEmployee(client);if(active)setReady(true)}else router.replace(roleHome(role))})();return()=>{active=false}},[allowedKey,router]);
  if(!ready)return <main className="mobile-splash"><div className="mobile-logo-pulse"><span>4</span></div><h1>4Ever Seasons</h1><p>Checking secure access…</p></main>;
  return <>{children}</>;
}
