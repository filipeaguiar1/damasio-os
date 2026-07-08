"use client";

import { useState } from "react";
import { PortalShell } from "@/components/admin/PortalShell";
import { getLeads, saveServicePhotos } from "@/lib/storage";

export default function Photos(){
  const leads=getLeads();
  const [selected,setSelected]=useState(leads[0]?.id||"");
  const [photos,setPhotos]=useState<string[]>([]);
  const [message,setMessage]=useState("");

  function addPhoto(){
    if(photos.length>=5){setMessage("Maximum 5 photos per service.");return}
    setPhotos([...photos,`Photo ${photos.length+1}`]);
  }
  function save(){
    if(!selected){setMessage("Select a job first.");return}
    saveServicePhotos(selected,photos);
    setMessage(`${photos.length} photo(s) saved. Maximum allowed: 5.`);
  }

  return <PortalShell type="Employee" active="Photos">
    <div className="app-top"><div><span className="eyebrow">Photos</span><h1>Service Photos</h1><p className="section-intro">Simple upload flow. Maximum 5 photos per service.</p></div></div>
    <div className="card profile-card">
      <div className="field"><label>Job</label><select className="input" value={selected} onChange={e=>setSelected(e.target.value)}>{leads.map(l=><option key={l.id} value={l.id}>{l.name} — {l.service}</option>)}</select></div>
      <div className="photo-slots">{[0,1,2,3,4].map(i=><div className="photo-slot" key={i}>{photos[i]||"Empty slot"}</div>)}</div>
      <div className="row" style={{marginTop:16}}><button className="btn btn-outline" onClick={addPhoto}>Add Photo</button><button className="btn btn-primary" onClick={save}>Save Photos</button></div>
      {message&&<div className="payment-message" style={{marginTop:14}}>{message}</div>}
    </div>
  </PortalShell>
}
