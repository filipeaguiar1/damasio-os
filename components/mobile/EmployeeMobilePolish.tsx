"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getEmployeeProfile, saveEmployeeProfile } from "@/lib/storage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Workspace-level navigation only; Visit and Task detail screens keep contextual back navigation.
export function EmployeeMobilePolish(){
  const pathname=usePathname();
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [detailMode,setDetailMode]=useState(false);
  const [guardLoading,setGuardLoading]=useState(true);
  const [canonicalName,setCanonicalName]=useState("");
  const menuEnabled=pathname==="/mobile/employee"||pathname==="/mobile/employee/profile"||pathname==="/mobile/employee/customers";

  useEffect(()=>{
    if(!menuEnabled){setGuardLoading(true);return}
    const syncGuard=()=>{
      const loading=Boolean(document.querySelector(".mobile-splash"));
      setGuardLoading(loading);
      if(loading)setOpen(false);
    };
    syncGuard();
    const observer=new MutationObserver(syncGuard);
    observer.observe(document.body,{subtree:true,childList:true});
    return()=>observer.disconnect();
  },[menuEnabled,pathname]);

  useEffect(()=>{
    if(!menuEnabled)return;
    let cancelled=false;
    async function syncCanonicalProfile(){
      try{
        const client=getSupabaseBrowserClient() as any;
        const{data}=await client.auth.getSession();
        const token=data.session?.access_token;
        if(!token)return;
        const response=await fetch("/api/employee/profile",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
        const result=await response.json().catch(()=>({}));
        if(!response.ok||cancelled||!result.profile)return;
        const fullName=String(result.profile.full_name||"").trim();
        if(!fullName)return;
        setCanonicalName(fullName);
        const current=getEmployeeProfile();
        saveEmployeeProfile({
          ...current,
          name:fullName,
          email:String(result.profile.email||current.email||""),
          phone:String(result.profile.phone||""),
          defaultAddress:String(result.profile.route_start_address||result.profile.address_line1||current.defaultAddress||""),
          photoUrl:String(result.profile.avatar_url||""),
          photoLabel:fullName.slice(0,1).toUpperCase()||"E",
        });
      }catch{
        // Existing Employee workflow remains usable if profile sync is temporarily unavailable.
      }
    }
    void syncCanonicalProfile();
    return()=>{cancelled=true};
  },[menuEnabled,pathname]);

  useEffect(()=>{
    if(pathname!=="/mobile/employee"||!canonicalName)return;
    const syncName=()=>{
      const label=document.querySelector(".employee-mobile-brand small");
      if(label&&label.textContent!==canonicalName)label.textContent=canonicalName;
    };
    syncName();
    const observer=new MutationObserver(syncName);
    observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    return()=>observer.disconnect();
  },[pathname,canonicalName]);

  useEffect(()=>{
    if(pathname!=="/mobile/employee"){
      setDetailMode(false);
      return;
    }
    const sync=()=>{
      const detail=Boolean(
        document.querySelector(".employee-task-detail") ||
        document.querySelector(".mobile-property-reference:not(.employee-task-detail)")
      );
      setDetailMode(detail);
      if(detail)setOpen(false);
    };
    sync();
    const observer=new MutationObserver(sync);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["class"]});
    return()=>observer.disconnect();
  },[pathname]);

  useEffect(()=>{
    if(pathname!=="/mobile/employee")return;
    const interceptProfile=(event:MouseEvent)=>{
      const target=event.target;
      if(!(target instanceof Element))return;
      if(!target.closest(".employee-profile-trigger"))return;
      event.preventDefault();
      event.stopPropagation();
      router.push("/mobile/employee/profile");
    };
    document.addEventListener("click",interceptProfile,true);
    return()=>document.removeEventListener("click",interceptProfile,true);
  },[pathname,router]);

  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setOpen(false)};
    window.addEventListener("keydown",close);
    return()=>{document.body.style.overflow=previous;window.removeEventListener("keydown",close)};
  },[open]);

  if(!menuEnabled||guardLoading||detailMode)return null;

  return <>
    <button type="button" className="employee-polish-menu-button" aria-label="Open employee menu" aria-expanded={open} onClick={()=>setOpen(true)}>
      <span/><span/><span/>
    </button>
    {open&&<div className="employee-polish-menu-backdrop" role="presentation" onClick={()=>setOpen(false)}>
      <aside className="employee-polish-menu-drawer" role="dialog" aria-modal="true" aria-label="Employee navigation" onClick={event=>event.stopPropagation()}>
        <header>
          <div><small>FIELD WORKSPACE</small><strong>Employee menu</strong><span>Fast access without changing your route workflow.</span></div>
          <button type="button" aria-label="Close employee menu" onClick={()=>setOpen(false)}>×</button>
        </header>
        <nav>
          <Link href="/mobile/employee" onClick={()=>setOpen(false)}><i>↗</i><span><strong>Routes</strong><small>Visits, map and Smart Route</small></span><b>›</b></Link>
          <Link href="/mobile/employee/customers" onClick={()=>setOpen(false)}><i>◎</i><span><strong>Customers</strong><small>Assigned properties</small></span><b>›</b></Link>
          <Link href="/mobile/employee/profile" onClick={()=>setOpen(false)}><i>◉</i><span><strong>Profile</strong><small>Personal and route-start details</small></span><b>›</b></Link>
        </nav>
        <footer><span>Routes remains the Employee home screen. Visit and Task details keep their contextual back navigation.</span></footer>
      </aside>
    </div>}
  </>;
}
