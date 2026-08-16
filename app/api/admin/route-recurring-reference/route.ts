import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function serviceClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error("Recurring route reference is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) as any;
}
function userClient(token:string){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key) throw new Error("Supabase browser access is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}}) as any;
}
function companyFilter(companyId:string){return `company_id.eq.${companyId},organization_id.eq.${companyId}`;}
async function requireAdmin(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) throw new Error("Sign in as the company Admin.");
  const service=serviceClient();
  const {data:auth,error:authError}=await service.auth.getUser(token);
  if(authError||!auth.user) throw new Error("Your Admin session expired. Sign in again.");
  const {data:profile,error}=await service.from("profiles").select("id,role,active,company_id,organization_id").eq("id",auth.user.id).single();
  if(error||!profile?.active||!["admin","manager"].includes(profile.role)) throw new Error("Only an active company Admin can apply a recurring route reference.");
  const companyId=String(profile.company_id||profile.organization_id||"");
  if(!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return {service,user:userClient(token),companyId,profileId:String(profile.id)};
}
function dateParts(value:string){const [year,month,day]=value.split("-").map(Number);return {year,month,day};}
function dateKey(year:number,month:number,day:number){return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;}
function addDays(value:string,days:number){const {year,month,day}=dateParts(value);const date=new Date(Date.UTC(year,month-1,day+days,17));return dateKey(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());}
function addMonths(value:string,months:number){const {year,month,day}=dateParts(value);const first=new Date(Date.UTC(year,month-1+months,1,17));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,17)).getUTCDate();return dateKey(first.getUTCFullYear(),first.getUTCMonth()+1,Math.min(day,last));}
function normalizeFrequency(job:any){
  const value=String(job.frequency||job.service_frequency||"one_time").trim().toLowerCase().replaceAll("-","_").replaceAll(" ","_");
  if(["weekly","week","every_week"].includes(value)) return "weekly";
  if(["biweekly","bi_weekly","every_2_weeks","every_two_weeks","fortnightly"].includes(value)) return "biweekly";
  if(["monthly","month","every_month"].includes(value)) return "monthly";
  return "one_time";
}
function futureDates(anchor:string,frequency:string,horizon:string,contractStarts?:string|null,contractEnds?:string|null){
  const dates:string[]=[];
  for(let index=1;index<=60;index+=1){
    const next=frequency==="weekly"?addDays(anchor,index*7):frequency==="biweekly"?addDays(anchor,index*14):frequency==="monthly"?addMonths(anchor,index):"";
    if(!next||next>horizon) break;
    if(contractEnds&&next>contractEnds) break;
    if(contractStarts&&next<contractStarts) continue;
    dates.push(next);
  }
  return dates;
}

export async function POST(request:NextRequest){
  try{
    const {service,user,companyId,profileId}=await requireAdmin(request);
    const body=await request.json() as {employeeId?:string;crewId?:string;routeDate?:string;horizonWeeks?:number};
    const employeeId=String(body.employeeId||"");
    const crewId=String(body.crewId||"");
    const routeDate=String(body.routeDate||"");
    const horizonWeeks=Math.max(1,Math.min(52,Math.trunc(Number(body.horizonWeeks||12))));
    if(!employeeId||!crewId||!/^\d{4}-\d{2}-\d{2}$/.test(routeDate)) throw new Error("Employee, Crew and a valid published reference date are required.");

    const routeResult=await service.from("routes").select("id,crew_id,route_date").eq("crew_id",crewId).eq("route_date",routeDate).or(companyFilter(companyId)).limit(2);
    if(routeResult.error) throw new Error(routeResult.error.message);
    const routes=routeResult.data||[];
    if(routes.length!==1) throw new Error(routes.length?"More than one route exists for this Employee/date. Repair the canonical route before applying recurrence.":"Publish and review this Employee/date route before using it as a recurring reference.");
    const routeId=String(routes[0].id);

    const stopsResult=await service.from("route_stops").select("visit_id,position").eq("route_id",routeId).order("position",{ascending:true});
    if(stopsResult.error) throw new Error(stopsResult.error.message);
    const stops=stopsResult.data||[];
    if(!stops.length) throw new Error("The reference route has no canonical route stops.");
    const visitIds=stops.map((row:any)=>String(row.visit_id));
    const visitsResult=await service.from("visits").select("id,job_id,crew_id,assigned_employee_id,status").in("id",visitIds).or(companyFilter(companyId));
    if(visitsResult.error) throw new Error(visitsResult.error.message);
    const visitsById=new Map((visitsResult.data||[]).map((row:any)=>[String(row.id),row]));
    const orderedJobIds=stops.map((stop:any)=>String(visitsById.get(String(stop.visit_id))?.job_id||"")).filter(Boolean);
    if(orderedJobIds.length!==stops.length||new Set(orderedJobIds).size!==orderedJobIds.length) throw new Error("The reference route contains a missing or duplicate Job identity.");
    if((visitsResult.data||[]).some((row:any)=>String(row.crew_id||"")!==crewId)) throw new Error("The reference route contains a Visit owned by another Crew.");

    const jobsResult=await service.from("jobs").select("id,frequency,service_frequency,contract_starts_on,contract_ends_on,active").in("id",orderedJobIds).eq("active",true).or(companyFilter(companyId));
    if(jobsResult.error) throw new Error(jobsResult.error.message);
    const jobsById=new Map((jobsResult.data||[]).map((row:any)=>[String(row.id),row]));
    if(jobsById.size!==orderedJobIds.length) throw new Error("One or more reference Jobs are no longer active for this company.");

    const horizon=addDays(routeDate,horizonWeeks*7);
    const plan=new Map<string,string[]>();
    let recurringJobs=0;
    for(const jobId of orderedJobIds){
      const job=jobsById.get(jobId);
      const frequency=normalizeFrequency(job);
      if(frequency==="one_time") continue;
      recurringJobs+=1;
      for(const future of futureDates(routeDate,frequency,horizon,job.contract_starts_on,job.contract_ends_on)){
        const current=plan.get(future)||[];
        current.push(jobId);
        plan.set(future,current);
      }
    }
    if(!recurringJobs) throw new Error("This published route contains only one-time Jobs. Nothing should recur.");

    let createdVisits=0;
    let preservedVisits=0;
    const routeDates:string[]=[];
    for(const [futureDate,dueJobIds] of [...plan.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      const existingResult=await service.from("visits").select("id,job_id,route_id,crew_id,assigned_employee_id,status").eq("scheduled_date",futureDate).in("job_id",dueJobIds).neq("status","cancelled").or(companyFilter(companyId));
      if(existingResult.error) throw new Error(existingResult.error.message);
      const existingByJob=new Map((existingResult.data||[]).map((row:any)=>[String(row.job_id),row]));
      preservedVisits+=existingByJob.size;
      const missingDue=dueJobIds.filter(jobId=>!existingByJob.has(jobId));
      if(!missingDue.length) continue;

      let existingRouteJobIds:string[]=[];
      const existingRouteResult=await service.from("routes").select("id").eq("crew_id",crewId).eq("route_date",futureDate).or(companyFilter(companyId)).limit(2);
      if(existingRouteResult.error) throw new Error(existingRouteResult.error.message);
      if((existingRouteResult.data||[]).length>1) throw new Error(`More than one canonical route exists for ${futureDate}. Recurrence stopped before modifying that date.`);
      const existingRouteId=String(existingRouteResult.data?.[0]?.id||"");
      if(existingRouteId){
        const existingStops=await service.from("route_stops").select("visit_id,position").eq("route_id",existingRouteId).order("position",{ascending:true});
        if(existingStops.error) throw new Error(existingStops.error.message);
        const ids=(existingStops.data||[]).map((row:any)=>String(row.visit_id));
        if(ids.length){
          const rows=await service.from("visits").select("id,job_id,status").in("id",ids).neq("status","cancelled").or(companyFilter(companyId));
          if(rows.error) throw new Error(rows.error.message);
          const byId=new Map((rows.data||[]).map((row:any)=>[String(row.id),row]));
          existingRouteJobIds=ids.map(id=>String(byId.get(id)?.job_id||"")).filter(Boolean);
        }
      }

      const referencePosition=new Map(orderedJobIds.map((id,index)=>[id,index]));
      const combined=[...new Set([...existingRouteJobIds,...missingDue])].sort((left,right)=>{
        const l=referencePosition.has(left)?referencePosition.get(left)!:100000+existingRouteJobIds.indexOf(left);
        const r=referencePosition.has(right)?referencePosition.get(right)!:100000+existingRouteJobIds.indexOf(right);
        return l-r;
      });
      const published=await user.rpc("publish_canonical_route_daily_protected",{p_employee_id:employeeId,p_crew_id:crewId,p_route_date:futureDate,p_ordered_job_ids:combined,p_source_visit_ids:[]});
      if(published.error) throw new Error(`Recurring route ${futureDate} failed: ${published.error.message}`);
      const futureRouteId=String(published.data?.routeId||"");
      if(!futureRouteId) throw new Error(`Recurring route ${futureDate} returned no canonical route ID.`);

      const materialized=await service.from("visits").select("id,job_id,status").eq("route_id",futureRouteId).eq("scheduled_date",futureDate).neq("status","cancelled").or(companyFilter(companyId));
      if(materialized.error) throw new Error(materialized.error.message);
      const visitByJob=new Map((materialized.data||[]).map((row:any)=>[String(row.job_id),String(row.id)]));
      const orderedVisitIds=combined.map(jobId=>visitByJob.get(jobId)).filter(Boolean) as string[];
      if(orderedVisitIds.length!==combined.length) throw new Error(`Recurring route ${futureDate} did not materialize every requested Visit.`);
      const applied=await service.rpc("apply_canonical_route_order_v2_service",{p_route_id:futureRouteId,p_ordered_visit_ids:orderedVisitIds,p_origin_label:"Recurring route reference",p_origin_latitude:null,p_origin_longitude:null,p_expected_version:null,p_actor_profile_id:profileId,p_source:"admin_recurring_route_reference"});
      if(applied.error) throw new Error(`Recurring route order ${futureDate} failed: ${applied.error.message}`);
      createdVisits+=missingDue.length;
      routeDates.push(futureDate);
    }

    for(let index=0;index<orderedJobIds.length;index+=1){
      const jobId=orderedJobIds[index];
      const job=jobsById.get(jobId);
      if(normalizeFrequency(job)==="one_time") continue;
      const update=await service.from("jobs").update({recurrence_anchor_date:routeDate,default_route_order:index+1}).eq("id",jobId).or(companyFilter(companyId));
      if(update.error) throw new Error(update.error.message);
    }

    return NextResponse.json({saved:true,routeId,referenceDate:routeDate,horizonWeeks,recurringJobs,createdVisits,preservedVisits,routeDates});
  }catch(error){
    console.error("route-recurring-reference",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Recurring route reference failed."},{status:400});
  }
}
