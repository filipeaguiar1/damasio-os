import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type EmployeeRow = {
  id: string;
  profile_id: string | null;
  company_id: string | null;
  organization_id: string | null;
  full_name: string | null;
  email: string | null;
  crew_id: string | null;
  active: boolean;
};

function serviceClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Employee route service is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function userClient(token:string){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)throw new Error("Employee authentication is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
}

function first<T>(value:T|T[]|null|undefined):T|null{return Array.isArray(value)?value[0]||null:value||null}

async function requireEmployee(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)throw new Error("Sign in as Employee.");
  const auth=userClient(token);
  const{data:userResult,error:userError}=await auth.auth.getUser(token);
  const user=userResult.user;
  if(userError||!user)throw new Error("Your login expired. Sign in again.");
  const{data:profile,error:profileError}=await auth.from("profiles").select("id,role,active,company_id,organization_id,email,full_name").eq("id",user.id).maybeSingle();
  if(profileError||!profile?.active||profile.role!=="employee")throw new Error("This login is not an active Employee account.");

  const client=serviceClient();
  const columns="id,profile_id,company_id,organization_id,full_name,email,crew_id,active";
  let{data:employee,error:employeeError}=await client.from("employees").select(columns).eq("profile_id",user.id).eq("active",true).maybeSingle();
  if(employeeError)throw new Error(employeeError.message);

  if(!employee&&user.email){
    const companyId=profile.company_id||profile.organization_id||null;
    let query=client.from("employees").select(columns).ilike("email",user.email.trim()).eq("active",true);
    if(companyId)query=query.or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
    const result=await query.order("created_at",{ascending:true}).limit(2);
    if(result.error)throw new Error(result.error.message);
    employee=result.data?.[0]||null;
    if(employee){
      const normalized=user.email.trim().toLowerCase();
      const{data:linked,error:linkError}=await client.from("employees").update({profile_id:user.id,email:normalized}).eq("id",employee.id).select(columns).single();
      if(linkError)throw new Error(linkError.message);
      employee=linked;
      await client.from("profiles").update({email:normalized,company_id:linked.company_id||linked.organization_id||companyId}).eq("id",user.id);
    }
  }

  if(!employee)throw new Error("No active Employee record matches this login. Ask the company Admin to connect the Employee account.");
  return{client,employee:employee as EmployeeRow,userId:user.id};
}

async function loadRoute(client:ReturnType<typeof serviceClient>,employee:EmployeeRow,date:string){
  let query=client
    .from("visits")
    .select("id,route_id,property_id,route_order,status,scheduled_date,started_at,finished_at,duration_seconds,employee_notes,properties(address_line1,city,province,postal_code,latitude,longitude),customers(full_name),jobs(service_name)")
    .eq("scheduled_date",date)
    .not("status","in","(cancelled,missed)")
    .order("route_order",{ascending:true,nullsFirst:false});
  if(employee.crew_id)query=query.or(`assigned_employee_id.eq.${employee.id},crew_id.eq.${employee.crew_id}`);
  else query=query.eq("assigned_employee_id",employee.id);
  const{data,error}=await query;
  if(error)throw new Error(error.message);
  const rows=(data||[]) as any[];
  return{
    employee:{id:employee.id,name:employee.full_name||"Employee",crewId:employee.crew_id||null,email:employee.email||null},
    routeId:rows.find(row=>row.route_id)?.route_id||null,
    stops:rows.map(row=>{
      const property=first(row.properties as any);
      const customer=first(row.customers as any);
      const job=first(row.jobs as any);
      return{
        visitId:row.id,
        propertyId:row.property_id,
        addressLine1:property?.address_line1||"",
        city:property?.city||"",
        province:property?.province||"",
        postalCode:property?.postal_code||"",
        latitude:property?.latitude??null,
        longitude:property?.longitude??null,
        routeOrder:row.route_order,
        status:row.status,
        customerName:customer?.full_name||"Customer",
        serviceName:job?.service_name||"Property Service",
        scheduledDate:row.scheduled_date,
        startedAt:row.started_at||null,
        finishedAt:row.finished_at||null,
        durationSeconds:row.duration_seconds??null,
        employeeNotes:row.employee_notes||null,
      };
    }),
  };
}

export async function GET(request:NextRequest){
  try{
    const{client,employee}=await requireEmployee(request);
    const date=request.nextUrl.searchParams.get("date")||new Date().toISOString().slice(0,10);
    return NextResponse.json(await loadRoute(client,employee,date));
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Employee route could not be loaded."},{status:400});
  }
}

export async function PATCH(request:NextRequest){
  try{
    const{client,employee}=await requireEmployee(request);
    const body=await request.json() as{visitId?:string;action?:"start"|"done"|"note";note?:string};
    if(!body.visitId)throw new Error("Choose a visit first.");
    const{data:visit,error:visitError}=await client.from("visits").select("id,assigned_employee_id,crew_id,status,started_at,scheduled_date").eq("id",body.visitId).maybeSingle();
    if(visitError||!visit)throw new Error(visitError?.message||"Visit not found.");
    const allowed=visit.assigned_employee_id===employee.id||Boolean(employee.crew_id&&visit.crew_id===employee.crew_id);
    if(!allowed)throw new Error("This visit is not assigned to this Employee or crew.");
    const now=new Date();
    const patch:Record<string,unknown>={};
    if(body.action==="start"){
      patch.status="in_progress";
      patch.started_at=visit.started_at||now.toISOString();
      patch.finished_at=null;
    }else if(body.action==="done"){
      const startedAt=visit.started_at?new Date(visit.started_at).getTime():now.getTime();
      patch.status="completed";
      patch.started_at=visit.started_at||now.toISOString();
      patch.finished_at=now.toISOString();
      patch.duration_seconds=Math.max(0,Math.round((now.getTime()-startedAt)/1000));
    }else if(body.action==="note"){
      patch.employee_notes=String(body.note||"").trim()||null;
    }else throw new Error("Choose a valid visit action.");
    const{data:updated,error:updateError}=await client.from("visits").update(patch).eq("id",visit.id).select("id,status,started_at,finished_at,duration_seconds,employee_notes").single();
    if(updateError)throw new Error(updateError.message);
    return NextResponse.json({visit:updated});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Visit could not be updated."},{status:400});
  }
}
