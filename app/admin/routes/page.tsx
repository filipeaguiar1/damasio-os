"use client";
import {MouseEvent,useEffect,useMemo,useState} from "react";
import Link from "next/link";
import {AdminShell} from "@/components/admin/AdminShell";
import {CompactFilter} from "@/components/admin/CompactFilter";
import {AddressAutocomplete} from "@/components/home/AddressAutocomplete";
import {DAMASIO_CREWS,DAMASIO_SYNC_EVENT,DAMASIO_WEEK_DAYS,Lead,calculateVisitStatus,getLeads,getRegionFromAddress,publishAiRoute,saveSmartRouteDraft,seedDemoLeads,undoAiRoute,updateHomeSchedule,updateLead,moveHomesToCrew} from "@/lib/storage";

function mapsHref(address:string){return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
function openNativeDirections(address:string,e:MouseEvent<HTMLAnchorElement>){
  const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if(!isMobile)return;
  e.preventDefault();
  const q=encodeURIComponent(address);
  window.location.href=`geo:0,0?q=${q}`;
  window.setTimeout(()=>{window.location.href=mapsHref(address)},650);
}

function visitLabel(status:string){
  if(status==="completed")return "Completed";
  if(status==="booked")return "Booked";
  if(status==="overdue")return "Overdue";
  return "Needs booking soon";
}

export default function RoutesPage(){
  const[leads,setLeads]=useState<Lead[]>([]);
  const[crew,setCrew]=useState(DAMASIO_CREWS[0]);
  const[day,setDay]=useState("Monday");
  const[draft,setDraft]=useState<Lead[]>([]);
  const[message,setMessage]=useState("");
  const[selected,setSelected]=useState<string[]>([]);
  const[targetCrew,setTargetCrew]=useState(DAMASIO_CREWS[1]);
  const[targetDay,setTargetDay]=useState("Tuesday");
  const[filter,setFilter]=useState("all");
  const[optimizing,setOptimizing]=useState(false);
  const[startAddress,setStartAddress]=useState("");
  const today=new Date().toISOString().slice(0,10);

  function refresh(){setLeads(getLeads())}
  useEffect(()=>{seedDemoLeads();refresh();const on=()=>refresh();window.addEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.addEventListener("storage",on);const t=setInterval(refresh,2500);return()=>{window.removeEventListener(DAMASIO_SYNC_EVENT,on as EventListener);window.removeEventListener("storage",on);clearInterval(t)}},[]);
  useEffect(()=>{const params=new URLSearchParams(window.location.search);const q=params.get("day");const c=params.get("crew");if(q&&DAMASIO_WEEK_DAYS.includes(q)){setDay(q);setTargetDay(q);setDraft([])}if(c&&DAMASIO_CREWS.includes(c)){setCrew(c);setTargetCrew(c);setDraft([])}},[]);
  useEffect(()=>{setStartAddress(localStorage.getItem(`damasio_os_route_start_${crew}_${day}`)||"")},[crew,day]);

  const current=useMemo(()=>leads.filter(l=>l.assignedCrew===crew&&l.serviceDay===day).filter(l=>filter==="all"?true:filter==="open"?l.status!=="completed":filter==="done"?l.status==="completed":filter==="pending"?l.status!=="completed"&&(l.nextVisitDate===today||l.scheduledDate===today):filter==="overdue"?calculateVisitStatus(l)==="overdue":true).sort((a,b)=>(a.routeOrder??9999)-(b.routeOrder??9999)||a.address.localeCompare(b.address)),[leads,crew,day,filter,today]);
  const todayByCrew=useMemo(()=>DAMASIO_CREWS.map(c=>({crew:c,total:leads.filter(l=>l.assignedCrew===c&&l.serviceDay===day).length,open:leads.filter(l=>l.assignedCrew===c&&l.serviceDay===day&&l.status!=="completed").length})),[leads,day]);
  const dayCounts=useMemo(()=>DAMASIO_WEEK_DAYS.map(d=>({day:d,count:leads.filter(l=>l.serviceDay===d&&l.assignedCrew).length,overdue:leads.filter(l=>l.serviceDay===d&&calculateVisitStatus(l)==="overdue").length})),[leads]);
  const regions=[...new Set(current.map(h=>getRegionFromAddress(h.address)))];
  const allSelected=current.length>0&&current.every(l=>selected.includes(l.id));

  function toggle(id:string){setSelected(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id])}
  function toggleAll(){setSelected(allSelected?selected.filter(id=>!current.some(l=>l.id===id)):[...Array.from(new Set([...selected,...current.map(l=>l.id)]))])}
  async function generate(){
    const source=(selected.length?current.filter(home=>selected.includes(home.id)):current).filter(home=>home.status!=="completed");
    if(source.length<2){setMessage("Select at least two open houses to optimize.");return}
    if(!startAddress.trim()){setMessage("Enter the crew's starting address before optimizing the route.");return}
    setOptimizing(true);setMessage("Calculating the fastest driving sequence from the starting address...");
    try{
      localStorage.setItem(`damasio_os_route_start_${crew}_${day}`,startAddress.trim());
      const [startResponse,mappedValues]=await Promise.all([fetch(`/api/map/geocode?address=${encodeURIComponent(startAddress.trim())}`,{cache:"no-store"}),Promise.all(source.map(async home=>{if(Number.isFinite(home.latitude)&&Number.isFinite(home.longitude))return home;const response=await fetch(`/api/map/geocode?address=${encodeURIComponent(home.address)}`,{cache:"no-store"});if(!response.ok)return null;const point=await response.json() as {latitude:number;longitude:number};updateLead(home.id,point);return{...home,...point}}))]);
      if(!startResponse.ok)throw new Error("Starting address could not be found. Include the city or postal code.");
      const start=await startResponse.json() as {latitude:number;longitude:number};
      const mapped=mappedValues.filter((home):home is Lead=>Boolean(home));
      if(mapped.length<2){setMessage("Not enough properties could be mapped. Complete their addresses first.");return}
      const response=await fetch("/api/map/optimize",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({start:[start.longitude,start.latitude],coordinates:mapped.map(home=>[home.longitude,home.latitude])})});
      if(!response.ok)throw new Error("Route optimization is temporarily unavailable.");
      const result=await response.json() as {order:number[];provider:string};const ordered=result.order.map(index=>mapped[index]);setDraft(saveSmartRouteDraft(crew,day,ordered.map(home=>home.id)));setMessage(`Smart draft created using ${result.provider}. Review it and publish only if you accept the sequence.`);refresh();
    }catch(error){setMessage(error instanceof Error?error.message:"Could not generate the smart route.")}finally{setOptimizing(false)}
  }
  function moveDraft(index:number,direction:-1|1){const target=index+direction;if(target<0||target>=draft.length)return;const next=[...draft];[next[index],next[target]]=[next[target],next[index]];setDraft(saveSmartRouteDraft(crew,day,next.map(home=>home.id)));}
  function publish(){publishAiRoute(crew,day);setMessage("Route published. Employee route updates immediately.");setDraft([]);refresh()}
  function undo(){undoAiRoute(crew,day);setDraft([]);setMessage("AI draft removed. Manual route control restored.")}
  function moveSelected(){selected.forEach(id=>updateHomeSchedule(id,targetDay,(leads.find(l=>l.id===id)?.serviceFrequency)||"weekly"));moveHomesToCrew(selected,targetCrew);setMessage(`${selected.length} home(s) moved to ${targetCrew} on ${targetDay}. Employee route updated.`);setSelected([]);refresh()}

  return <AdminShell active="Routes">
    <div className="neo-hero route-hero"><div><span className="eyebrow">V42.8.1 Route Manager</span><h1>Routes linked to each Employee/Crew.</h1><p>Admin controls day, crew, route order, next cut and pending houses. Employees only see their own route for the selected day.</p></div><div className="route-controls"><CompactFilter><label><input type="radio" checked={filter==="all"} onChange={()=>setFilter("all")}/> All</label><label><input type="radio" checked={filter==="open"} onChange={()=>setFilter("open")}/> Open</label><label><input type="radio" checked={filter==="done"} onChange={()=>setFilter("done")}/> Done</label><label><input type="radio" checked={filter==="pending"} onChange={()=>setFilter("pending")}/> Pending today</label><label><input type="radio" checked={filter==="overdue"} onChange={()=>setFilter("overdue")}/> Overdue</label></CompactFilter><select className="input" value={crew} onChange={e=>{setCrew(e.target.value);setTargetCrew(e.target.value);setSelected([]);setDraft([])}}>{DAMASIO_CREWS.map(c=><option key={c}>{c}</option>)}</select><select className="input" value={day} onChange={e=>{setDay(e.target.value);setTargetDay(e.target.value);setSelected([]);setDraft([])}}>{DAMASIO_WEEK_DAYS.map(d=><option key={d}>{d}</option>)}</select><Link className="btn btn-outline" href="/admin/schedule">Create Route</Link><Link className="btn btn-primary" href={`/employee/route?crew=${encodeURIComponent(crew)}&day=${encodeURIComponent(day)}`}>Open Employee Route</Link></div></div>

    <section className="day-manager-strip">{dayCounts.map(d=><button key={d.day} className={day===d.day?"day-manager-card active":"day-manager-card"} onClick={()=>{setDay(d.day);setTargetDay(d.day);setSelected([]);setDraft([])}}><strong>{d.day}</strong><span>{d.count} homes</span>{d.overdue>0&&<em>{d.overdue} overdue</em>}</button>)}</section>

    <section className="crew-route-grid">{todayByCrew.map(c=><button key={c.crew} className={crew===c.crew?"crew-route-card active":"crew-route-card"} onClick={()=>{setCrew(c.crew);setTargetCrew(c.crew);setSelected([]);setDraft([])}}><strong>{c.crew}</strong><span>{c.open}/{c.total} open</span><Link href={`/employee/route?crew=${encodeURIComponent(c.crew)}&day=${encodeURIComponent(day)}`}>View employee route</Link></button>)}</section>

    <section className="card bulk-assign-card route-manager-actions"><div><div className="mini-label">Move selected homes</div><strong>{selected.length} selected</strong><p>Use this when Admin needs to reorganize the day or move houses between Employees/Crews.</p></div><div className="field"><label>Move to Crew</label><select className="input" value={targetCrew} onChange={e=>setTargetCrew(e.target.value)}>{DAMASIO_CREWS.map(c=><option key={c}>{c}</option>)}</select></div><div className="field"><label>Move to Day</label><select className="input" value={targetDay} onChange={e=>setTargetDay(e.target.value)}>{DAMASIO_WEEK_DAYS.map(d=><option key={d}>{d}</option>)}</select></div><button className="btn btn-outline" onClick={toggleAll}>{allSelected?"Unselect route":"Select route"}</button><button className="btn btn-primary" disabled={selected.length===0} onClick={moveSelected}>Move Selected</button></section>

    <section className="route-workbench">
      <div className="card ops-panel"><div className="table-head"><div><h2>{crew} — {day}</h2><p className="section-intro">This is the exact route the Employee/Crew receives. Houses not completed remain pending/overdue until finished.</p></div><span className="pill">{current.length} homes · {filter}</span></div>{regions.map(r=><div key={r} className="region-block"><h3>{r}</h3>{current.filter(h=>getRegionFromAddress(h.address)===r).map((h,i)=>{const status=calculateVisitStatus(h);return <div className="route-item route-item-selectable" key={h.id}><input type="checkbox" checked={selected.includes(h.id)} onChange={()=>toggle(h.id)}/><span>{i+1}</span><div><strong><i className={`dot ${status}`}></i> {h.name}</strong><p>{h.address}</p><p>{h.service} • {h.serviceFrequency||"weekly"} • Next: {h.nextVisitDate||h.scheduledDate||"Not set"}</p></div><small>{visitLabel(status)}</small><a className="map-link" href={mapsHref(h.address)} onClick={(e)=>openNativeDirections(h.address,e)} target="_blank" rel="noopener noreferrer">Get directions</a></div>})}</div>)}{current.length===0&&<p className="section-intro" style={{padding:22}}>No homes assigned to this crew/day yet. Open Dispatch, select houses, choose date/crew and click Create Route.</p>}</div>
      <div className="card ai-panel"><div className="ai-glow">AI</div><h2>Draft Schedule</h2><p>Generate the fastest driving order from the crew&apos;s starting point. Nothing goes to employees until you publish.</p><div className="field"><label>Starting address</label><AddressAutocomplete value={startAddress} onChange={setStartAddress} placeholder="Office, depot or crew starting address" ariaLabel="Starting address"/></div><div className="stacked-actions"><button className="btn btn-primary" onClick={generate} disabled={optimizing}>{optimizing?"Optimizing...":"Generate Smart Route"}</button><button className="btn btn-outline" onClick={publish} disabled={!draft.length}>Publish Schedule</button><button className="btn btn-danger" onClick={undo}>Undo AI Route</button></div><div className="rule-list"><span>✅ Starts from the address above</span><span>✅ Uses real driving time</span><span>✅ Admin approval required</span><span>✅ Employee route linked by crew/day</span></div>{message&&<div className="payment-message">{message}</div>}</div>
    </section>
    {draft.length>0&&<section className="card table-card" style={{marginTop:20}}><div className="table-head"><div><h2>AI Draft Preview</h2><p className="section-intro">Review this order before publishing.</p></div><span className="pill">Draft only</span></div><div className="route-list-preview">{draft.map((h,i)=><div className="route-item large" key={h.id}><span>{i+1}</span><div><strong>{h.name}</strong><p>{h.address} • {getRegionFromAddress(h.address)}</p></div><small>{h.service}</small></div>)}</div></section>}
    {draft.length>0&&<section className="card smart-route-review"><div className="table-head"><div><h2>Review and adjust proposed order</h2><p className="section-intro">The proposal is not visible to employees until Admin publishes it. Use the arrows to make any manual correction.</p></div><button className="btn btn-primary" onClick={publish}>Accept & Publish Route</button></div>{draft.map((home,index)=><div className="smart-route-review-row" key={home.id}><strong>{index+1}</strong><div><b>{home.name}</b><span>{home.address}</span></div><div className="route-order-buttons"><button disabled={index===0} onClick={()=>moveDraft(index,-1)}>↑</button><button disabled={index===draft.length-1} onClick={()=>moveDraft(index,1)}>↓</button></div></div>)}</section>}
    {optimizing&&<div className="payment-message">Mapping properties and comparing driving times…</div>}
  </AdminShell>
}
