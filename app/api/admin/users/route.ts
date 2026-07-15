import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";
type UserRole="manager"|"employee"|"customer";

function serverClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Real user administration is not configured on the server.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function companyAdmin(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)throw new Error("Sign in as the company Admin.");
  const client=serverClient();
  const{data:auth,error:authError}=await client.auth.getUser(token);
  if(authError||!auth.user)throw new Error("Your login expired. Sign in again.");
  const{data:profile,error}=await client.from("profiles").select("id,role,company_id,organization_id,active").eq("id",auth.user.id).single();
  if(error||!profile?.active||profile.role!=="admin")throw new Error("Only the company Admin can manage real users.");
  const companyId=profile.company_id||profile.organization_id;
  if(!companyId)throw new Error("Your Admin profile is not linked to a company.");
  return{client,companyId,adminId:auth.user.id};
}

function failure(error:unknown,status=400){return NextResponse.json({error:error instanceof Error?error.message:"User operation failed."},{status})}

export async function GET(request:NextRequest){
  try{
    const{client,companyId}=await companyAdmin(request);
    const{data,error}=await client.from("profiles").select("id,full_name,email,phone,role,active,created_at,manager_permissions").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).order("created_at",{ascending:false});
    if(error)throw new Error(error.message);
    const{data:crews}=await client.from("crews").select("id,name").eq("company_id",companyId).eq("active",true).order("name");
    return NextResponse.json({users:data||[],crews:crews||[]});
  }catch(error){return failure(error,401)}
}

export async function POST(request:NextRequest){
  let createdUserId="";
  try{
    const{client,companyId}=await companyAdmin(request);
    const body=await request.json() as {fullName?:string;email?:string;phone?:string;role?:UserRole;crewId?:string;managerPermissions?:Record<string,string>};
    const fullName=String(body.fullName||"").trim();
    const email=String(body.email||"").trim().toLowerCase();
    const phone=String(body.phone||"").trim();
    const role=body.role;
    if(fullName.length<2)throw new Error("Enter the person's full name.");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Enter a valid email address.");
    if(!role||!["manager","employee","customer"].includes(role))throw new Error("Choose Manager, Employee or Customer.");
    if(role==="employee"&&(!body.crewId||!(await client.from("crews").select("id").eq("id",body.crewId).eq("company_id",companyId).eq("active",true).maybeSingle()).data))throw new Error("Choose an active crew for this Employee.");
    const siteUrl=process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin;
    const{data:invite,error:inviteError}=await client.auth.admin.inviteUserByEmail(email,{redirectTo:`${siteUrl}/auth/complete`,data:{full_name:fullName,role,company_id:companyId}});
    if(inviteError||!invite.user)throw new Error(inviteError?.message||"The invitation could not be created.");
    createdUserId=invite.user.id;
    const profile={id:createdUserId,organization_id:companyId,company_id:companyId,role,full_name:fullName,email,phone:phone||null,active:true,manager_permissions:role==="manager"?(body.managerPermissions||{}):{}};
    const{error:profileError}=await client.from("profiles").upsert(profile,{onConflict:"id"});
    if(profileError)throw new Error(profileError.message);

    if(role==="employee"){
      const{data:existing}=await client.from("employees").select("id").eq("profile_id",createdUserId).maybeSingle();
      const employee={organization_id:companyId,company_id:companyId,profile_id:createdUserId,crew_id:body.crewId,full_name:fullName,email,phone:phone||null,active:true};
      const result=existing?.id?await client.from("employees").update(employee).eq("id",existing.id):await client.from("employees").insert(employee);
      if(result.error)throw new Error(result.error.message);
    }
    if(role==="customer"){
      const{data:existing}=await client.from("customers").select("id").eq("company_id",companyId).ilike("email",email).limit(1).maybeSingle();
      const result=existing?.id
        ?await client.from("customers").update({profile_id:createdUserId,full_name:fullName,phone:phone||null}).eq("id",existing.id)
        :await client.from("customers").insert({organization_id:companyId,company_id:companyId,profile_id:createdUserId,full_name:fullName,email,phone:phone||null});
      if(result.error)throw new Error(result.error.message);
    }
    return NextResponse.json({user:profile,message:`Invitation sent to ${email}.`},{status:201});
  }catch(error){
    if(createdUserId)try{await serverClient().auth.admin.deleteUser(createdUserId)}catch{}
    return failure(error);
  }
}

export async function PATCH(request:NextRequest){
  try{
    const{client,companyId,adminId}=await companyAdmin(request);
    const body=await request.json() as {id?:string;active?:boolean;managerPermissions?:Record<string,string>};
    const id=String(body.id||"");
    if(!id)throw new Error("Choose a user.");
    if(id===adminId&&body.active===false)throw new Error("The active Admin cannot deactivate their own account.");
    const updates:Record<string,unknown>={};
    if(typeof body.active==="boolean")updates.active=body.active;
    if(body.managerPermissions)updates.manager_permissions=body.managerPermissions;
    const{data,error}=await client.from("profiles").update(updates).eq("id",id).or(`company_id.eq.${companyId},organization_id.eq.${companyId}`).select("id,full_name,email,phone,role,active,created_at,manager_permissions").single();
    if(error||!data)throw new Error(error?.message||"User not found in this company.");
    if(typeof body.active==="boolean"){
      await client.from("employees").update({active:body.active}).eq("profile_id",id).eq("company_id",companyId);
    }
    return NextResponse.json({user:data});
  }catch(error){return failure(error)}
}
