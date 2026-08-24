"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS=["M","T","W","T","F","S","S"];

function fromKey(value:string){const[y,m,d]=value.split("-").map(Number);return new Date(Date.UTC(y,m-1,d,17));}
function keyFrom(date:Date){return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;}
function addDays(value:string,days:number){const date=fromKey(value);date.setUTCDate(date.getUTCDate()+days);return keyFrom(date);}
function mondayOf(value:string){const date=fromKey(value);const day=date.getUTCDay();date.setUTCDate(date.getUTCDate()+(day===0?-6:1-day));return keyFrom(date);}
function monthKey(value:string){return value.slice(0,7);}
function shiftMonth(value:string,delta:number){const[y,m]=value.split("-").map(Number);const date=new Date(Date.UTC(y,m-1+delta,1,17));return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}`;}
function formatWeek(start:string){const end=addDays(start,6);const a=fromKey(start);const b=fromKey(end);const first=`${MONTHS[a.getUTCMonth()].slice(0,3)} ${a.getUTCDate()}`;const second=`${MONTHS[b.getUTCMonth()].slice(0,3)} ${b.getUTCDate()}, ${b.getUTCFullYear()}`;return `${first} – ${second}`;}

export function AdvisorWeekPickerEnhancer(){
  const[host,setHost]=useState<HTMLElement|null>(null);
  const[input,setInput]=useState<HTMLInputElement|null>(null);
  const[selectedWeek,setSelectedWeek]=useState("");
  const[viewMonth,setViewMonth]=useState("");
  const[open,setOpen]=useState(false);
  const triggerRef=useRef<HTMLButtonElement|null>(null);
  const[popoverPosition,setPopoverPosition]=useState({left:0,top:0});

  useEffect(()=>{
    let disposed=false;
    let observer:MutationObserver|null=null;
    let detach:(()=>void)|null=null;

    const attach=()=>{
      if(disposed||input)return true;
      const root=document.querySelector(".advanced-planner-v7");
      const native=root?.querySelector<HTMLInputElement>('.planner-controls input[type="date"]');
      const label=native?.closest("label") as HTMLElement|null;
      if(!native||!label)return false;
      const sync=()=>{if(!native.value)return;const monday=mondayOf(native.value);setSelectedWeek(monday);setViewMonth(current=>current||monthKey(monday));};
      native.classList.add("advisor-week-native-input");
      native.hidden=true;
      native.setAttribute("aria-hidden","true");
      native.tabIndex=-1;
      native.style.setProperty("display","none","important");
      sync();
      native.addEventListener("change",sync);
      native.addEventListener("input",sync);
      setInput(native);
      setHost(label);
      detach=()=>{native.classList.remove("advisor-week-native-input");native.hidden=false;native.removeAttribute("aria-hidden");native.tabIndex=0;native.style.removeProperty("display");native.removeEventListener("change",sync);native.removeEventListener("input",sync);};
      return true;
    };

    if(!attach()){
      observer=new MutationObserver(()=>{if(attach()){observer?.disconnect();observer=null;}});
      observer.observe(document.body,{childList:true,subtree:true});
    }
    return()=>{disposed=true;observer?.disconnect();detach?.();};
  },[input]);

  const positionPopover=useCallback(()=>{
    const trigger=triggerRef.current;
    if(!trigger)return;
    const rect=trigger.getBoundingClientRect();
    const width=Math.min(300,window.innerWidth-24);
    const height=330;
    const left=Math.max(12,Math.min(rect.left,window.innerWidth-width-12));
    const below=rect.bottom+7;
    const top=below+height<=window.innerHeight-12?below:Math.max(12,rect.top-height-7);
    setPopoverPosition({left,top});
  },[]);

  useEffect(()=>{
    if(!open)return;
    positionPopover();
    const sync=()=>positionPopover();
    window.addEventListener("resize",sync);
    window.addEventListener("scroll",sync,true);
    return()=>{window.removeEventListener("resize",sync);window.removeEventListener("scroll",sync,true)};
  },[open,positionPopover]);

  const cells=useMemo(()=>{
    if(!viewMonth)return[];
    const[y,m]=viewMonth.split("-").map(Number);
    const first=keyFrom(new Date(Date.UTC(y,m-1,1,17)));
    const gridStart=mondayOf(first);
    return Array.from({length:42},(_,index)=>addDays(gridStart,index));
  },[viewMonth]);

  function choose(value:string){
    if(!input)return;
    const monday=mondayOf(value);
    setSelectedWeek(monday);
    setViewMonth(monthKey(monday));
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;
    setter?.call(input,monday);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    setOpen(false);
  }

  if(!host||!input||!selectedWeek)return null;
  const selectedEnd=addDays(selectedWeek,6);
  const[y,m]=viewMonth.split("-").map(Number);

  return createPortal(<div className="advisor-week-picker">
    <button ref={triggerRef} type="button" className="advisor-week-trigger" aria-expanded={open} onClick={()=>setOpen(current=>{if(!current)requestAnimationFrame(positionPopover);return !current})}>
      <span><strong>{formatWeek(selectedWeek)}</strong><small>Monday → Sunday</small></span><b aria-hidden="true">▾</b>
    </button>
    {open&&createPortal(<div className="advisor-week-popover advisor-week-popover-fixed" style={{left:popoverPosition.left,top:popoverPosition.top}} role="dialog" aria-label="Choose route week">
      <div className="advisor-week-month-head"><button type="button" aria-label="Previous month" onClick={()=>setViewMonth(current=>shiftMonth(current,-1))}>‹</button><strong>{MONTHS[m-1]} {y}</strong><button type="button" aria-label="Next month" onClick={()=>setViewMonth(current=>shiftMonth(current,1))}>›</button></div>
      <div className="advisor-week-day-head">{DAYS.map((day,index)=><span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="advisor-week-grid">{cells.map(value=>{const date=fromKey(value);const inside=value>=selectedWeek&&value<=selectedEnd;const start=value===selectedWeek;const end=value===selectedEnd;const outside=date.getUTCMonth()!==m-1;return <button type="button" key={value} className={`${inside?"selected":""}${start?" selected-start":""}${end?" selected-end":""}${outside?" outside":""}`} aria-label={`Select week containing ${value}`} aria-pressed={inside} onClick={()=>choose(value)}>{date.getUTCDate()}</button>;})}</div>
      <div className="advisor-week-caption">Selected week: <strong>{formatWeek(selectedWeek)}</strong></div>
    </div>,document.body)}
    <style jsx global>{`
      .advanced-planner-v7 .advisor-week-native-input{display:none!important}
      .advanced-planner-v7 .advisor-week-picker{position:relative;width:100%;margin-top:1px}
      .advanced-planner-v7 .advisor-week-trigger{display:flex;align-items:center;justify-content:space-between;width:100%;min-height:48px;padding:8px 12px;border:1px solid #cfdfd6;border-radius:13px;background:#fcfefd;color:#173a2c;text-align:left;cursor:pointer}
      .advanced-planner-v7 .advisor-week-trigger span{display:grid;gap:1px}.advanced-planner-v7 .advisor-week-trigger strong{font-size:14px;line-height:1.25}.advanced-planner-v7 .advisor-week-trigger small{font-size:11px;color:#718078}.advanced-planner-v7 .advisor-week-trigger>b{font-size:16px;color:#527065}
      .advisor-week-popover.advisor-week-popover-fixed{position:fixed;z-index:100000;width:300px;max-width:calc(100vw - 24px);padding:12px;border:1px solid #cfded6;border-radius:15px;background:#fff;box-shadow:0 24px 56px rgba(7,45,31,.28)}
      .advanced-planner-v7 .advisor-week-month-head{display:grid;grid-template-columns:34px 1fr 34px;align-items:center;gap:6px;margin-bottom:8px}.advanced-planner-v7 .advisor-week-month-head strong{text-align:center;font-size:14px;color:#183b2e}.advanced-planner-v7 .advisor-week-month-head button{height:32px;border:0;border-radius:9px;background:#eff5f2;color:#174b38;font-size:22px;line-height:1;cursor:pointer}
      .advanced-planner-v7 .advisor-week-day-head,.advanced-planner-v7 .advisor-week-grid{display:grid;grid-template-columns:repeat(7,1fr)}
      .advanced-planner-v7 .advisor-week-day-head span{padding:4px 0 6px;text-align:center;font-size:10px;font-weight:900;color:#7b8982}
      .advanced-planner-v7 .advisor-week-grid{overflow:hidden;border-radius:9px}.advanced-planner-v7 .advisor-week-grid button{height:34px;border:0;border-radius:0;background:transparent;color:#223f34;font-size:12px;font-weight:750;cursor:pointer}.advanced-planner-v7 .advisor-week-grid button:hover:not(.selected){background:#eef5f2}.advanced-planner-v7 .advisor-week-grid button.outside:not(.selected){color:#b8c1bd}.advanced-planner-v7 .advisor-week-grid button.selected{background:#1769e0;color:#fff!important;font-weight:950}.advanced-planner-v7 .advisor-week-grid button.selected-start{border-radius:9px 0 0 9px}.advanced-planner-v7 .advisor-week-grid button.selected-end{border-radius:0 9px 9px 0}
      .advanced-planner-v7 .advisor-week-caption{margin-top:9px;padding:7px 9px;border-radius:9px;background:#eef5ff;color:#33516e;font-size:10px}.advanced-planner-v7 .advisor-week-caption strong{color:#174a88}
    `}</style>
  </div>,host);
}
