"use client";

import {useState} from "react";
import {useRouter} from "next/navigation";
import {MobileStartupSplash} from "@/components/mobile/MobileStartupSplash";
import {readDemoSession} from "@/lib/auth/demoAuth";
import {getMobileRoleHome} from "@/lib/mobile/routes";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

export default function MobileEntry(){
  const router=useRouter();
  const[opening,setOpening]=useState(false);

  async function openApp(){
    if(opening)return;
    setOpening(true);
    const demo=readDemoSession();
    if(demo){router.replace(getMobileRoleHome(demo.role));return}
    if(!isSupabaseConfigured()){router.replace("/mobile/login");return}
    try{
      const client=getSupabaseBrowserClient() as any;
      const{data:auth}=await client.auth.getUser();
      if(!auth?.user){router.replace("/mobile/login");return}
      const{data:profile}=await client.from("profiles").select("role,active").eq("id",auth.user.id).maybeSingle();
      if(!profile?.active){await client.auth.signOut();router.replace("/mobile/login?inactive=1");return}
      router.replace(getMobileRoleHome(profile.role));
    }catch{router.replace("/mobile/login")}
  }

  return <MobileStartupSplash onOpen={()=>void openApp()}/>;
}
