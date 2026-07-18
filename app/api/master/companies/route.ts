import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";

function serverClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Master company creation is not configured on the server.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

async function requireMaster(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)throw new Error("Sign in as Master.");
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!anonKey)throw new Error("Master authentication is not configured on the server.");
  const authClient=createClient(url,anonKey,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{headers:{Authorization:`Bearer ${token}`}},
  });
  const{data:auth,error:authError}=await authClient.auth.getUser(token);
  if(authError||!auth.user)throw new Error("Your login expired. Sign in again.");
  const{data:profile,error:profileError}=await authClient.from("profiles").select("id,role,active").eq("id",auth.user.id).maybeSingle();
  if(profileError)throw new Error(`Master profile verification failed: ${profileError.message}`);
  if(!profile?.active||profile.role!=="master")throw new Error("Only an active Master can create a company.");
  const client=serverClient();
  return{client,masterId:auth.user.id};
}

function slugify(value:string){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function failure(error:unknown,status=400){return NextResponse.json({error:error instanceof Error?error.message:"Company creation failed."},{status})}
function inviteFailureMessage(message?:string){return message?.toLowerCase().includes("rate limit")?"Company saved, but Supabase reached its email sending limit. Wait for the limit to reset or configure custom SMTP, then resend the Admin invitation.":`Company saved, but the Admin invitation was not sent${message?`: ${message}`:"."}`}

export async function GET(request:NextRequest){
  try{
    const{client}=await requireMaster(request);
    const[companies,leads,requests,audit,admins,employees,customers]=await Promise.all([
      client.from("organizations").select("id,name,slug,active,plan_name,contact_email,created_at").order("created_at",{ascending:false}),
      client.from("lead_center").select("*").order("created_at",{ascending:false}),
      client.from("master_company_access_requests").select("*").order("created_at",{ascending:false}),
      client.from("master_audit_log").select("*").order("created_at",{ascending:false}).limit(100),
      client.from("profiles").select("id,company_id,organization_id,full_name,email,active").eq("role","admin"),
      client.from("employees").select("id,company_id,organization_id,full_name,email,active"),
      client.from("customers").select("id,company_id,organization_id,full_name,email"),
    ]);
    const failed=[companies,leads,requests,audit,admins,employees,customers].find(result=>result.error);
    if(failed?.error)throw new Error(failed.error.message);
    const members=[
      ...(admins.data||[]).map((row:any)=>({id:row.id,company_id:row.company_id||row.organization_id,kind:"admin",name:row.full_name,email:row.email,active:row.active})),
      ...(employees.data||[]).map((row:any)=>({id:row.id,company_id:row.company_id||row.organization_id,kind:"employee",name:row.full_name,email:row.email,active:row.active})),
      ...(customers.data||[]).map((row:any)=>({id:row.id,company_id:row.company_id||row.organization_id,kind:"customer",name:row.full_name,email:row.email,active:true})),
    ];
    return NextResponse.json({companies:companies.data||[],leads:leads.data||[],requests:requests.data||[],audit:audit.data||[],members});
  }catch(error){
    return failure(error,401);
  }
}

export async function PATCH(request:NextRequest){
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as{id?:string;active?:boolean};
    if(!body.id||typeof body.active!=="boolean")throw new Error("Company and status are required.");
    const{data,error}=await client.from("organizations").update({active:body.active,updated_at:new Date().toISOString()}).eq("id",body.id).select("id,name,slug,active,plan_name,contact_email,created_at").single();
    if(error||!data)throw new Error(error?.message||"Company could not be updated.");
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:data.id,action:body.active?"company.activated":"company.deactivated",entity_type:"organization",entity_id:data.id});
    return NextResponse.json({company:data});
  }catch(error){
    return failure(error);
  }
}

export async function PUT(request:NextRequest){
  let invitedUserId="";
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as{id?:string;adminName?:string};
    if(!body.id)throw new Error("Choose a company.");
    const{data:company,error:companyError}=await client.from("organizations").select("id,name,contact_email").eq("id",body.id).single();
    if(companyError||!company)throw new Error(companyError?.message||"Company not found.");
    if(!company.contact_email)throw new Error("Add a contact email before sending the Admin invitation.");
    const{data:existing}=await client.from("profiles").select("id").eq("role","admin").or(`company_id.eq.${company.id},organization_id.eq.${company.id}`).limit(1).maybeSingle();
    if(existing)throw new Error("This company already has an Admin account.");
    const adminName=String(body.adminName||`${company.name} Admin`).trim();
    const siteUrl=process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin;
    const{data:invite,error:inviteError}=await client.auth.admin.inviteUserByEmail(company.contact_email,{redirectTo:`${siteUrl}/auth/complete`,data:{full_name:adminName,role:"admin",company_id:company.id}});
    if(inviteError||!invite.user)return NextResponse.json({error:inviteFailureMessage(inviteError?.message)},{status:inviteError?.message?.toLowerCase().includes("rate limit")?429:400});
    invitedUserId=invite.user.id;
    const{data:admin,error:profileError}=await client.from("profiles").upsert({id:invitedUserId,organization_id:company.id,company_id:company.id,role:"admin",full_name:adminName,email:company.contact_email,active:true},{onConflict:"id"}).select("id,company_id,full_name,email,active").single();
    if(profileError||!admin)throw new Error(profileError?.message||"Admin profile could not be created.");
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:company.id,action:"company.admin_invited",entity_type:"profile",entity_id:admin.id,details:{admin_email:company.contact_email}});
    return NextResponse.json({member:{id:admin.id,company_id:company.id,kind:"admin",name:admin.full_name,email:admin.email,active:admin.active},message:`Admin invitation sent to ${company.contact_email}.`});
  }catch(error){
    if(invitedUserId)try{await serverClient().auth.admin.deleteUser(invitedUserId)}catch{}
    return failure(error);
  }
}

export async function POST(request:NextRequest){
  let companyId="";let adminUserId="";
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as {name?:string;slug?:string;plan?:string;adminName?:string;adminEmail?:string};
    const name=String(body.name||"").trim();
    const adminName=String(body.adminName||"").trim();
    const adminEmail=String(body.adminEmail||"").trim().toLowerCase();
    const plan=["standard","professional","enterprise"].includes(String(body.plan))?String(body.plan):"standard";
    if(name.length<2)throw new Error("Enter the company name.");
    if(adminName.length<2)throw new Error("Enter the first Admin's full name.");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail))throw new Error("Enter a valid Admin email.");
    const baseSlug=slugify(String(body.slug||name))||"company";
    const slug=`${baseSlug}-${Date.now().toString(36)}`;
    const{data:company,error:companyError}=await client.from("organizations").insert({name,slug,plan_name:plan,contact_email:adminEmail,active:true}).select("id,name,slug,active,plan_name,contact_email,created_at").single();
    if(companyError||!company)throw new Error(companyError?.message||"Company could not be created.");
    companyId=company.id;
    const siteUrl=process.env.NEXT_PUBLIC_SITE_URL||request.nextUrl.origin;
    const{data:invite,error:inviteError}=await client.auth.admin.inviteUserByEmail(adminEmail,{redirectTo:`${siteUrl}/auth/complete`,data:{full_name:adminName,role:"admin",company_id:companyId}});
    if(inviteError||!invite.user){
      await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created_invite_pending",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan,error:inviteError?.message}});
      return NextResponse.json({company,inviteSent:false,message:inviteFailureMessage(inviteError?.message)},{status:201});
    }
    adminUserId=invite.user.id;
    const{error:profileError}=await client.from("profiles").upsert({id:adminUserId,organization_id:companyId,company_id:companyId,role:"admin",full_name:adminName,email:adminEmail,active:true},{onConflict:"id"});
    if(profileError){
      await client.auth.admin.deleteUser(adminUserId);adminUserId="";
      await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created_invite_pending",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan,error:profileError.message}});
      return NextResponse.json({company,inviteSent:false,message:inviteFailureMessage(profileError.message)},{status:201});
    }
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan}});
    return NextResponse.json({company,inviteSent:true,message:`Company created. Admin invitation sent to ${adminEmail}.`},{status:201});
  }catch(error){
    if(adminUserId||companyId)try{const client=serverClient();if(adminUserId)await client.auth.admin.deleteUser(adminUserId);if(companyId)await client.from("organizations").delete().eq("id",companyId)}catch{}
    return failure(error);
  }
}
