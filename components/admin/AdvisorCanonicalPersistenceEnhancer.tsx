"use client";

import { useEffect } from "react";

type Point={latitude:number;longitude:number};
type DayState={button:HTMLButtonElement;index:number;used:number;capacity:number;date:string;addresses:string[]};
const geoCache=new Map<string,Point>();
function sleep(ms:number){return new Promise(resolve=>window.setTimeout(resolve,ms));}
function haversine(a:Point,b:Point){const r=6371;const toRad=(v:number)=>v*Math.PI/180;const dLat=toRad(b.latitude-a.latitude);const dLon=toRad(b.longitude-a.longitude);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a.latitude))*Math.cos(toRad(b.latitude))*Math.sin(dLon/2)**2;return 2*r*Math.asin(Math.sqrt(q));}
async function geocode(address:string){const key=address.trim().toLowerCase();const hit=geoCache.get(key);if(hit)return hit;const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(address)}`,{cache:"no-store"});if(!response.ok)throw new Error("geocode");const result=await response.json();const point={latitude:Number(result.latitude),longitude:Number(result.longitude)};if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude))throw new Error("geocode");geoCache.set(key,point);return point;}
function centroid(points:Point[]){return{latitude:points.reduce((s,p)=>s+p.latitude,0)/points.length,longitude:points.reduce((s,p)=>s+p.longitude,0)/points.length};}

async function collectDays(planner:HTMLElement):Promise<DayState[]>{
  const buttons=[...planner.querySelectorAll<HTMLButtonElement>(".planner-days > button")];const result:DayState[]=[];
  for(let index=0;index<buttons.length;index++){
    const button=buttons[index];const match=(button.querySelector("strong")?.textContent||"").match(/(\d+)\s*\/\s*(\d+)/);if(!match)continue;const used=Number(match[1]);const capacity=Number(match[2]);if(!used){result.push({button,index,used,capacity,date:"",addresses:[]});continue;}
    button.click();await sleep(35);const rows=[...planner.querySelectorAll<HTMLElement>(".planner-stop-list article")];const firstSelect=rows[0]?.querySelector<HTMLSelectElement>("select");const date=firstSelect?.value||"";const addresses=rows.map(row=>{const value=row.querySelector("small")?.textContent||"";return value.split(" · ")[0].trim();}).filter(Boolean);result.push({button,index,used,capacity,date,addresses});
  }
  return result;
}

async function consolidateSingletonDays(planner:HTMLElement){
  for(let pass=0;pass<4;pass++){
    const days=await collectDays(planner);const singleton=days.find(day=>day.used===1&&day.addresses.length===1);if(!singleton)break;const candidates=days.filter(day=>day.index!==singleton.index&&day.used>=2&&day.used<day.capacity&&day.date&&day.addresses.length);if(!candidates.length)break;
    let sourcePoint:Point;try{sourcePoint=await geocode(singleton.addresses[0]);}catch{break;}
    let best:DayState|null=null;let bestScore=Number.POSITIVE_INFINITY;let bestDistance=Number.POSITIVE_INFINITY;
    for(const candidate of candidates){try{const points=await Promise.all(candidate.addresses.map(geocode));const distance=haversine(sourcePoint,centroid(points));const score=distance+Math.abs(candidate.index-singleton.index)*1.2-Math.min(candidate.used,10)*.45;if(score<bestScore){bestScore=score;bestDistance=distance;best=candidate;}}catch{}}
    if(!best||bestDistance>25)break;
    singleton.button.click();await sleep(35);const select=planner.querySelector<HTMLSelectElement>(".planner-stop-list article select");if(!select||![...select.options].some(option=>option.value===best!.date))break;select.value=best.date;select.dispatchEvent(new Event("change",{bubbles:true}));await sleep(80);
  }
  const recalc=[...planner.querySelectorAll<HTMLButtonElement>("button")].find(button=>/Recalculate Smart Routes/i.test(button.textContent||""));if(recalc&&!recalc.disabled){recalc.click();await sleep(120);}
}

export function AdvisorCanonicalPersistenceEnhancer(){
  useEffect(()=>{
    let disposed=false;let scanTimer=0;const pendingFit=new WeakSet<HTMLElement>();const pendingRebuild=new WeakSet<HTMLElement>();
    const decorate=()=>{document.querySelectorAll<HTMLElement>(".advanced-planner-v6").forEach(planner=>{const buttons=[...planner.querySelectorAll<HTMLButtonElement>(".planner-action-buttons button")];for(const button of buttons){const text=button.textContent||"";const match=text.match(/^Fit\s+(\d+)\s+new\s+into\s+week$/i);if(match)button.textContent=`Fit & save ${match[1]} new`;}});};
    const waitForFit=async(planner:HTMLElement)=>{for(let i=0;i<160&&!disposed&&planner.isConnected;i++){await sleep(125);const message=planner.querySelector<HTMLElement>(".planner-message")?.textContent||"";if(/fitted into the existing week/i.test(message)){const publish=planner.querySelector<HTMLButtonElement>(".planner-publish > button");if(!publish||publish.disabled)continue;const original=window.confirm;window.confirm=()=>true;try{publish.click();}finally{window.confirm=original;}pendingFit.delete(planner);return;}if(/failed|could not|No open day|Increase the daily limits/i.test(message)){pendingFit.delete(planner);return;}}pendingFit.delete(planner);};
    const waitForRebuild=async(planner:HTMLElement)=>{for(let i=0;i<160&&!disposed&&planner.isConnected;i++){await sleep(125);const message=planner.querySelector<HTMLElement>(".planner-message")?.textContent||"";if(/Week rebuilt with/i.test(message)){await consolidateSingletonDays(planner);pendingRebuild.delete(planner);return;}if(/failed|No remaining day capacity/i.test(message)){pendingRebuild.delete(planner);return;}}pendingRebuild.delete(planner);};
    const onClick=(event:MouseEvent)=>{const target=(event.target as Element|null)?.closest<HTMLButtonElement>(".advanced-planner-v6 button");if(!target||target.disabled)return;const planner=target.closest<HTMLElement>(".advanced-planner-v6");if(!planner)return;const text=(target.textContent||"").trim();if(/^Fit\s*&\s*save\s+\d+\s+new$/i.test(text)||/^Fit\s+\d+\s+new\s+into\s+week$/i.test(text)){if(!pendingFit.has(planner)){pendingFit.add(planner);void waitForFit(planner);}}else if(/Rebuild selected week|Generate week \+ Smart Routes/i.test(text)){if(!pendingRebuild.has(planner)){pendingRebuild.add(planner);void waitForRebuild(planner);}}};
    const schedule=()=>{window.clearTimeout(scanTimer);scanTimer=window.setTimeout(decorate,25);};decorate();const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true,characterData:true});document.addEventListener("click",onClick,true);
    return()=>{disposed=true;observer.disconnect();document.removeEventListener("click",onClick,true);window.clearTimeout(scanTimer);};
  },[]);
  return <style jsx global>{`
    .advanced-planner-v6 .planner-action-buttons button:first-child:not(:disabled){position:relative}.advanced-planner-v6 .planner-action-buttons button:first-child:not(:disabled):after{content:"CANONICAL SAVE";position:absolute;right:8px;top:-8px;padding:2px 6px;border-radius:999px;background:#0b7655;color:#fff;font-size:7px;font-weight:950;letter-spacing:.08em;box-shadow:0 3px 8px rgba(11,118,85,.2)}
  `}</style>;
}
