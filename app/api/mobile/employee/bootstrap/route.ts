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

    const client=adminClient();
    const select="id,profile_id,company_id,organization_id,full_name,email,crew_id,active";
    let{data:employee,error:employeeError}=await client.from("employees").select(select).eq("profile_id",user.id).eq("active",true).maybeSingle();
    if(employeeError)throw new Error(employeeError.message);

    if(!employee&&user.email){
      const companyId=profile.company_id||profile.organization_id||null;
      let query=client.from("employees").select(select).ilike("email",user.email.trim()).eq("active",true);
      if(companyId)query=query.or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
      const result=await query.order("created_at",{ascending:true}).limit(2);
      if(result.error)throw new Error(result.error.message);
      employee=result.data?.[0]||null;
      if(employee){
        const{data:linked,error:linkError}=await client.from("employees").update({profile_id:user.id,email:user.email.trim().toLowerCase()}).eq("id",employee.id).select(select).single();
        if(linkError)throw new Error(linkError.message);
        employee=linked;
      }
    }

    if(!employee)return NextResponse.json({error:"No active Employee record matches this login email. Ask the company Admin to connect the Employee account."},{status:404});

    const normalizedEmail=(user.email||employee.email||profile.email||"").trim().toLowerCase();
    if(normalizedEmail){
      await Promise.all([
        client.from("profiles").update({email:normalizedEmail,company_id:employee.company_id||employee.organization_id||profile.company_id||profile.organization_id}).eq("id",user.id),
        client.from("employees").update({email:normalizedEmail,profile_id:user.id}).eq("id",employee.id),
      ]);
    }

    const today=new Date().toISOString().slice(0,10);
    let visitQuery=client.from("visits").select("id",{count:"exact",head:true}).eq("scheduled_date",today).not("status","in","(cancelled,missed)");
    if(employee.crew_id)visitQuery=visitQuery.or(`assigned_employee_id.eq.${employee.id},crew_id.eq.${employee.crew_id}`);
    else visitQuery=visitQuery.eq("assigned_employee_id",employee.id);
    const visitResult=await visitQuery;

    return NextResponse.json({
      employee:{id:employee.id,profileId:user.id,crewId:employee.crew_id||null,name:employee.full_name,email:normalizedEmail},
      todayVisitCount:visitResult.count||0,
    });
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Employee account synchronization failed."},{status:400});
  }
}
