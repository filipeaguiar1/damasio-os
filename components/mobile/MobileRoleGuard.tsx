"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {readDemoSession,type DemoRole} from "@/lib/auth/demoAuth";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

type Role=DemoRole|"manager";
function mobileHome(role:Role){if(role==="master")return"/master";if(role==="admin"||role==="manager")return"/admin";if(role==="employee")return"/mobile/employee";return"/customer"}

export function MobileRoleGuard({allowed,children}:{allowed:Role[];children:React.ReactNode}){
  const router=useRouter();const[ready,setReady]=useState(false);const allowedKey=allowed.join(",");
  useEffect(()=>{let active=true;void(async()=>{const demo=readDemoSession();if(demo){if(allowed.includes(demo.role)){if(active)setReady(true)}else router.replace(mobileHome(demo.role));return}if(!isSupabaseConfigured()){router.replace("/mobile/login");return}const client=getSupabaseBrowserClient() as any;const{data:auth}=await client.auth.getUser();if(!auth?.user){router.replace("/mobile/login");return}const{data:profile}=await client.from("profiles").select("role,active").eq("id",auth.user.id).single();if(!profile?.active){await client.auth.signOut();router.replace("/mobile/login?inactive=1");return}const role=profile.role as Role;if(allowed.includes(role)){if(active)setReady(true)}else router.replace(mobileHome(role))})();return()=>{active=false}},[allowedKey,router]);
  if(!ready)return <main className="mobile-splash"><div className="mobile-logo-pulse"><span>D</span></div><h1>Damasio OS</h1><p>Checking secure access…</p></main>;
  return <>{children}</>;
}
