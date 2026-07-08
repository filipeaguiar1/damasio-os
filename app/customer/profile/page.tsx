"use client";
import {ChangeEvent,useEffect,useState} from "react";
import {PortalShell} from "@/components/admin/PortalShell";
import {Lead,getLeads,seedDemoLeads,setPropertyPhoto} from "@/lib/storage";

function fileToDataUrl(file: File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});}

export default function Profile(){
  const[lead,setLead]=useState<Lead|null>(null);
  const[message,setMessage]=useState("");
  useEffect(()=>{seedDemoLeads();setLead(getLeads()[0]||null)},[]);
  async function upload(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];
    if(!file||!lead)return;
    const data=await fileToDataUrl(file);
    setPropertyPhoto(lead.id,data);
    setLead(getLeads().find(l=>l.id===lead.id)||lead);
    setMessage("Property photo saved as the official house photo.");
  }
  return <PortalShell type="Customer" active="Profile"><div className="app-top"><div><span className="eyebrow">Profile</span><h1>My Property</h1><p className="section-intro">Upload the official front photo of your house so the crew can recognize the property quickly.</p></div></div><div className="card profile-card property-profile-card"><div className="house-image compact-house">{lead?.propertyPhoto?<img src={lead.propertyPhoto} alt="Official property"/>:<div className="house-placeholder">🏠</div>}</div><div className="field"><label>Official Property Photo</label><input className="input" type="file" accept="image/*" onChange={upload}/><small>The latest uploaded photo becomes the default property photo.</small></div>{message&&<div className="payment-message">{message}</div>}<div className="field"><label>Name</label><input className="input" defaultValue={lead?.name||"John Smith"}/></div><div className="field"><label>Address</label><input className="input" defaultValue={lead?.address||"123 King St, Hamilton"}/></div><div className="field"><label>Notes</label><textarea className="input" defaultValue={lead?.propertyDetails?.accessNotes||"Gate code, dogs, preferred day..."}/></div></div></PortalShell>
}
