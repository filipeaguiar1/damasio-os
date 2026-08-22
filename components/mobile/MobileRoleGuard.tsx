"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

type Role="master"|"admin"|"manager"|"employee"|"customer";
type GuardState="checking"|"ready"|"error";
function roleHome(role:Role){if(role==="master")return"/master";if(role==="admin"||role==="manager")return"/mobile/admin";if(role==="employee")return"/mobile/employee";return"/mobile/customer"}

const LEGACY_LOCAL_KEYS=[
  "damasio_os_session","damasio_os_leads","damasio_os_expenses","damasio_os_invoices","damasio_os_daily_checklists","damasio_os_notifications","damasio_os_customer_recommendations","damasio_os_recurrences","damasio_os_estimates","damasio_os_service_sessions","damasio_os_employee_tasks","damasio_os_activity_log","damasio_os_workflow_events","damasio_os_service_requests","damasio_os_customer_payment_profile","damasio_os_crews","damasio_os_users","damasio_os_routes","damasio_os_fuel","damasio_os_gas","damasio_os_demo_loaded"
];
const AUTH_TIMEOUT_MS=8000;

function clearLegacyLocalData(){
  if(typeof window==="undefined")return;
  try{LEGACY_LOCAL_KEYS.forEach(key=>window.localStorage.removeItem(key));}catch{/* browser storage must never block secure access */}
}
function withTimeout<T>(work:PromiseLike<T>,label:string,timeoutMs=AUTH_TIMEOUT_MS):Promise<T>{return new Promise<T>((resolve,reject)=>{const timer=window.setTimeout(()=>reject(new Error(`${label} timed out.`)),timeoutMs);Promise.resolve(work).then(value=>{window.clearTimeout(timer);resolve(value)},error=>{window.clearTimeout(timer);reject(error)})})}
function transient(error:unknown){return /abort|fetch|network|load failed|timed out|timeout|econnreset|jwt.*expired|token.*expired|unauthorized|status(?:\s+code)?\s*401|\b401\b/i.test(error instanceof Error?error.message:String(error||""))}
async function secureMobileAccount(client:any){let lastError:unknown=null;for(let attempt=0;attempt<3;attempt+=1){try{const sessionResult:any=await withTimeout<any>(client.auth.getSession(),"Mobile session recovery");let session=sessionResult?.data?.session||null;if(sessionResult?.error)throw sessionResult.error;const expiresAt=Number(session?.expires_at||0);const expiredOrNearExpiry=expiresAt>0&&expiresAt<=Math.floor(Date.now()/1000)+30;if(session?.refresh_token&&(attempt>0||expiredOrNearExpiry)){const refreshed:any=await withTimeout<any>(client.auth.refreshSession({refresh_token:session.refresh_token}),"Mobile session refresh");if(refreshed?.error&&!transient(refreshed.error))throw refreshed.error;session=refreshed?.data?.session||session}let user=session?.user||null;if(!user){const auth:any=await withTimeout<any>(client.auth.getUser(),"Mobile account verification");if(auth?.error&&!transient(auth.error))throw auth.error;user=auth?.data?.user||null}if(!user){if(attempt<2){await new Promise(resolve=>window.setTimeout(resolve,300*(attempt+1)));continue}return null}const profile:any=await withTimeout<any>(client.from("profiles").select("role,active").eq("id",user.id).single(),"Mobile profile verification");if(profile?.error)throw profile.error;if(!profile?.data)throw new Error("Account profile was not found.");return{user,profile:profile.data}}catch(error){lastError=error;if(attempt===2||!transient(error))throw error;await new Promise(resolve=>window.setTimeout(resolve,350*(attempt+1)))}}throw lastError||new Error("Mobile account verification failed.")}

async function bootstrapEmployee(client:any){
  try{const session:any=await withTimeout<any>(client.auth.getSession(),"Employee bootstrap session",5000);const token=session?.data?.session?.access_token;if(!token)return;await fetch("/api/mobile/employee/bootstrap",{method:"POST",headers:{authorization:`Bearer ${token}`},cache:"no-store",signal:AbortSignal.timeout(8000)});}catch{/* account repair must not block field access */}
}

export function MobileRoleGuard({allowed,children}:{allowed:Role[];children:React.ReactNode}){
  const router=useRouter();const[state,setState]=useState<GuardState>("checking");const allowedKey=allowed.join(",");
  useEffect(()=>{let active=true;void(async()=>{if(!isSupabaseConfigured()){router.replace("/mobile/login");return}const client=getSupabaseBrowserClient() as any;try{const account=await secureMobileAccount(client);if(!active)return;if(!account){router.replace("/mobile/login");return}const{profile}=account;if(!profile.active){await withTimeout<any>(client.auth.signOut(),"Mobile sign out",5000).catch(()=>undefined);router.replace("/mobile/login?inactive=1");return}clearLegacyLocalData();const role=profile.role as Role;if(allowed.includes(role)){if(role==="employee")await bootstrapEmployee(client);if(active)setState("ready")}else router.replace(roleHome(role))}catch(error){if(!active)return;console.error("MobileRoleGuard verification failed",error);setState("error")}})();return()=>{active=false}},[allowedKey,router]);
  if(state==="ready")return <>{children}</>;
  if(state==="error")return <main className="mobile-splash"><div className="mobile-logo-pulse"><span>4</span></div><h1>Connection interrupted</h1><p>Your session could not be verified. Retry to reconnect safely.</p><button type="button" className="mobile-primary" onClick={()=>window.location.reload()}>Retry securely</button></main>;
  return <main className="mobile-splash"><div className="mobile-logo-pulse"><span>4</span></div><h1>4Ever Seasons</h1><p>Checking secure access…</p></main>;
}
