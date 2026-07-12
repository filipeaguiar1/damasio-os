"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";
import {DemoRole,getRoleHome,saveDemoSession} from "@/lib/auth/demoAuth";

export default function LoginPage(){
  const router=useRouter();
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[message,setMessage]=useState("");
  const[loading,setLoading]=useState(false);

  function demo(role:DemoRole){saveDemoSession(role);router.push(getRoleHome(role));}

  async function login(){
    if(!isSupabaseConfigured()){
      setMessage("Supabase is not configured yet. Use Demo Login while we connect the database.");
      return;
    }
    setLoading(true);setMessage("Signing in...");
    try{
      const supabase=getSupabaseBrowserClient() as any;
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error){setMessage(error.message);return;}
      const userId=data.user?.id;
      if(!userId){setMessage("Login worked, but no user was returned.");return;}
      const {data:profile,error:profileError}=await supabase.from("profiles").select("role, full_name").eq("id",userId).single();
      if(profileError || !profile){
        setMessage("User exists, but no profile/role was found yet. For now, keep using demo access while database users are connected.");
        return;
      }
      if(profile.role==="master") router.push("/master");
      else if(profile.role==="admin") router.push("/admin");
      else if(profile.role==="employee") router.push("/employee");
      else router.push("/customer");
    }catch(err){setMessage(err instanceof Error?err.message:"Could not sign in.");}
    finally{setLoading(false);}
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="season-title auth-logo"><span>DAMASIO</span><strong>OS</strong></div>
      <span className="eyebrow">Damasio OS</span>
      <h1>Sign in</h1>
      <p>The company signup/onboarding screen was removed for now. We will keep the system simple, connect the database first, then add real onboarding later.</p>
      <label>Email<input value={email} onChange={e=>setEmail(e.target.value)} placeholder="admin@company.com" /></label>
      <label>Password<input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" /></label>
      <button className="btn btn-primary" onClick={login} disabled={loading}>{loading?"Signing in...":"Sign In"}</button>
      {message&&<p className="auth-message">{message}</p>}
      <div className="demo-grid">
        <button className="btn btn-primary" onClick={()=>demo("master")}>Master Access</button>
        <button className="btn btn-white" onClick={()=>demo("admin")}>Demo Admin</button>
        <button className="btn btn-white" onClick={()=>demo("employee")}>Demo Employee</button>
        <button className="btn btn-white" onClick={()=>demo("customer")}>Demo Customer</button>
      </div>
      <div className="auth-links"><a href="/admin/database">Database setup</a><a href="/">Back to website</a></div>
    </section>
  </main>;
}
