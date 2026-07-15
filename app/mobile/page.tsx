"use client";

import {useRouter} from "next/navigation";
import {MobileStartupSplash} from "@/components/mobile/MobileStartupSplash";
import {clearDemoSession} from "@/lib/auth/demoAuth";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

export default function MobileEntry(){
  const router=useRouter();

  async function openApp(){
    clearDemoSession();
    if(isSupabaseConfigured())try{await getSupabaseBrowserClient().auth.signOut()}catch{}
    router.replace("/mobile/login");
  }

  return <MobileStartupSplash onOpen={()=>void openApp()}/>;
}
