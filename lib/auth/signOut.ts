import {clearDemoSession} from "@/lib/auth/demoAuth";
import {clearAuthSessionStorage,getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

export async function signOutAccount(destination="/login"){
  clearDemoSession();
  if(isSupabaseConfigured())try{await getSupabaseBrowserClient().auth.signOut()}catch{}
  clearAuthSessionStorage();
  try{window.localStorage.removeItem("damasio_login_email")}catch{}
  window.location.assign(destination);
}
