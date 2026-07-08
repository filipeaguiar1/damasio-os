"use client";
import {useMemo,useState} from "react";
import {calculateQuote,serviceLabels,ServiceKey} from "@/lib/pricing";
import {saveLead,updateLeadPayment,PaymentMethod,GrassHandling,LawnSize,GrassHeight} from "@/lib/storage";

const services:{key:ServiceKey;note?:string}[]=[
  {key:"weekly_lawn"},
  {key:"biweekly_lawn"},
  {key:"one_time_lawn"},
  {key:"spring_cleanup",note:"Seasonal extra charge"},
  {key:"fall_cleanup",note:"Seasonal extra charge"},
  {key:"snow_removal"},
  {key:"extra_service",note:"Custom quote later"}
];

export function QuoteWizard(){
  const[step,setStep]=useState(1);
  const[service,setService]=useState<ServiceKey>("weekly_lawn");
  const[size,setSize]=useState<LawnSize>("small");
  const[grassHandling,setGrassHandling]=useState<GrassHandling>("mulched");
  const[grassHeight,setGrassHeight]=useState<GrassHeight>("3in");
  const[annual,setAnnual]=useState(false);
  const[backyard,setBackyard]=useState(true);
  const[gated,setGated]=useState(false);
  const[leadId,setLeadId]=useState<string|null>(null);
  const[lead,setLead]=useState({name:"",phone:"",email:"",address:"",notes:""});
  const[msg,setMsg]=useState("");
  const isExtra=service==="extra_service";
  const isSeasonal=service==="spring_cleanup"||service==="fall_cleanup";
  const quote=useMemo(()=>calculateQuote({service,size,annual,backyard,gated}),[service,size,annual,backyard,gated]);

  function submit(){
    const id=crypto.randomUUID();
    setLeadId(id);
    saveLead({
      id,
      createdAt:new Date().toISOString(),
      ...lead,
      service:serviceLabels[service],
      status:isExtra?"new":"quoted",
      subtotal:isExtra?0:quote.subtotal,
      tax:isExtra?0:quote.tax,
      total:isExtra?0:quote.total,
      paymentStatus:"not_selected",
      notes:isSeasonal ? "Customer understands price. Admin will define service date." : lead.notes,
      photos:[],
      propertyDetails:{lawnSize:size,grassHeight,grassHandling,backyard,gated,adminNotes:"",propertyAlerts:"",accessNotes:""}
    });
    setStep(4);
  }

  function pay(method:PaymentMethod){
    if(!leadId)return;
    const note=method==="etransfer"?"Waiting for Interac e-Transfer":method==="cash_visit"?"Customer will pay cash at visit":"Customer will pay cheque at visit";
    updateLeadPayment(leadId,method,method==="etransfer"?"pending":"manual",note);
    setMsg(note);
  }

  return <div className="card quote-card">
    <div className="quote-head"><h2>Instant Quote</h2><span className="pill">Step {step}/4</span></div>
    <div className="progress"><div className="progress-bar" style={{width:`${step*25}%`}}/></div>

    {step===1&&<div className="stack">
      <strong>What service do you need?</strong>
      <div className="option-grid">{services.map(i=><button key={i.key} className={service===i.key?"option active":"option"} onClick={()=>setService(i.key)}><strong>{serviceLabels[i.key]}</strong>{i.note&&<small>{i.note}</small>}</button>)}</div>
      {isSeasonal&&<div className="notice">Spring/Fall Cleanups show an estimated price now. The service date will be assigned by the admin after review.</div>}
      <button className="btn btn-primary" onClick={()=>setStep(2)}>Next</button>
    </div>}

    {step===2&&<div className="stack">
      <div className="field"><label>Property address</label><input className="input" value={lead.address} onChange={e=>setLead({...lead,address:e.target.value})} placeholder="Street, city, postal code"/></div>
      {!isExtra?<>
        <div className="field"><label>Lawn size</label><select className="input" value={size} onChange={e=>setSize(e.target.value as LawnSize)}><option value="xs">XS</option><option value="small">Small</option><option value="legacy">Legacy</option><option value="oversize">Oversize</option></select></div>
        <div className="field"><label>Grass height</label><select className="input" value={grassHeight} onChange={e=>setGrassHeight(e.target.value as GrassHeight)}><option value="2in">2&quot;</option><option value="3in">3&quot;</option><option value="4in">4&quot;</option><option value="5in">5&quot;</option></select></div>
        <div className="field"><label>Grass handling preference</label><select className="input" value={grassHandling} onChange={e=>setGrassHandling(e.target.value as GrassHandling)}><option value="mulched">Mulched / leave clippings on lawn</option><option value="bag_green_bin">Bag and place in green bin</option><option value="bag_leave_property">Bag and leave on property</option><option value="no_preference">No preference</option></select></div>
        <div className="row"><button className="btn btn-outline" onClick={()=>setBackyard(!backyard)}>Backyard: {backyard?"Yes":"No"}</button><button className="btn btn-outline" onClick={()=>setGated(!gated)}>Gate: {gated?"Yes":"No"}</button><button className="btn btn-outline" onClick={()=>setAnnual(!annual)}>Annual: {annual?"Yes":"No"}</button></div>
      </>:<div className="field"><label>Tell us what you need</label><textarea className="input" style={{minHeight:120}} value={lead.notes} onChange={e=>setLead({...lead,notes:e.target.value})}/></div>}
      <div className="row"><button className="btn btn-outline" onClick={()=>setStep(1)}>Back</button><button className="btn btn-primary" onClick={()=>setStep(3)}>Next</button></div>
    </div>}

    {step===3&&<div className="stack">
      <strong>Almost done. Where should we send your quote?</strong>
      <input className="input" placeholder="Full name" value={lead.name} onChange={e=>setLead({...lead,name:e.target.value})}/>
      <input className="input" placeholder="Phone" value={lead.phone} onChange={e=>setLead({...lead,phone:e.target.value})}/>
      <input className="input" placeholder="Email" value={lead.email} onChange={e=>setLead({...lead,email:e.target.value})}/>
      <div className="row"><button className="btn btn-outline" onClick={()=>setStep(2)}>Back</button><button className="btn btn-primary" onClick={submit}>Show Quote</button></div>
    </div>}

    {step===4&&<div className="stack">
      {isExtra?<div className="quote-result"><small>Request received</small><div className="quote-price">Saved</div><p>We will review your request and send a custom quote.</p></div>:<div className="quote-result"><small>Your estimated quote</small><div className="quote-price">${quote.total.toFixed(2)}</div><p>Subtotal ${quote.subtotal.toFixed(2)} + HST ${quote.tax.toFixed(2)}</p></div>}
      {!isExtra&&<div className="notice">Saved to customer profile: {size} lawn • {grassHeight} grass • {grassHandling.replaceAll("_"," ")}</div>}
      {isSeasonal&&<div className="notice">You can see the estimated price now. Our admin will schedule the exact service date and contact you.</div>}
      {!isExtra&&<div className="payment-grid"><button className="payment-option" onClick={()=>pay("etransfer")}><strong>Interac e-Transfer</strong><small>Send manually after booking.</small></button><button className="payment-option" onClick={()=>pay("cash_visit")}><strong>Cash at Visit</strong><small>Pay when the team arrives.</small></button><button className="payment-option" onClick={()=>pay("cheque_visit")}><strong>Cheque at Visit</strong><small>Pay by cheque during service.</small></button></div>}
      {msg&&<div className="payment-message">{msg}</div>}
    </div>}
  </div>
}
