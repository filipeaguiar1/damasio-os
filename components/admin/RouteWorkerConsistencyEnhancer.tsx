"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Worker={id:string;crewId:string;name:string};
type House={id:string;crewId:string|null;name:string;address:string};
const PAGE_SIZE=10;
let cache:{workers:Worker[];houses:House[];at:number}|null=null;

async function loadData(force=false){
  if(!force&&cache&&Date.now()-cache.at<15000)return cache;
  const client=getSupabaseBrowserClient() as any;
  const [workersResult,housesResult]=await Promise.all([
    client.from("employees").select("profile_id,crew_id,full_name").eq("active",true),
    client.rpc("get_company_dispatch_jobs"),
  ]);
  if(workersResult.error)throw new Error(workersResult.error.message);
  if(housesResult.error)throw new Error(housesResult.error.message);
  const workers:Worker[]=(workersResult.data||[]).filter((row:any)=>row.profile_id&&row.crew_id).map((row:any)=>({id:String(row.profile_id),crewId:String(row.crew_id),name:String(row.full_name||"Employee")}));
  const houses:House[]=(Array.isArray(housesResult.data)?housesResult.data:[]).map((row:any)=>({id:String(row.id||row.jobId||""),crewId:row.crewId||row.crew_id||null,name:String(row.customerName||row.customer_name||"Customer"),address:String(row.address||"Address missing")})).filter((house:House)=>Boolean(house.id));
  cache={workers,houses,at:Date.now()};return cache;
}

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text:string,className?:string){const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;}

function render(panel:HTMLElement,worker:Worker|null,houses:House[],loading=false,error=""){
  const open=panel.dataset.open==="1";const pages=Math.max(1,Math.ceil(houses.length/PAGE_SIZE));const page=Math.min(pages,Math.max(1,Number(panel.dataset.page||"1")||1));panel.dataset.page=String(page);panel.replaceChildren();
  const toggle=document.createElement("button");toggle.type="button";toggle.className="build-owner-toggle";toggle.setAttribute("aria-expanded",String(open));
  const copy=document.createElement("span");copy.append(make("strong",loading?"Loading owned houses…":worker?`${worker.name} · ${houses.length} owned house${houses.length===1?"":"s"}`:"Choose a worker"),make("small",error||(worker?"Expand to verify the houses permanently assigned to this worker.":"Select a worker to verify ownership.")));
  toggle.append(make("i","⌂"),copy,make("b",open?"−":"+"));toggle.onclick=()=>{panel.dataset.open=open?"0":"1";render(panel,worker,houses,loading,error);};panel.append(toggle);
  if(!open)return;
  const body=document.createElement("div");body.className="build-owner-body";
  if(loading||error||!worker||!houses.length){body.append(make("p",loading?"Loading houses…":error||(!worker?"Choose a worker first.":"This worker currently owns 0 houses.")));}
  else{
    for(const house of houses.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE)){const row=document.createElement("article");const detail=document.createElement("span");detail.append(make("strong",house.name),make("small",house.address));row.append(make("b","✓"),detail,make("em","Owned"));body.append(row);}
    if(pages>1){const pager=document.createElement("footer");const prev=document.createElement("button");prev.type="button";prev.textContent="‹";prev.disabled=page===1;prev.onclick=()=>{panel.dataset.page=String(page-1);render(panel,worker,houses);};const next=document.createElement("button");next.type="button";next.textContent="›";next.disabled=page===pages;next.onclick=()=>{panel.dataset.page=String(page+1);render(panel,worker,houses);};pager.append(prev,make("span",`Page ${page} of ${pages} · ${houses.length} houses`),next);body.append(pager);}
  }
  panel.append(body);
}

export function RouteWorkerConsistencyEnhancer(){
  useEffect(()=>{
    let dead=false;let timer=0;let seq=0;
    const cleanup=()=>document.querySelectorAll<HTMLElement>(".build-owner-inspector").forEach(panel=>{if(!panel.closest(".build-v3")&&!panel.closest(".mobile-build-employee"))panel.remove();});
    const attach=(select:HTMLSelectElement,host:HTMLElement)=>{let panel=host.querySelector<HTMLElement>(":scope > .build-owner-inspector");if(!panel){panel=document.createElement("section");panel.className="build-owner-inspector";panel.dataset.open="0";host.append(panel);}const refresh=async(force=false)=>{const current=++seq;const id=select.value;render(panel!,id?{id,crewId:"",name:select.selectedOptions[0]?.textContent||"Employee"}:null,[],true);try{const data=await loadData(force);if(dead||current!==seq||!panel!.isConnected)return;const worker=data.workers.find(item=>item.id===id)||null;render(panel!,worker,worker?data.houses.filter(house=>house.crewId===worker.crewId):[]);}catch(reason){if(dead||current!==seq||!panel!.isConnected)return;render(panel!,null,[],false,reason instanceof Error?reason.message:"Ownership could not be loaded.");}};if(select.dataset.buildOwnedBound!=="1"){select.dataset.buildOwnedBound="1";select.addEventListener("change",()=>void refresh());}void refresh();};
    const scan=()=>{cleanup();document.querySelectorAll<HTMLSelectElement>(".build-v3 .build-controls select").forEach(select=>{const host=select.closest<HTMLElement>(".build-controls");if(host)attach(select,host);});document.querySelectorAll<HTMLSelectElement>(".mobile-build-employee select").forEach(select=>{const host=select.closest<HTMLElement>(".mobile-build-employee");if(host)attach(select,host);});};
    const schedule=()=>{clearTimeout(timer);timer=window.setTimeout(scan,25);};scan();const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});
    const click=(event:MouseEvent)=>{if(!(event.target as Element|null)?.closest(".build-save button,.mobile-build-assignment>button"))return;cache=null;window.setTimeout(scan,450);};document.addEventListener("click",click);
    return()=>{dead=true;observer.disconnect();document.removeEventListener("click",click);clearTimeout(timer);document.querySelectorAll(".build-owner-inspector").forEach(panel=>panel.remove());};
  },[]);
  return <style jsx global>{`
    .build-owner-inspector{grid-column:1/-1;border:1px solid #d5e5dc;border-radius:17px;background:linear-gradient(145deg,#f2f9f5,#fff);overflow:hidden}.build-owner-toggle{display:flex;align-items:center;gap:11px;width:100%;min-height:62px;padding:11px 13px;border:0;background:transparent;text-align:left;color:#153e30}.build-owner-toggle>i{display:grid;place-items:center;width:39px;height:39px;border-radius:12px;background:#0b7655;color:#fff;font-style:normal;font-size:20px}.build-owner-toggle>span{display:grid;gap:2px;flex:1}.build-owner-toggle strong,.build-owner-toggle small{display:block}.build-owner-toggle strong{font-size:14px}.build-owner-toggle small{font-size:11px;color:#667c70}.build-owner-toggle>b{display:grid;place-items:center;width:29px;height:29px;border-radius:9px;background:#e4f1ea;color:#0b7655}.build-owner-body{display:grid;gap:5px;padding:8px;border-top:1px solid #e1ece6;background:#fff}.build-owner-body>article{display:grid;grid-template-columns:30px 1fr auto;gap:9px;align-items:center;padding:9px;border:1px solid #e5eee9;border-radius:11px}.build-owner-body>article>b{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#e5f4eb;color:#0b7655}.build-owner-body article strong,.build-owner-body article small{display:block}.build-owner-body article small{font-size:10px;color:#718078}.build-owner-body article em{font-style:normal;font-size:9px;font-weight:900;color:#0b7655}.build-owner-body>p{margin:0;padding:16px;text-align:center;color:#6d7f75}.build-owner-body>footer{display:grid;grid-template-columns:38px 1fr 38px;align-items:center;gap:8px}.build-owner-body>footer button{height:34px;border:1px solid #d5e5dc;border-radius:9px;background:#fff;color:#0b7655}.build-owner-body>footer span{text-align:center;font-size:10px;color:#667c70}.mobile-build-employee .build-owner-inspector{margin-top:10px}
  `}</style>;
}
