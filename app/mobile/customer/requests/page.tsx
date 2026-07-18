"use client";

import {ChangeEvent,useEffect,useRef,useState} from "react";
import {MobileRoleGuard} from "@/components/mobile/MobileRoleGuard";
import {MobileBackButton} from "@/components/mobile/MobileBackButton";
import {MobileCustomerNav} from "@/components/mobile/MobileCustomerNav";
import {addCustomerServiceRequest,loadCustomerPortal} from "@/lib/services/customerPortalService";
import {createLiveCustomerTask,uploadLiveTaskPhotos,usesLiveTaskBackend} from "@/lib/services/liveTaskService";
import type {CustomerPortalBoard} from "@/lib/repositories/customerPortalRepository";

const empty:CustomerPortalBoard={property:null,visits:[],tasks:[],requests:[],quotes:[],feedback:[]};
const services=[["Spring Cleanup","🌱","Seasonal property cleanup"],["Fall Cleanup","🍂","Leaves and winter preparation"],["Custom Request","＋","Tell us what your property needs"],["Return Visit","↺","Something needs another look"]] as const;

export default function MobileCustomerRequests(){
  const[board,setBoard]=useState<CustomerPortalBoard>(empty);
  const[service,setService]=useState("Spring Cleanup");
  const[details,setDetails]=useState("");
  const[open,setOpen]=useState(false);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState("");
  const[evidence,setEvidence]=useState<File[]>([]);
  const evidenceInput=useRef<HTMLInputElement|null>(null);

  function refresh(){void loadCustomerPortal({force:true}).then(setBoard).catch(error=>setMessage(error instanceof Error?error.message:"Requests could not be loaded."))}
  useEffect(()=>refresh(),[]);
  function addEvidence(event:ChangeEvent<HTMLInputElement>){setEvidence(current=>[...current,...Array.from(event.target.files||[])].slice(0,3));event.target.value=""}
  async function submit(){
    if(!details.trim()){setMessage("Tell the company what the property needs.");return}
    setBusy(true);
    try{
      if(service==="Return Visit"&&usesLiveTaskBackend()){
        if(!board.property?.propertyId)throw new Error("Customer property is not connected.");
        const taskId=await createLiveCustomerTask({propertyId:board.property.propertyId,title:"Customer Return Visit",issue:details.trim(),priority:"urgent"});
        if(evidence.length)await uploadLiveTaskPhotos(taskId,evidence,"issue");
        setMessage("Return Visit sent to Admin with the attached evidence.");
      }else{
        const updated=await addCustomerServiceRequest({serviceName:service,message:details});
        setBoard(updated);
        setMessage("Request sent to the company.");
      }
      setDetails("");setEvidence([]);setOpen(false);refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Request could not be sent.")}
    finally{setBusy(false)}
  }

  return <MobileRoleGuard allowed={["customer"]}><main className="mobile-app-shell role-mobile-shell mobile-customer-subpage">
    <header className="role-mobile-topbar"><MobileBackButton fallback="/mobile/customer"/><div><strong>Request Service</strong><span>New work or follow-up</span></div><button className="customer-native-add" onClick={()=>setOpen(true)}>＋</button></header>
    <section className="customer-native-hero request"><span>SELF-SERVICE</span><h1>What does your property need?</h1><p>{board.property?.address||"Choose a service below"}</p></section>
    {message&&<div className="customer-native-message">{message}<button onClick={()=>setMessage("")}>×</button></div>}
    <section className="customer-request-choices">{services.map(([name,icon,note])=><button className={service===name?"selected":""} key={name} onClick={()=>{setService(name);setEvidence([]);setOpen(true)}}><i>{icon}</i><span><strong>{name}</strong><small>{note}</small></span><b>›</b></button>)}</section>
    <div className="customer-section-head"><div><span>MY FOLLOW-UPS</span><h2>Recent activity</h2></div><b>{board.tasks.length+board.requests.length}</b></div>
    <section className="customer-native-list">{board.tasks.map(item=><article key={item.id}><button><i>↺</i><div><strong>{item.title}</strong><span>{item.address||board.property?.address}</span></div><em>{item.status}</em></button></article>)}{board.requests.map(item=><article key={item.id}><button><i>＋</i><div><strong>{item.serviceName}</strong><span>{item.address||board.property?.address}</span></div><em>{item.status}</em></button></article>)}{!board.tasks.length&&!board.requests.length&&<div className="customer-native-empty"><i>＋</i><strong>No requests yet</strong><p>Your submitted requests will stay here.</p></div>}</section>
    {open&&<div className="customer-request-sheet"><button className="customer-sheet-scrim" onClick={()=>setOpen(false)}/><section><header><div><span>NEW REQUEST</span><h2>{service}</h2></div><button onClick={()=>setOpen(false)}>×</button></header><div className="customer-request-property"><i>⌂</i><span><strong>Selected property</strong><small>{board.property?.address||"Customer property"}</small></span></div><label>Details<textarea value={details} onChange={event=>setDetails(event.target.value)} placeholder="Describe what needs attention, access details and anything we should know..."/></label>{service==="Return Visit"&&<div className="mobile-task-evidence"><strong>Photo evidence</strong><p>Add up to three photos showing the issue for Admin review.</p><input ref={evidenceInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={addEvidence}/><button type="button" className="mobile-outline" disabled={evidence.length>=3} onClick={()=>evidenceInput.current?.click()}>Add photo ({evidence.length}/3)</button>{evidence.length>0&&<div>{evidence.map((file,index)=><span key={`${file.name}-${index}`}>{file.name}</span>)}</div>}</div>}<button className="customer-submit-request" disabled={busy} onClick={()=>void submit()}>{busy?"Sending…":"Confirm & Send Request"}</button></section></div>}
    <MobileCustomerNav active="request"/>
  </main></MobileRoleGuard>
}
