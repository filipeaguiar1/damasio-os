"use client";
import {useEffect,useState} from "react";
import {usePathname,useRouter} from "next/navigation";
import {readDemoSession,type DemoRole} from "@/lib/auth/demoAuth";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";
import {firstAllowedManagerPath,hasManagerPermission,managerPermissionForPath} from "@/lib/auth/managerPermissions";

type Role=DemoRole|"manager";
function home(role:Role){if(role==="master")return"/master";if(role==="admin"||role==="manager")return"/admin";if(role==="employee")return"/employee";return"/customer"}

export function RoleGuard({allowed,children}:{allowed:Role[];children:React.ReactNode}){
  const router=useRouter();const pathname=usePathname();const[ready,setReady]=useState(false);const[denied,setDenied]=useState(false);const allowedKey=allowed.join(",");
  useEffect(()=>{let active=true;setReady(false);setDenied(false);void(async()=>{
    const demo=readDemoSession();
    if(demo){if(allowed.includes(demo.role)){if(active)setReady(true)}else router.replace(home(demo.role));return}
    if(!isSupabaseConfigured()){router.replace("/login");return}
    const client=getSupabaseBrowserClient() as any;
    const{data:auth}=await client.auth.getUser();
    if(!auth?.user){router.replace("/login");return}
    const{data:profile}=await client.from("profiles").select("role,active,manager_permissions").eq("id",auth.user.id).single();
    if(!profile?.active){await client.auth.signOut();router.replace("/login?inactive=1");return}
    const role=profile.role as Role;
    if(!allowed.includes(role)){router.replace(home(role));return}

    if(role==="manager"&&pathname.startsWith("/admin")){
      const fallback=firstAllowedManagerPath(profile.manager_permissions,false);
      if(pathname==="/admin"||pathname==="/admin/"){
        if(fallback){router.replace(fallback);return}
        if(active)setDenied(true);
        return;
      }
      const permission=managerPermissionForPath(pathname);
      if(!permission||!hasManagerPermission(profile.manager_permissions,permission,"view")){
        if(fallback&&fallback!==pathname){router.replace(fallback);return}
        if(active)setDenied(true);
        return;
      }
    }

    if(active)setReady(true);
  })();return()=>{active=false}},[allowedKey,pathname,router]);
  if(denied)return <main className="auth-page"><section className="auth-card"><span className="eyebrow">Secure access</span><h1>Manager access restricted</h1><p>This account has no permission for this Admin module.</p></section></main>;
  if(!ready)return <main className="auth-page"><section className="auth-card"><span className="eyebrow">Secure access</span><h1>Checking your account…</h1></section></main>;
  return <>{children}</>;
}
