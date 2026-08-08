"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { signOutAccount } from "@/lib/auth/signOut";
import { getEmployeeProfile, saveEmployeeProfile } from "@/lib/storage";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type CanonicalAddress={
  addressLine1:string;
  city:string;
  province:string;
  postalCode:string;
};

async function employeeToken(){
  const client=getSupabaseBrowserClient() as any;
  const{data}=await client.auth.getSession();
  const token=data.session?.access_token;
  if(!token)throw new Error("Your Employee login expired. Sign in again.");
  return token as string;
}

export default function EmployeeMobileProfile(){
  const [profileDraft,setProfileDraft]=useState(()=>getEmployeeProfile());
  const [canonicalAddress,setCanonicalAddress]=useState<CanonicalAddress>({addressLine1:"",city:"",province:"ON",postalCode:""});
  const [message,setMessage]=useState("Loading profile…");
  const [busy,setBusy]=useState(false);
  const [photoBusy,setPhotoBusy]=useState(false);
  const photoInput=useRef<HTMLInputElement|null>(null);
  const initials=(profileDraft.name||"Employee").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"E";

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try{
        const response=await fetch("/api/employee/profile",{headers:{authorization:`Bearer ${await employeeToken()}`},cache:"no-store"});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||"Profile could not be loaded.");
        if(cancelled)return;
        const current=getEmployeeProfile();
        const fullName=String(result.profile?.full_name||current.name||"Employee").trim();
        const next={
          ...current,
          name:fullName,
          email:String(result.profile?.email||current.email||""),
          phone:String(result.profile?.phone||""),
          defaultAddress:String(result.profile?.route_start_address||result.profile?.address_line1||current.defaultAddress||""),
          photoUrl:String(result.profile?.avatar_url||""),
          photoLabel:fullName.slice(0,1).toUpperCase()||"E",
        };
        setCanonicalAddress({
          addressLine1:String(result.profile?.address_line1||""),
          city:String(result.profile?.city||""),
          province:String(result.profile?.province||"ON"),
          postalCode:String(result.profile?.postal_code||""),
        });
        saveEmployeeProfile(next);
        setProfileDraft(next);
        setMessage("");
      }catch(error){
        if(!cancelled)setMessage(error instanceof Error?error.message:"Profile could not be loaded.");
      }
    }
    void load();
    return()=>{cancelled=true};
  },[]);

  async function save(){
    if(!profileDraft.name.trim())return;
    setBusy(true);
    setMessage("");
    try{
      const response=await fetch("/api/employee/profile",{
        method:"PATCH",
        headers:{"content-type":"application/json",authorization:`Bearer ${await employeeToken()}`},
        body:JSON.stringify({
          fullName:profileDraft.name.trim(),
          phone:profileDraft.phone?.trim()||null,
          addressLine1:canonicalAddress.addressLine1||null,
          city:canonicalAddress.city||null,
          province:canonicalAddress.province||"ON",
          postalCode:canonicalAddress.postalCode||null,
          routeStartAddress:profileDraft.defaultAddress?.trim()||canonicalAddress.addressLine1||null,
          avatarUrl:profileDraft.photoUrl||null,
        }),
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"Profile could not be saved.");
      const fullName=String(result.profile?.full_name||profileDraft.name).trim();
      const next={
        ...profileDraft,
        name:fullName,
        email:String(result.profile?.email||profileDraft.email||""),
        phone:String(result.profile?.phone||profileDraft.phone||""),
        defaultAddress:String(result.profile?.route_start_address||profileDraft.defaultAddress||""),
        photoUrl:String(result.profile?.avatar_url||profileDraft.photoUrl||""),
        photoLabel:fullName.slice(0,1).toUpperCase()||"E",
      };
      saveEmployeeProfile(next);
      setProfileDraft(next);
      setMessage(result.message||"Profile saved.");
    }catch(error){
      setMessage(error instanceof Error?error.message:"Profile could not be saved.");
    }finally{
      setBusy(false);
    }
  }

  async function uploadPhoto(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    setPhotoBusy(true);
    setMessage("");
    try{
      const client=getSupabaseBrowserClient() as any;
      const extension=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").slice(0,8)||"jpg";
      const path=`${crypto.randomUUID()}.${extension}`;
      const{error}=await client.storage.from("employee-avatars").upload(path,file,{
        cacheControl:"3600",
        upsert:false,
        contentType:file.type||undefined,
      });
      if(error)throw new Error(error.message);
      const{data}=client.storage.from("employee-avatars").getPublicUrl(path);
      if(!data?.publicUrl)throw new Error("Profile photo URL could not be created.");
      setProfileDraft(current=>({...current,photoUrl:data.publicUrl}));
      setMessage("Photo ready. Save profile to publish it.");
    }catch(error){
      setMessage(error instanceof Error?error.message:"Profile photo could not be uploaded.");
    }finally{
      setPhotoBusy(false);
    }
  }

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="mobile-app-shell employee-polish-subpage employee-polish-profile-page">
      <header className="employee-polish-subpage-topbar">
        <div className="employee-polish-menu-slot" aria-hidden="true"/>
        <div><strong>My profile</strong><small>Employee account</small></div>
        <div className="employee-polish-mini-avatar">{profileDraft.photoUrl?<img src={profileDraft.photoUrl} alt="Employee profile"/>:initials}</div>
      </header>

      <section className="employee-polish-profile-hero">
        <button type="button" className="employee-polish-profile-photo" disabled={photoBusy} onClick={()=>photoInput.current?.click()}>
          {profileDraft.photoUrl?<img src={profileDraft.photoUrl} alt="Employee"/>:<span>{initials}</span>}
          <b>{photoBusy?"…":"＋"}</b>
        </button>
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={event=>void uploadPhoto(event)}/>
        <div className="employee-polish-profile-copy">
          <div className="employee-polish-profile-status"><i/> Active employee</div>
          <small>EMPLOYEE PROFILE</small>
          <h1>{profileDraft.name||"Employee"}</h1>
          <p>Your account and field identity</p>
          <button type="button" disabled={photoBusy} onClick={()=>photoInput.current?.click()}>{photoBusy?"Uploading…":"Change profile photo"}</button>
        </div>
      </section>

      <section className="employee-polish-settings-card">
        <div className="employee-polish-section-heading"><div><small>PERSONAL DETAILS</small><h2>Contact information</h2></div><i>01</i></div>
        <div className="employee-polish-profile-form">
          <label><span>Name</span><input value={profileDraft.name} onChange={event=>setProfileDraft(current=>({...current,name:event.target.value}))} placeholder="Employee name"/></label>
          <label><span>Phone</span><input type="tel" value={profileDraft.phone||""} onChange={event=>setProfileDraft(current=>({...current,phone:event.target.value}))} placeholder="Phone number"/></label>
          <label className="employee-polish-field-wide"><span>Email</span><input type="email" value={profileDraft.email} readOnly aria-readonly="true" placeholder="Email address"/></label>
        </div>
      </section>

      <section className="employee-polish-settings-card employee-polish-route-card">
        <div className="employee-polish-section-heading"><div><small>ROUTE PREFERENCE</small><h2>Default starting point</h2></div><i>02</i></div>
        <p className="employee-polish-card-intro">This keeps the same route-start setting already used by the Employee app and Admin routing tools.</p>
        <label className="employee-polish-route-field"><span>Default route address</span><textarea value={profileDraft.defaultAddress||""} onChange={event=>setProfileDraft(current=>({...current,defaultAddress:event.target.value}))} placeholder="Where you normally start your workday"/></label>
      </section>

      {message&&<p className="mobile-message employee-polish-profile-message" role="status">{message}</p>}
      <button type="button" className="employee-polish-save-button" disabled={busy||photoBusy||!profileDraft.name.trim()} onClick={()=>void save()}>{busy?"Saving…":"Save profile"}</button>
      <button type="button" className="employee-polish-signout-button" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button>
      <p className="employee-polish-profile-footnote">Your current route, visits, tasks and field workflow are unchanged.</p>
    </main>
  </MobileRoleGuard>;
}
