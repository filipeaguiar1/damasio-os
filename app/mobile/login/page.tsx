"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseBrowserClient,isSupabaseConfigured,setAuthPersistencePreference} from "@/lib/supabase/client";
import {enableNativeDeviceAuth,getNativeDeviceAuthStatus,type NativeDeviceAuthStatus} from "@/lib/auth/native-device-auth";

function roleHome(role:string){if(role==="master")return"/master";if(role==="admin"||role==="manager")return"/mobile/admin";if(role==="employee")return"/mobile/employee";return"/mobile/customer"}

const EMPTY_NATIVE_STATUS:NativeDeviceAuthStatus={available:false,enabled:false,platform:"unknown"};

export default function MobileLogin(){
  const router=useRouter();
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[rememberEmail,setRememberEmail]=useState(false);
  const[nativeStatus,setNativeStatus]=useState<NativeDeviceAuthStatus>(EMPTY_NATIVE_STATUS);
  const[enableDeviceUnlock,setEnableDeviceUnlock]=useState(false);
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);

  useEffect(()=>{
    let active=true;
    const savedEmail=window.localStorage.getItem("damasio_login_email")||"";
    if(savedEmail){setEmail(savedEmail);setRememberEmail(true)}

    const status=getNativeDeviceAuthStatus();
    setNativeStatus(status);
    if(status.available&&!status.enabled)setEnableDeviceUnlock(true);

    // For now there is no general "keep me signed in" mode on mobile.
    // A persistent Supabase session is kept only when the native app lock is
    // already enabled, because that session is hidden behind device auth.
    const protectedSession=status.available&&status.enabled;
    setAuthPersistencePreference(protectedSession);
    window.localStorage.setItem("damasio_keep_connected",String(protectedSession));

    void(async()=>{
      if(!isSupabaseConfigured())return;
      try{
        const client=getSupabaseBrowserClient() as any;
        const{data}=await client.auth.getSession();
        const user=data.session?.user;
        if(!user||!active)return;
        const{data:profile}=await client.from("profiles").select("role,active").eq("id",user.id).maybeSingle();
        if(profile?.active&&active)router.replace(roleHome(profile.role));
      }catch{/* login form remains available when session recovery fails */}
    })();
    return()=>{active=false};
  },[router]);

  async function login(){
    if(!isSupabaseConfigured()){setMessage("The secure server connection is not configured.");return}
    setBusy(true);setMessage("Signing in…");
    try{
      const shouldEnableDeviceUnlock=nativeStatus.available&&!nativeStatus.enabled&&enableDeviceUnlock;
      const persist=nativeStatus.available&&(nativeStatus.enabled||shouldEnableDeviceUnlock);
      setAuthPersistencePreference(persist);

      const client=getSupabaseBrowserClient() as any;
      const{data,error}=await client.auth.signInWithPassword({email:email.trim(),password});
      if(error)throw new Error(error.message);
      const{data:profile,error:profileError}=await client.from("profiles").select("role,active").eq("id",data.user.id).single();
      if(profileError||!profile)throw new Error("This account has no platform role yet.");
      if(!profile.active){await client.auth.signOut();throw new Error("This account is inactive. Contact the company Admin.")}

      if(rememberEmail)window.localStorage.setItem("damasio_login_email",email.trim());
      else window.localStorage.removeItem("damasio_login_email");
      window.localStorage.setItem("damasio_keep_connected",String(persist));

      if(shouldEnableDeviceUnlock){
        setMessage("Confirm fingerprint, face or device lock…");
        const result=await enableNativeDeviceAuth();
        if(result.success)setNativeStatus(getNativeDeviceAuthStatus());
      }

      router.replace(roleHome(profile.role));
    }catch(error){setMessage(error instanceof Error?error.message:"Sign-in failed.");setBusy(false)}
  }

  const nativeLabel=nativeStatus.platform==="ios"?"Use Face ID, Touch ID or device passcode":"Use fingerprint, face or device lock";

  return <main className="mobile-app-shell mobile-login-page">
    <section className="mobile-hero-card"><div className="mobile-brand-row"><div className="mobile-brand-mark">4</div><div><strong>4Ever Seasons</strong><span>Secure mobile access</span></div></div><h1>Sign in</h1><p>Your live account automatically opens the correct mobile area.</p></section>
    <section className="mobile-login-card">
      <label>Email<input className="input" type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@company.com"/></label>
      <label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Your password"/></label>
      <div className="auth-login-options mobile">
        <label><input type="checkbox" checked={rememberEmail} onChange={event=>setRememberEmail(event.target.checked)}/><span>Remember email</span></label>
        {nativeStatus.available&&!nativeStatus.enabled&&<label><input type="checkbox" checked={enableDeviceUnlock} onChange={event=>setEnableDeviceUnlock(event.target.checked)}/><span>{nativeLabel} on this device</span></label>}
        {nativeStatus.available&&nativeStatus.enabled&&<span className="mobile-security-status">Device unlock is active. Your saved session is protected by this device.</span>}
      </div>
      <button className="mobile-primary" disabled={busy||!email||!password} onClick={()=>void login()}>{busy?"Signing in…":"Sign in securely"}</button>
      {message&&<p className="mobile-message mobile-error">{message}</p>}
      <a href="/login">Need help with your account?</a>
    </section>
  </main>
}
