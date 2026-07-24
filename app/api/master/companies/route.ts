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
  const authClient=createClient(url,anonKey,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const{data:auth,error:authError}=await authClient.auth.getUser(token);
  if(authError||!auth.user)throw new Error("Your login expired. Sign in again.");
  const{data:profile,error:profileError}=await authClient.from("profiles").select("id,role,active").eq("id",auth.user.id).maybeSingle();
  if(profileError)throw new Error(`Master profile verification failed: ${profileError.message}`);
  if(!profile?.active||profile.role!=="master")throw new Error("Only an active Master can create a company.");
  return{client:serverClient(),masterId:auth.user.id};
}

function slugify(value:string){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function failure(error:unknown,status=400){return NextResponse.json({error:error instanceof Error?error.message:"Company creation failed."},{status})}
function inviteFailureMessage(message?:string){return message?.toLowerCase().includes("rate limit")?"Company saved, but Supabase reached its email sending limit. Wait for the limit to reset or configure custom SMTP, then resend the Admin access email.":`Company saved, but the Admin access email was not sent${message?`: ${message}`:"."}`}
function invitationOrigin(request:NextRequest){
  const requestOrigin=request.nextUrl.origin;
  const configured=String(process.env.NEXT_PUBLIC_SITE_URL||"").replace(/\/$/,"");
  if(configured&&!/localhost|127\.0\.0\.1/i.test(configured))return configured;
  return requestOrigin;
}
const companyColumns="id,name,slug,active,plan_name,contact_email,referral_code,stripe_connect_status,stripe_connected_account_id,created_at,deleted_at,purge_after,deletion_reason";

async function findAuthUserByEmail(client:ReturnType<typeof serverClient>,email:string){
  for(let page=1;page<=10;page++){
    const{data,error}=await client.auth.admin.listUsers({page,perPage:100});
    if(error)throw new Error(`Could not check the existing Admin account: ${error.message}`);
    const user=data.users.find(item=>item.email?.toLowerCase()===email.toLowerCase());
    if(user)return user;
    if(data.users.length<100)break;
  }
  return null;
}

async function linkExistingAdmin(client:ReturnType<typeof serverClient>,company:{id:string;name:string;contact_email:string},adminName:string,siteUrl:string){
  const user=await findAuthUserByEmail(client,company.contact_email);
  if(!user)throw new Error("This email is registered, but its Auth user could not be located. Remove it in Supabase Authentication or contact support.");
  const{error:updateUserError}=await client.auth.admin.updateUserById(user.id,{user_metadata:{...(user.user_metadata||{}),full_name:adminName,role:"admin",company_id:company.id}});
  if(updateUserError)throw new Error(updateUserError.message);
  const{data:admin,error:profileError}=await client.from("profiles").upsert({id:user.id,organization_id:company.id,company_id:company.id,role:"admin",full_name:adminName,email:company.contact_email,active:true},{onConflict:"id"}).select("id,company_id,full_name,email,active").single();
  if(profileError||!admin)throw new Error(profileError?.message||"The existing Admin profile could not be linked to this company.");
  const{error:resetError}=await client.auth.resetPasswordForEmail(company.contact_email,{redirectTo:`${siteUrl}/reset-password?onboarding=company`});
  if(resetError)throw new Error(resetError.message);
  return admin;
}

export async function GET(request:NextRequest){
  try{
    const{client}=await requireMaster(request);
    const[companies,leads,requests,audit,admins,employees,customers]=await Promise.all([
      client.from("organizations").select(companyColumns).order("created_at",{ascending:false}),
      client.from("lead_center").select("*").order("created_at",{ascending:false}),
      client.from("master_company_access_requests").select("*").order("created_at",{ascending:false}),
      client.from("master_audit_log").select("*").order("created_at",{ascending:false}).limit(100),
      client.from("profiles").select("id,company_id,organization_id,full_name,email,active").eq("role","admin"),
      client.from("employees").select("id,company_id,organization_id,full_name,email,active"),
      client.from("customers").select("id,company_id,organization_id,full_name,email"),
    ]);
    if(companies.error)throw new Error(companies.error.message);
    const warnings=[leads.error,requests.error,audit.error,admins.error,employees.error,customers.error].filter(Boolean).map(error=>error!.message);
    const members=[
      ...(admins.data||[]).map((row:any)=>({id:row.id,company_id:row.company_id||row.organization_id,kind:"admin",name:row.full_name,email:row.email,active:row.active})),
      ...(employees.data||[]).map((row:any)=>({id:row.id,company_id:row.company_id||row.organization_id,kind:"employee",name:row.full_name,email:row.email,active:row.active})),
      ...(customers.data||[]).map((row:any)=>({id:row.id,company_id:row.company_id||row.organization_id,kind:"customer",name:row.full_name,email:row.email,active:true})),
    ];
    return NextResponse.json({companies:companies.data||[],leads:leads.data||[],requests:requests.data||[],audit:audit.data||[],members,warnings});
  }catch(error){return failure(error,401)}
}

export async function PATCH(request:NextRequest){
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as{id?:string;active?:boolean;action?:"restore"};
    if(!body.id)throw new Error("Company is required.");
    if(body.action==="restore"){
      const{data,error}=await client.rpc("master_restore_company",{p_company_id:body.id,p_master_profile_id:masterId});
      if(error||!data)throw new Error(error?.message||"Company could not be restored.");
      return NextResponse.json({company:data,message:"Company restored. Files, accounts and tools were queued for synchronization."});
    }
    if(typeof body.active!=="boolean")throw new Error("Company status is required.");
    const{data,error}=await client.from("organizations").update({active:body.active,updated_at:new Date().toISOString()}).eq("id",body.id).is("deleted_at",null).select(companyColumns).single();
    if(error||!data)throw new Error(error?.message||"Company could not be updated.");
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:data.id,action:body.active?"company.activated":"company.deactivated",entity_type:"organization",entity_id:data.id});
    return NextResponse.json({company:data});
  }catch(error){return failure(error)}
}

export async function DELETE(request:NextRequest){
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as{id?:string;reason?:string};
    if(!body.id)throw new Error("Choose a company.");
    const{data,error}=await client.rpc("master_trash_company",{p_company_id:body.id,p_master_profile_id:masterId,p_reason:body.reason||null});
    if(error||!data)throw new Error(error?.message||"Company could not be moved to trash.");
    return NextResponse.json({company:data,message:"Company moved to Trash for 60 days. Files, accounts and tools were queued for synchronization."});
  }catch(error){return failure(error)}
}

export async function PUT(request:NextRequest){
  let invitedUserId="";
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as{id?:string;adminName?:string};
    if(!body.id)throw new Error("Choose a company.");
    const{data:company,error:companyError}=await client.from("organizations").select("id,name,contact_email").eq("id",body.id).single();
    if(companyError||!company)throw new Error(companyError?.message||"Company not found.");
    if(!company.contact_email)throw new Error("Add a contact email before sending Admin access.");
    const existingProfile=await client.from("profiles").select("id,full_name").eq("email",company.contact_email).maybeSingle();
    const adminName=String(body.adminName||existingProfile.data?.full_name||`${company.name} Admin`).trim();
    const siteUrl=invitationOrigin(request);

    let admin;
    let delivery:"invitation"|"recovery"="invitation";
    if(existingProfile.data){
      admin=await linkExistingAdmin(client,company,adminName,siteUrl);
      delivery="recovery";
    }else{
      const{data:invite,error:inviteError}=await client.auth.admin.inviteUserByEmail(company.contact_email,{redirectTo:`${siteUrl}/auth/complete`,data:{full_name:adminName,role:"admin",company_id:company.id}});
      if(inviteError||!invite.user){
        if(inviteError?.message?.toLowerCase().includes("already")||inviteError?.message?.toLowerCase().includes("registered")){
          admin=await linkExistingAdmin(client,company,adminName,siteUrl);
          delivery="recovery";
        }else return NextResponse.json({error:inviteFailureMessage(inviteError?.message)},{status:inviteError?.message?.toLowerCase().includes("rate limit")?429:400});
      }else{
        invitedUserId=invite.user.id;
        const result=await client.from("profiles").upsert({id:invitedUserId,organization_id:company.id,company_id:company.id,role:"admin",full_name:adminName,email:company.contact_email,active:true},{onConflict:"id"}).select("id,company_id,full_name,email,active").single();
        if(result.error||!result.data)throw new Error(result.error?.message||"Admin profile could not be created.");
        admin=result.data;
      }
    }
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:company.id,action:delivery==="recovery"?"company.admin_access_resent":"company.admin_invited",entity_type:"profile",entity_id:admin.id,details:{admin_email:company.contact_email,delivery}});
    return NextResponse.json({member:{id:admin.id,company_id:company.id,kind:"admin",name:admin.full_name,email:admin.email,active:admin.active},message:delivery==="recovery"?`Access email sent to ${company.contact_email}. The Admin can create a new password and continue company setup.`:`Admin invitation sent to ${company.contact_email}.`});
  }catch(error){
    if(invitedUserId)try{await serverClient().auth.admin.deleteUser(invitedUserId)}catch{}
    return failure(error);
  }
}

export async function POST(request:NextRequest){
  let companyId="";let adminUserId="";
  try{
    const{client,masterId}=await requireMaster(request);
    const body=await request.json() as{name?:string;slug?:string;plan?:string;adminName?:string;adminEmail?:string};
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
    const siteUrl=invitationOrigin(request);
    const{data:invite,error:inviteError}=await client.auth.admin.inviteUserByEmail(adminEmail,{redirectTo:`${siteUrl}/auth/complete`,data:{full_name:adminName,role:"admin",company_id:companyId}});
    if(inviteError||!invite.user){
      if(inviteError?.message?.toLowerCase().includes("already")||inviteError?.message?.toLowerCase().includes("registered")){
        const admin=await linkExistingAdmin(client,{id:company.id,name:company.name,contact_email:adminEmail},adminName,siteUrl);
        await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created_existing_admin_relinked",entity_type:"profile",entity_id:admin.id,details:{admin_email:adminEmail,plan}});
        return NextResponse.json({company,inviteSent:true,member:{id:admin.id,company_id:company.id,kind:"admin",name:admin.full_name,email:admin.email,active:admin.active},message:`Company created. ${adminEmail} already had an account, so a new password/setup email was sent.`},{status:201});
      }
      await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created_invite_pending",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan,error:inviteError?.message}});
      return NextResponse.json({company,inviteSent:false,message:inviteFailureMessage(inviteError?.message)},{status:201});
    }
    adminUserId=invite.user.id;
    const{data:admin,error:profileError}=await client.from("profiles").upsert({id:adminUserId,organization_id:companyId,company_id:companyId,role:"admin",full_name:adminName,email:adminEmail,active:true},{onConflict:"id"}).select("id,company_id,full_name,email,active").single();
    if(profileError||!admin){
      await client.auth.admin.deleteUser(adminUserId);adminUserId="";
      await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created_invite_pending",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan,error:profileError?.message}});
      return NextResponse.json({company,inviteSent:false,message:inviteFailureMessage(profileError?.message)},{status:201});
    }
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan}});
    return NextResponse.json({company,inviteSent:true,member:{id:admin.id,company_id:company.id,kind:"admin",name:admin.full_name,email:admin.email,active:admin.active},message:`Company created. Admin invitation sent to ${adminEmail}.`},{status:201});
  }catch(error){
    if(adminUserId||companyId)try{const client=serverClient();if(adminUserId)await client.auth.admin.deleteUser(adminUserId);if(companyId)await client.from("organizations").delete().eq("id",companyId)}catch{}
    return failure(error);
  }
}
