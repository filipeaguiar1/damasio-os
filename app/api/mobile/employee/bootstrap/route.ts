import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function adminClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Employee account synchronization is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function authClient(token:string){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!key)throw new Error("Employee authentication is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
}

function companyFilter(companyId:string){
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

export async function POST(request:NextRequest){
  try{
    const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
    if(!token)return NextResponse.json({error:"Sign in as Employee."},{status:401});
    const auth=authClient(token);
    const{data:userResult,error:userError}=await auth.auth.getUser(token);
    const user=userResult.user;
    if(userError||!user)return NextResponse.json({error:"Your login expired. Sign in again."},{status:401});
    const{data:profile,error:profileError}=await auth.from("profiles").select("id,role,active,company_id,organization_id,email,full_name").eq("id",user.id).maybeSingle();
    if(profileError||!profile?.active||profile.role!=="employee")return NextResponse.json({error:"This login is not an active Employee account."},{status:403});
    const companyId=String(profile.company_id||profile.organization_id||"");
    if(!companyId)return NextResponse.json({error:"This Employee account is not linked to a company."},{status:403});

    const client=adminClient();
    const select="id,profile_id,company_id,organization_id,full_name,email,crew_id,address_line1,route_start_address,active,created_at,crews(id,name)";
    const employeeRows=await client.from("employees")
      .select(select)
      .eq("profile_id",user.id)
      .eq("active",true)
      .or(companyFilter(companyId))
      .order("created_at",{ascending:false})
      .limit(20);
    if(employeeRows.error)throw new Error(employeeRows.error.message);
    let employee=(employeeRows.data||[]).find((candidate:any)=>Boolean(candidate.crew_id))||employeeRows.data?.[0]||null;

    if(!employee&&user.email){
      const result=await client.from("employees")
        .select(select)
        .ilike("email",user.email.trim())
        .eq("active",true)
        .or(companyFilter(companyId))
        .order("created_at",{ascending:true})
        .limit(2);
      if(result.error)throw new Error(result.error.message);
      employee=(result.data||[]).find((candidate:any)=>Boolean(candidate.crew_id))||result.data?.[0]||null;
      if(employee){
        const{data:linked,error:linkError}=await client.from("employees")
          .update({profile_id:user.id,email:user.email.trim().toLowerCase()})
          .eq("id",employee.id)
          .or(companyFilter(companyId))
          .select(select)
          .single();
        if(linkError)throw new Error(linkError.message);
        employee=linked;
      }
    }

    if(!employee)return NextResponse.json({error:"No active Employee record matches this login email. Ask the company Admin to connect the Employee account."},{status:404});
    if(String(employee.company_id||employee.organization_id||"")!==companyId){
      return NextResponse.json({error:"The Employee record does not belong to this company."},{status:403});
    }

    const normalizedEmail=(user.email||employee.email||profile.email||"").trim().toLowerCase();
    if(normalizedEmail){
      const [profileSync,employeeSync]=await Promise.all([
        client.from("profiles")
          .update({email:normalizedEmail,company_id:companyId})
          .eq("id",user.id)
          .or(companyFilter(companyId)),
        client.from("employees")
          .update({email:normalizedEmail,profile_id:user.id})
          .eq("id",employee.id)
          .or(companyFilter(companyId)),
      ]);
      if(profileSync.error)throw new Error(profileSync.error.message);
      if(employeeSync.error)throw new Error(employeeSync.error.message);
    }

    const today=new Date().toISOString().slice(0,10);
    // Keep tenant ownership in the database predicate, then resolve Employee/crew membership
    // from that already company-bounded result. Two sequential PostgREST .or() filters on the
    // same request can serialize as an invalid/ambiguous query and caused bootstrap HTTP 400.
    const companyVisits=await client.from("visits")
      .select("id,assigned_employee_id,crew_id")
      .eq("scheduled_date",today)
      .not("status","in","(cancelled,missed)")
      .or(companyFilter(companyId));
    if(companyVisits.error)throw new Error(companyVisits.error.message);
    const todayVisitCount=(companyVisits.data||[]).filter((visit:any)=>
      String(visit.assigned_employee_id||"")===String(employee.id)
      || (employee.crew_id&&String(visit.crew_id||"")===String(employee.crew_id)),
    ).length;

    return NextResponse.json({
      employee:{
        id:employee.id,
        profileId:user.id,
        crewId:employee.crew_id||null,
        crewName:(Array.isArray(employee.crews)?employee.crews[0]:employee.crews)?.name||null,
        name:employee.full_name,
        email:normalizedEmail,
        routeStartAddress:employee.route_start_address||employee.address_line1||null,
      },
      todayVisitCount,
    });
  }catch(error){
    console.error("mobile-employee-bootstrap",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Employee account synchronization failed."},{status:400});
  }
}
