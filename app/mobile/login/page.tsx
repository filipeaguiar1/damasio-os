"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {clearDemoSession} from "@/lib/auth/demoAuth";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

function roleHome(role:string){if(role==="master")return"/master";if(role==="admin"||role==="manager")return"/admin";if(role==="employee")return"/mobile/employee";return"/customer"}

export default function MobileLogin(){
  const router=useRouter();const[email,setEmail]=useState("");const[password,setPassword]=useState("");const[message,setMessage]=useState("");const[busy,setBusy]=useState(false);
  async function login(){if(!isSupabaseConfigured()){setMessage("The secure server connection is not configured.");return}setBusy(true);setMessage("Signing in…");try{const client=getSupabaseBrowserClient() as any;const{data,error}=await client.auth.signInWithPassword({email:email.trim(),password});if(error)throw new Error(error.message);const{data:profile,error:profileError}=await client.from("profiles").select("role,active").eq("id",data.user.id).single();if(profileError||!profile)throw new Error("This account has no platform role yet.");if(!profile.active){await client.auth.signOut();throw new Error("This account is inactive. Contact the company Admin.")}clearDemoSession();router.replace(roleHome(profile.role))}catch(error){setMessage(error instanceof Error?error.message:"Sign-in failed.");setBusy(false)}}
  return <main className="mobile-app-shell mobile-login-page"><section className="mobile-hero-card"><div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>Damasio OS</strong><span>Secure mobile access</span></div></div><h1>Sign in</h1><p>Your account automatically opens the correct area: Master, Admin, Employee or Customer.</p></section><section className="mobile-login-card"><label>Email<input className="input" type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@company.com"/></label><label>Password<input className="input" type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} placeholder="Your password"/></label><button className="mobile-primary" disabled={busy||!email||!password} onClick={()=>void login()}>{busy?"Signing in…":"Sign in securely"}</button>{message&&<p className="mobile-message mobile-error">{message}</p>}<a href="/login">Need help with your account?</a></section></main>
}
