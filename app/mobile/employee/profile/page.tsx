"use client";

import { ChangeEvent, useRef, useState } from "react";
import { MobileRoleGuard } from "@/components/mobile/MobileRoleGuard";
import { signOutAccount } from "@/lib/auth/signOut";
import { getEmployeeProfile, saveEmployeeProfile } from "@/lib/storage";

export default function EmployeeMobileProfile(){
  const initial=getEmployeeProfile();
  const [profileDraft,setProfileDraft]=useState(initial);
  const [message,setMessage]=useState("");
  const photoInput=useRef<HTMLInputElement|null>(null);
  const initials=(profileDraft.name||"Employee").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"E";

  function save(){
    const next={...profileDraft,photoLabel:(profileDraft.name||"E").slice(0,1).toUpperCase()};
    saveEmployeeProfile(next);
    setProfileDraft(next);
    setMessage("Profile saved.");
  }

  function uploadPhoto(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>setProfileDraft(current=>({...current,photoUrl:String(reader.result||"")}));
    reader.readAsDataURL(file);
    event.target.value="";
  }

  return <MobileRoleGuard allowed={["employee"]}>
    <main className="mobile-app-shell employee-polish-subpage employee-polish-profile-page">
      <header className="employee-polish-subpage-topbar">
        <div className="employee-polish-menu-slot" aria-hidden="true"/>
        <div><strong>My profile</strong><small>Employee account</small></div>
        <div className="employee-polish-mini-avatar">{profileDraft.photoUrl?<img src={profileDraft.photoUrl} alt="Employee profile"/>:initials}</div>
      </header>

      <section className="employee-polish-profile-hero">
        <button type="button" className="employee-polish-profile-photo" onClick={()=>photoInput.current?.click()}>
          {profileDraft.photoUrl?<img src={profileDraft.photoUrl} alt="Employee"/>:<span>{initials}</span>}
          <b>＋</b>
        </button>
        <input ref={photoInput} type="file" accept="image/*" hidden onChange={uploadPhoto}/>
        <div className="employee-polish-profile-copy">
          <div className="employee-polish-profile-status"><i/> Active employee</div>
          <small>EMPLOYEE PROFILE</small>
          <h1>{profileDraft.name||"Employee"}</h1>
          <p>{profileDraft.crew||"Field team"}</p>
          <button type="button" onClick={()=>photoInput.current?.click()}>Change profile photo</button>
        </div>
      </section>

      <section className="employee-polish-settings-card">
        <div className="employee-polish-section-heading"><div><small>PERSONAL DETAILS</small><h2>Contact information</h2></div><i>01</i></div>
        <div className="employee-polish-profile-form">
          <label><span>Name</span><input value={profileDraft.name} onChange={event=>setProfileDraft(current=>({...current,name:event.target.value}))} placeholder="Employee name"/></label>
          <label><span>Phone</span><input type="tel" value={profileDraft.phone||""} onChange={event=>setProfileDraft(current=>({...current,phone:event.target.value}))} placeholder="Phone number"/></label>
          <label className="employee-polish-field-wide"><span>Email</span><input type="email" value={profileDraft.email} onChange={event=>setProfileDraft(current=>({...current,email:event.target.value}))} placeholder="Email address"/></label>
        </div>
      </section>

      <section className="employee-polish-settings-card employee-polish-route-card">
        <div className="employee-polish-section-heading"><div><small>ROUTE PREFERENCE</small><h2>Default starting point</h2></div><i>02</i></div>
        <p className="employee-polish-card-intro">This keeps the same route-start setting already used by the Employee app and Admin routing tools.</p>
        <label className="employee-polish-route-field"><span>Default route address</span><textarea value={profileDraft.defaultAddress||""} onChange={event=>setProfileDraft(current=>({...current,defaultAddress:event.target.value}))} placeholder="Where you normally start your workday"/></label>
      </section>

      {message&&<p className="mobile-message employee-polish-profile-message" role="status">{message}</p>}
      <button type="button" className="employee-polish-save-button" onClick={save}>Save profile</button>
      <button type="button" className="employee-polish-signout-button" onClick={()=>void signOutAccount("/mobile/login")}>Sign out</button>
      <p className="employee-polish-profile-footnote">Your current route, visits, tasks and field workflow are unchanged.</p>
    </main>
  </MobileRoleGuard>;
}
