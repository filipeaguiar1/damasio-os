import {clearDemoSession} from "@/lib/auth/demoAuth";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

export async function signOutAccount(destination="/login"){
  clearDemoSession();
  if(isSupabaseConfigured())try{await getSupabaseBrowserClient().auth.signOut()}catch{}
  window.location.assign(destination);
}
