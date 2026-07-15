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
  const client=serverClient();
  const{data:auth,error:authError}=await client.auth.getUser(token);
  if(authError||!auth.user)throw new Error("Your login expired. Sign in again.");
  const{data:profile}=await client.from("profiles").select("id,role,active").eq("id",auth.user.id).single();
  if(!profile?.active||profile.role!=="master")throw new Error("Only an active Master can create a company.");
  return{client,masterId:auth.user.id};
}

function slugify(value:string){return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function failure(error:unknown,status=400){return NextResponse.json({error:error instanceof Error?error.message:"Company creation failed."},{status})}

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
    if(inviteError||!invite.user)throw new Error(inviteError?.message||"Admin invitation could not be sent.");
    adminUserId=invite.user.id;
    const{error:profileError}=await client.from("profiles").upsert({id:adminUserId,organization_id:companyId,company_id:companyId,role:"admin",full_name:adminName,email:adminEmail,active:true},{onConflict:"id"});
    if(profileError)throw new Error(profileError.message);
    await client.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"company.created",entity_type:"organization",entity_id:companyId,details:{admin_email:adminEmail,plan}});
    return NextResponse.json({company,message:`Company created. Admin invitation sent to ${adminEmail}.`},{status:201});
  }catch(error){
    if(adminUserId||companyId)try{const client=serverClient();if(adminUserId)await client.auth.admin.deleteUser(adminUserId);if(companyId)await client.from("organizations").delete().eq("id",companyId)}catch{}
    return failure(error);
  }
}
