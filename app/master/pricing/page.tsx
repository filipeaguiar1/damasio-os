"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readDemoSession } from "@/lib/auth/demoAuth";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { defaultPricingConfig, normalizePricingConfig, serviceLabels, type PricingConfig, type ServiceKey } from "@/lib/pricing";

const SERVICE_ORDER:ServiceKey[]=["weekly_lawn","biweekly_lawn","one_time_lawn","spring_cleanup","fall_cleanup","snow_removal","extra_service","year_care"];
const SIZE_LABELS:Record<string,string>={xs:"XS",small:"Small",medium:"Medium",large:"Large",legacy:"Legacy large",xlarge:"XL",oversize:"Oversize"};
const FIELD_LABELS:Record<string,string>={
  "2in":"2 in","3in":"3 in","4in":"4 in","5in":"5 in",
  mulched:"Mulch clippings",bag_green_bin:"Bag to green bin",bag_leave_property:"Bag & leave",removed:"Remove bags",no_preference:"No preference",
  light:"Light",moderate:"Moderate",heavy:"Heavy",not_sure:"Not sure",typical:"Typical",wooded:"Large / wooded",
  haul_away:"Haul away",mulch_wooded_area:"Mulch / wooded area",quote_both:"Quote both",one:"1 visit",two:"2 visits",unlimited:"Unlimited",
  one_car:"1-car",two_car:"2-car",three_car:"3-car",four_plus:"4+ car",custom:"Custom / long",under_500:"Under 500 sq ft","500_1000":"500–1,000 sq ft","1000_1500":"1,000–1,500 sq ft","1500_plus":"1,500+ sq ft",
  no:"No",yes:"Yes",front_walk:"Front walkway",sidewalk_steps:"Sidewalk & steps",all_paved:"All paved surfaces"
};

function title(key:string){return FIELD_LABELS[key]||SIZE_LABELS[key]||key.replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());}

export default function MasterPricingPage(){
  const router=useRouter();
  const[config,setConfig]=useState<PricingConfig>(defaultPricingConfig);
  const[expanded,setExpanded]=useState<ServiceKey|null>("weekly_lawn");
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[message,setMessage]=useState("Loading pricing...");
  const[demo,setDemo]=useState(false);

  async function token(){const supabase=getSupabaseBrowserClient() as any;const{data}=await supabase.auth.getSession();return data.session?.access_token||"";}

  useEffect(()=>{let alive=true;void(async()=>{
    const demoSession=readDemoSession();
    if(demoSession?.role==="master"){
      const local=localStorage.getItem("damasio_master_pricing");
      if(!alive)return;setDemo(true);setConfig(normalizePricingConfig(local?JSON.parse(local):defaultPricingConfig));setMessage("");setLoading(false);return;
    }
    if(!isSupabaseConfigured()){router.replace("/login");return;}
    const supabase=getSupabaseBrowserClient() as any;
    const{data:auth}=await supabase.auth.getUser();
    if(!auth?.user){router.replace("/login");return;}
    const{data:profile}=await supabase.from("profiles").select("role,active").eq("id",auth.user.id).maybeSingle();
    if(profile?.role!=="master"||!profile?.active){router.replace("/login");return;}
    const access=await token();if(!access){router.replace("/login");return;}
    const response=await fetch("/api/master/pricing",{headers:{authorization:`Bearer ${access}`},cache:"no-store"});
    const result=await response.json();if(!alive)return;
    if(!response.ok){setMessage(result.error||"Pricing could not be loaded.");setLoading(false);return;}
    setConfig(normalizePricingConfig(result.config));setMessage("");setLoading(false);
  })();return()=>{alive=false};},[router]);

  function setRuleNumber(service:ServiceKey,key:string,value:string){
    const n=Math.max(0,Number(value)||0);
    setConfig(prev=>({...prev,services:{...prev.services,[service]:{...prev.services[service],[key]:n}}}));
  }
  function setMapNumber(service:ServiceKey,mapKey:string,itemKey:string,value:string){
    const n=Math.max(0,Number(value)||0);
    setConfig(prev=>{const rule=prev.services[service] as any;return{...prev,services:{...prev.services,[service]:{...rule,[mapKey]:{...(rule[mapKey]||{}),[itemKey]:n}}}}});
  }
  function setMembership(key:"routine"|"seasonal"|"year_care",value:string){setConfig(prev=>({...prev,memberships:{...prev.memberships,[key]:Math.max(0,Number(value)||0)}}));}

  async function save(){
    setSaving(true);setMessage("Saving pricing...");
    try{
      const clean=normalizePricingConfig(config);setConfig(clean);
      if(demo){localStorage.setItem("damasio_master_pricing",JSON.stringify(clean));setMessage("Demo pricing saved on this device.");return;}
      const access=await token();if(!access){setMessage("Your Master login expired. Sign in again.");return;}
      const response=await fetch("/api/master/pricing",{method:"PATCH",headers:{"content-type":"application/json",authorization:`Bearer ${access}`},body:JSON.stringify({config:clean})});
      const result=await response.json();
      if(!response.ok){setMessage(result.error||"Pricing could not be saved.");return;}
      setConfig(normalizePricingConfig(result.config));setMessage(result.message||"Pricing saved.");
    }finally{setSaving(false);}
  }

  const groups=useMemo(()=>({
    grassHeightFees:"Grass height — add $",
    grassHandlingFees:"Grass handling / bags — add $",
    cleanupLeafFees:"Leaf amount — add $",
    cleanupDebrisFees:"Debris / sticks — add $",
    cleanupDisposalFees:"Disposal — add $",
    cleanupVisitFees:"Cleanup visits — add $",
    snowDrivewayFees:"Driveway size — add $",
    snowAreaFees:"Snow clearing area — add $",
    snowSidewalkFees:"Walkway / paved areas — add $",
    snowSaltFees:"Salt / de-icing — add $"
  }),[]);

  if(loading)return <main className="master-pricing-page"><div className="master-pricing-shell"><p>{message}</p></div></main>;

  return <main className="master-pricing-page"><div className="master-pricing-shell">
    <Link className="master-pricing-back" href="/master">← Back to Master</Link>
    <header className="master-pricing-header"><div><span>MASTER ONLY · PRICING ENGINE</span><h1>Pricing & memberships</h1><p>Set the base price and every quote modifier. The public Instant Quote uses these values when the customer selects property size, grass handling, difficulty, cleanup details or snow options.</p></div><div className="master-pricing-save"><button className="secondary" type="button" onClick={()=>setConfig(defaultPricingConfig)}>Restore defaults</button><button type="button" disabled={saving} onClick={()=>void save()}>{saving?"Saving…":"Save all pricing"}</button></div></header>
    {message&&<div className="master-pricing-status">{message}</div>}
    <p className="master-pricing-note">Changes are platform-wide and are not available to Company Admins. Expand a service to edit its complete pricing formula.</p>

    <section className="pricing-stack" aria-label="Service pricing">
      {SERVICE_ORDER.map(service=>{const rule=config.services[service];const open=expanded===service;const special=service==="extra_service"||service==="year_care";return <article key={service} className={`pricing-accordion ${open?"open":""}`}>
        <button className="pricing-accordion-head" type="button" aria-expanded={open} onClick={()=>setExpanded(open?null:service)}><div><strong>{serviceLabels[service]}</strong><small>{special?"Manual/final review service":"Click to edit base price and quote attributes"}</small></div><span className="pricing-base-chip">Base ${rule.base.toFixed(2)}</span><span className="pricing-chevron">⌄</span></button>
        {open&&<div className="pricing-body">
          <div className="pricing-body-intro"><PriceInput label="Base service price ($)" value={rule.base} onChange={v=>setRuleNumber(service,"base",v)}/><PriceInput label="Access / terrain difficulty add-on ($)" value={rule.difficultyFee} onChange={v=>setRuleNumber(service,"difficultyFee",v)}/></div>
          <div className="pricing-groups">
            {!special&&<PriceMap title="Property / lawn size multiplier (×)" values={rule.sizeMultipliers} onChange={(k,v)=>setMapNumber(service,"sizeMultipliers",k,v)} labels={SIZE_LABELS} step="0.05" help="The selected base price is multiplied by this value before add-ons. 1.00 keeps the base price unchanged."/>}
            {Object.entries(groups).map(([mapKey,groupTitle])=>{const values=(rule as any)[mapKey] as Record<string,number>|undefined;return values?<PriceMap key={mapKey} title={groupTitle} values={values} onChange={(k,v)=>setMapNumber(service,mapKey,k,v)} labels={FIELD_LABELS}/>:null;})}
          </div>
        </div>}
      </article>})}
    </section>

    <section className="pricing-memberships"><header><h2>Memberships</h2><p>Edit the monthly starting points shown for maintenance plans. Year Care updates the public website price after saving.</p></header><div className="pricing-membership-grid">
      <div className="pricing-membership-card"><strong>Routine</strong><PriceInput label="Monthly price ($)" value={config.memberships.routine} onChange={v=>setMembership("routine",v)}/></div>
      <div className="pricing-membership-card"><strong>Seasonal</strong><PriceInput label="Monthly price ($)" value={config.memberships.seasonal} onChange={v=>setMembership("seasonal",v)}/></div>
      <div className="pricing-membership-card year"><strong>Year Care · Premium</strong><PriceInput label="Starting monthly price ($)" value={config.memberships.year_care} onChange={v=>setMembership("year_care",v)}/></div>
    </div></section>
  </div></main>;
}

function PriceInput({label,value,onChange,step="1"}:{label:string;value:number;onChange:(value:string)=>void;step?:string}){return <div className="pricing-field"><label>{label}</label><input type="number" min="0" step={step} value={Number.isFinite(value)?value:0} onChange={e=>onChange(e.target.value)}/></div>}

function PriceMap({title:groupTitle,values,onChange,labels={},step="1",help}:{title:string;values:Record<string,number>;onChange:(key:string,value:string)=>void;labels?:Record<string,string>;step?:string;help?:string}){return <div className="pricing-group"><h3>{groupTitle}</h3><div className="pricing-grid">{Object.entries(values).map(([key,value])=><PriceInput key={key} label={labels[key]||title(key)} value={value} step={step} onChange={v=>onChange(key,v)}/>)}</div>{help&&<p className="pricing-help">{help}</p>}</div>}
