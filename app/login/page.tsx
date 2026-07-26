"use client";
import {useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";

export default function LoginPage(){
  const router=useRouter();
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(false);

  async function login(){
    if(!isSupabaseConfigured()){
      setMessage("The secure database connection is not configured.");
      return;
    }
    setLoading(true);setMessage("Signing in...");
    try{
      const supabase=getSupabaseBrowserClient() as any;
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error){setMessage(error.message);return;}
      const userId=data.user?.id;
      if(!userId){setMessage("Login worked, but no user was returned.");return;}

      const {data:profile,error:profileError}=await supabase.from("profiles").select("role, full_name, active, phone").eq("id",userId).maybeSingle();
      if(profileError||!profile){
        await supabase.auth.signOut();
        setMessage("This authenticated account does not have an active platform profile. Contact support.");
        return;
      }

      if(!profile.active){
        await supabase.auth.signOut();
        setMessage("This account is inactive. Contact the company Admin.");
        return;
      }

      if(profile.role==="customer"){
        const pendingQuote=window.localStorage.getItem("damasio_pending_quote");
        if(pendingQuote){
          const {error:claimError}=await supabase.rpc("claim_quote_by_number",{p_quote_number:pendingQuote});
          if(!claimError)window.localStorage.removeItem("damasio_pending_quote");
        }
      }

      if(profile.role==="master") router.push("/master");
      else if(profile.role==="admin"||profile.role==="manager") router.push(profile.phone?"/admin":"/company/setup");
      else if(profile.role==="employee") router.push("/employee");
      else router.push("/customer");
    }catch(err){setMessage(err instanceof Error?err.message:"Could not sign in.");}
    finally{setLoading(false);}
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="season-title auth-logo"><span>4EVER</span><strong>SEASONS</strong></div>
      <span className="eyebrow">4Ever Seasons</span>
      <h1>Sign in</h1>
      <p>Use the email and password connected to your live account.</p>
      <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@company.com" /></label>
      <label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" /></label>
      <button className="btn btn-primary" onClick={login} disabled={loading}>{loading?"Signing in...":"Sign In"}</button>
      <Link href="/forgot-password">Forgot your password?</Link>
      {message&&<p className="auth-message">{message}</p>}
      <div className="auth-links"><a href="/admin/database">Database setup</a><a href="/">Back to website</a></div>
    </section>
  </main>;
}
