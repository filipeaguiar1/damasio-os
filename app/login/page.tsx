"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {getSupabaseBrowserClient,isSupabaseConfigured,setAuthPersistencePreference} from "@/lib/supabase/client";
import {canOfferDesktopPasskeys} from "@/lib/auth/passkeys";

function roleHome(role:string,hasPhone:boolean){if(role==="master")return"/master";if(role==="admin"||role==="manager")return hasPhone?"/admin":"/company/setup";if(role==="employee")return"/employee";return"/customer"}

export default function LoginPage(){
  const router=useRouter();
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[rememberEmail,setRememberEmail]=useState(false);
  const[keepConnected,setKeepConnected]=useState(true);
  const[canUsePasskey,setCanUsePasskey]=useState(false);
  const[setupPasskey,setSetupPasskey]=useState(false);
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(false);

  useEffect(()=>{
    let active=true;
    const savedEmail=window.localStorage.getItem("damasio_login_email")||"";
    const savedKeep=window.localStorage.getItem("damasio_keep_connected");
    if(savedEmail){setEmail(savedEmail);setRememberEmail(true)}
    if(savedKeep)setKeepConnected(savedKeep==="true");
    setCanUsePasskey(canOfferDesktopPasskeys());
    void(async()=>{if(!isSupabaseConfigured())return;try{const supabase=getSupabaseBrowserClient() as any;const{data}=await supabase.auth.getSession();const user=data.session?.user;if(!user||!active)return;const{data:profile}=await supabase.from("profiles").select("role,active,phone").eq("id",user.id).maybeSingle();if(profile?.active&&active)router.replace(roleHome(profile.role,Boolean(profile.phone)))}catch{/* keep the login form available */}})();
    return()=>{active=false};
  },[router]);

  async function resolveProfileAndRoute(userId:string){
    const supabase=getSupabaseBrowserClient() as any;
    const{data:profile,error:profileError}=await supabase.from("profiles").select("role, full_name, active, phone").eq("id",userId).maybeSingle();
    if(profileError||!profile){await supabase.auth.signOut();throw new Error("This authenticated account does not have an active platform profile. Contact support.")}
    if(!profile.active){await supabase.auth.signOut();throw new Error("This account is inactive. Contact the company Admin.")}

    if(profile.role==="customer"){
      const pendingQuote=window.localStorage.getItem("damasio_pending_quote");
      if(pendingQuote){const{error:claimError}=await supabase.rpc("claim_quote_by_number",{p_quote_number:pendingQuote});if(!claimError)window.localStorage.removeItem("damasio_pending_quote")}
    }
    router.push(roleHome(profile.role,Boolean(profile.phone)));
  }

  async function login(){
    if(!isSupabaseConfigured()){setMessage("The secure database connection is not configured.");return}
    setLoading(true);setMessage("Signing in...");
    try{
      setAuthPersistencePreference(keepConnected);
      const supabase=getSupabaseBrowserClient() as any;
      const{data,error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
      if(error)throw new Error(error.message);
      const userId=data.user?.id;if(!userId)throw new Error("Login worked, but no user was returned.");

      if(rememberEmail)window.localStorage.setItem("damasio_login_email",email.trim());
      else window.localStorage.removeItem("damasio_login_email");
      window.localStorage.setItem("damasio_keep_connected",String(keepConnected));

      if(canUsePasskey&&setupPasskey){
        setMessage("Confirm the passkey prompt on this computer...");
        const{error:passkeyError}=await supabase.auth.registerPasskey();
        if(passkeyError)setMessage("Signed in. Passkey setup was not completed; password sign-in remains available.");
      }
      await resolveProfileAndRoute(userId);
    }catch(err){setMessage(err instanceof Error?err.message:"Could not sign in.");setLoading(false)}
  }

  async function loginWithPasskey(){
    if(!isSupabaseConfigured()||!canUsePasskey)return;
    setLoading(true);setMessage("Waiting for your passkey...");
    try{
      setAuthPersistencePreference(keepConnected);
      const supabase=getSupabaseBrowserClient() as any;
      const{data,error}=await supabase.auth.signInWithPasskey();
      if(error)throw new Error(error.message);
      const userId=data.user?.id;if(!userId)throw new Error("Passkey sign-in did not return a user.");
      window.localStorage.setItem("damasio_keep_connected",String(keepConnected));
      await resolveProfileAndRoute(userId);
    }catch(err){setMessage(err instanceof Error?err.message:"Passkey sign-in failed.");setLoading(false)}
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="season-title auth-logo"><span>4EVER</span><strong>SEASONS</strong></div>
      <span className="eyebrow">4Ever Seasons</span>
      <h1>Sign in</h1>
      <p>Use the email and password connected to your live account.</p>
      <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="admin@company.com" /></label>
      <label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" placeholder="••••••••" /></label>
      <div className="auth-login-options">
        <label><input type="checkbox" checked={rememberEmail} onChange={e=>setRememberEmail(e.target.checked)} /><span>Remember email</span></label>
        <label><input type="checkbox" checked={keepConnected} onChange={e=>setKeepConnected(e.target.checked)} /><span>Keep me signed in</span></label>
        {canUsePasskey&&<label><input type="checkbox" checked={setupPasskey} onChange={e=>setSetupPasskey(e.target.checked)} /><span>Set up a passkey on this computer after sign-in</span></label>}
      </div>
      <button className="btn btn-primary" onClick={()=>void login()} disabled={loading}>{loading?"Signing in...":"Sign In"}</button>
      {canUsePasskey&&<button className="btn btn-outline" type="button" onClick={()=>void loginWithPasskey()} disabled={loading}>Sign in with a passkey</button>}
      <Link href="/forgot-password">Forgot your password?</Link>
      {message&&<p className="auth-message">{message}</p>}
      <div className="auth-links"><a href="/admin/database">Database setup</a><a href="/">Back to website</a></div>
    </section>
  </main>;
}
