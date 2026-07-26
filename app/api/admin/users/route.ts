import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic="force-dynamic";

const employeeSchema=z.object({
  fullName:z.string().trim().min(2).max(120),
  email:z.string().trim().toLowerCase().email().max(254),
  phone:z.string().trim().max(40).nullable().optional(),
  addressLine1:z.string().trim().max(240).nullable().optional(),
  city:z.string().trim().max(120).nullable().optional(),
  province:z.string().trim().max(40).nullable().optional(),
  postalCode:z.string().trim().max(20).nullable().optional(),
  routeStartAddress:z.string().trim().max(400).nullable().optional(),
  avatarUrl:z.string().trim().url().nullable().optional(),
  active:z.boolean().optional(),
});

type EmployeeRouteRow={id:string;profile_id:string|null;crew_id:string|null;full_name:string|null;active:boolean};

function serverClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Real employee administration is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) as any;
}

async function companyAdmin(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)throw new Error("Sign in as the company Admin.");
  const client=serverClient();
  const{data:auth,error:authError}=await client.auth.getUser(token);
  if(authError||!auth.user)throw new Error("Your login expired. Sign in again.");
  const{data:profile,error}=await client.from("profiles").select("id,role,company_id,organization_id,active").eq("id",auth.user.id).single();
  if(error||!profile?.active||profile.role!=="admin")throw new Error("Only the company Admin can manage employees.");
  const companyId=profile.company_id||profile.organization_id;
  if(!companyId)throw new Error("Your Admin profile is not linked to a company.");
  return{client,companyId};
}

function failure(error:unknown,status=400){return NextResponse.json({error:error instanceof Error?error.message:"Employee operation failed."},{status})}

function profilePayload(body:z.infer<typeof employeeSchema>){
  return{
    full_name:body.fullName,
    email:body.email,
    phone:body.phone||null,
    avatar_url:body.avatarUrl||null,
    address_line1:body.addressLine1||null,
    city:body.city||null,
    province:body.province||"ON",
    postal_code:body.postalCode||null,
    route_start_address:body.routeStartAddress||body.addressLine1||null,
    ...(typeof body.active==="boolean"?{active:body.active}:{}),
  };
}

async function ensureIndividualRouteTeams(client:any,companyId:string):Promise<EmployeeRouteRow[]>{
  const{data:rows,error}=await client.from("employees").select("id,profile_id,crew_id,full_name,active").eq("company_id",companyId);
  if(error)throw new Error(error.message);
  const employees=(rows||[]) as EmployeeRouteRow[];
  for(const employee of employees){
    if(employee.crew_id||!employee.active)continue;
    const{data:crew,error:crewError}=await client.from("crews").insert({company_id:companyId,organization_id:companyId,name:employee.full_name||"Employee route",active:true}).select("id").single();
    if(crewError)throw new Error(crewError.message);
    const{error:updateError}=await client.from("employees").update({crew_id:crew.id}).eq("id",employee.id).eq("company_id",companyId);
    if(updateError)throw new Error(updateError.message);
    employee.crew_id=crew.id;
  }
  return employees;
}

export async function GET(request:NextRequest){
  try{
    const{client,companyId}=await companyAdmin(request);
    const employeeRows=await ensureIndividualRouteTeams(client,companyId);
    const byProfile=new Map<string,EmployeeRouteRow>();
    for(const row of employeeRows)if(row.profile_id)byProfile.set(row.profile_id,row);
    const{data,error}=await client.from("profiles").select("id,full_name,email,phone,active,created_at,avatar_url,address_line1,city,province,postal_code,route_start_address,invite_status").eq("role","employee").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).order("created_at",{ascending:false});
    if(error)throw new Error(error.message);
    return NextResponse.json({users:(data||[]).map((profile:any)=>({...profile,employee_id:byProfile.get(profile.id)?.id||null,crew_id:byProfile.get(profile.id)?.crew_id||null}))});
  }catch(error){return failure(error,401)}
}

export async function POST(request:NextRequest){
  let createdUserId="";
  try{
    const{client,companyId}=await companyAdmin(request);
    const body=employeeSchema.parse(await request.json());
    const siteUrl=String(process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin).replace(/\/$/,"");
    const{data:invite,error:inviteError}=await client.auth.admin.inviteUserByEmail(body.email,{redirectTo:`${siteUrl}/auth/complete?role=employee`,data:{full_name:body.fullName,role:"employee",company_id:companyId}});
    if(inviteError||!invite.user)throw new Error(inviteError?.message||"The employee invitation could not be created.");
    createdUserId=invite.user.id;
    const base=profilePayload(body);
    const profile={id:createdUserId,organization_id:companyId,company_id:companyId,role:"employee",...base,active:true,invite_status:"sent"};
    const{error:profileError}=await client.from("profiles").upsert(profile,{onConflict:"id"});
    if(profileError)throw new Error(profileError.message);
    const{data:crew,error:crewError}=await client.from("crews").insert({organization_id:companyId,company_id:companyId,name:body.fullName,active:true}).select("id").single();
    if(crewError)throw new Error(crewError.message);
    const employee={organization_id:companyId,company_id:companyId,profile_id:createdUserId,crew_id:crew.id,...base,active:true,invite_status:"sent"};
    const{error:employeeError}=await client.from("employees").insert(employee);
    if(employeeError)throw new Error(employeeError.message);
    return NextResponse.json({user:{...profile,crew_id:crew.id},message:`Invitation sent to ${body.email}.`},{status:201});
  }catch(error){if(createdUserId)try{await serverClient().auth.admin.deleteUser(createdUserId)}catch{}return failure(error)}
}

export async function PATCH(request:NextRequest){
  try{
    const{client,companyId}=await companyAdmin(request);
    const raw=await request.json();
    const id=String(raw.id||"");
    if(!id)throw new Error("Choose an employee.");
    const body=employeeSchema.parse(raw);
    const updates=profilePayload(body);
    const{data,error}=await client.from("profiles").update(updates).eq("id",id).eq("role","employee").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).select("id,full_name,email,phone,active,created_at,avatar_url,address_line1,city,province,postal_code,route_start_address,invite_status").single();
    if(error||!data)throw new Error(error?.message||"Employee not found in this company.");
    const{error:employeeError}=await client.from("employees").update({...updates}).eq("profile_id",id).eq("company_id",companyId);
    if(employeeError)throw new Error(employeeError.message);
    await client.from("crews").update({name:data.full_name,active:data.active}).in("id",(await client.from("employees").select("crew_id").eq("profile_id",id).eq("company_id",companyId)).data?.map((row:any)=>row.crew_id).filter(Boolean)||[]);
    const{error:authError}=await client.auth.admin.updateUserById(id,{email:body.email,user_metadata:{full_name:body.fullName,role:"employee",company_id:companyId}});
    if(authError)throw new Error(authError.message);
    return NextResponse.json({user:data,message:`Profile saved for ${data.full_name}.`});
  }catch(error){return failure(error)}
}

export async function DELETE(request:NextRequest){
  try{
    const{client,companyId}=await companyAdmin(request);
    const body=await request.json() as{id?:string};
    const id=String(body.id||"");
    if(!id)throw new Error("Choose an employee.");
    const{data:profile,error}=await client.from("profiles").select("id,full_name").eq("id",id).eq("role","employee").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).single();
    if(error||!profile)throw new Error("Employee not found in this company.");
    const{data:employeeRows}=await client.from("employees").select("crew_id").eq("profile_id",id).eq("company_id",companyId);
    await client.from("employees").update({active:false,profile_id:null}).eq("profile_id",id).eq("company_id",companyId);
    const crewIds=(employeeRows||[]).map((row:any)=>row.crew_id).filter(Boolean);
    if(crewIds.length)await client.from("crews").update({active:false}).in("id",crewIds).eq("company_id",companyId);
    const{error:authError}=await client.auth.admin.deleteUser(id);
    if(authError&&!authError.message.toLowerCase().includes("not found"))throw new Error(authError.message);
    return NextResponse.json({id,message:`${profile.full_name} was removed. Historical visits remain preserved.`});
  }catch(error){return failure(error)}
}