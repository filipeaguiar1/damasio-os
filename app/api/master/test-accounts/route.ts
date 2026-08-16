import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema=z.object({
  companyId:z.string().uuid(),
  role:z.enum(["company","customer","employee"]),
  fullName:z.string().trim().min(2).max(120),
  email:z.string().trim().email().max(200),
  password:z.string().min(10).max(128),
  expiresInMinutes:z.number().int().min(15).max(43200).nullable(),
  address:z.string().trim().max(220).optional(),
}).strict();

function adminClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Temporary test access is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) as any;
}

async function requireMaster(request:NextRequest){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token)throw new Error("Sign in as Master.");
  const service=adminClient();
  const {data:auth,error:authError}=await service.auth.getUser(token);
  if(authError||!auth.user)throw new Error("Your Master session expired.");
  const {data:profile,error}=await service.from("profiles").select("id,role,active").eq("id",auth.user.id).maybeSingle();
  if(error||!profile?.active||profile.role!=="master")throw new Error("Only an active Master can create temporary test accounts.");
  return{service,masterId:auth.user.id};
}

async function findUserByEmail(service:any,email:string){
  for(let page=1;page<=12;page+=1){
    const {data,error}=await service.auth.admin.listUsers({page,perPage:100});
    if(error)throw new Error(error.message);
    const found=data.users.find((item:any)=>String(item.email||"").toLowerCase()===email.toLowerCase());
    if(found)return found;
    if(data.users.length<100)return null;
  }
  return null;
}

export async function GET(request:NextRequest){
  try{
    const {service}=await requireMaster(request);
    const [accounts,companies]=await Promise.all([
      service.from("temporary_test_accounts").select("id,auth_user_id,company_id,role,email,display_name,customer_id,employee_id,expires_at,disabled_at,disabled_reason,created_at").order("created_at",{ascending:false}).limit(200),
      service.from("organizations").select("id,name,active,deleted_at").eq("active",true).is("deleted_at",null).order("name"),
    ]);
    if(accounts.error)throw new Error(accounts.error.message);
    if(companies.error)throw new Error(companies.error.message);
    return NextResponse.json({accounts:accounts.data||[],companies:companies.data||[]});
  }catch(error){
    const message=error instanceof Error?error.message:"Temporary access could not be loaded.";
    return NextResponse.json({error:message},{status:/session expired|sign in/i.test(message)?401:403});
  }
}

export async function POST(request:NextRequest){
  let authUserId="";
  let customerId="";
  let propertyId="";
  let employeeId="";
  const service=adminClient();
  try{
    const body=createSchema.parse(await request.json());
    const authHeader=request.headers.get("authorization")||"";
    const fakeRequest=new NextRequest(request.url,{headers:{authorization:authHeader}});
    const master=await requireMaster(fakeRequest);
    const masterId=master.masterId;

    const {data:company,error:companyError}=await service.from("organizations").select("id,name,active,deleted_at").eq("id",body.companyId).maybeSingle();
    if(companyError||!company?.active||company.deleted_at)throw new Error("Choose an active company.");
    const email=body.email.toLowerCase();
    if(await findUserByEmail(service,email))throw new Error("This email already exists. Temporary accounts never overwrite existing credentials.");

    const created=await service.auth.admin.createUser({email,password:body.password,email_confirm:true,user_metadata:{full_name:body.fullName,test_account:true}});
    if(created.error||!created.data.user)throw new Error(created.error?.message||"Temporary Auth user could not be created.");
    authUserId=created.data.user.id;

    const profileRole=body.role==="company"?"admin":body.role;
    const {error:profileError}=await service.from("profiles").upsert({id:authUserId,organization_id:body.companyId,company_id:body.companyId,role:profileRole,full_name:body.fullName,email,active:true},{onConflict:"id"});
    if(profileError)throw new Error(profileError.message);

    if(body.role==="customer"){
      const customer=await service.from("customers").insert({organization_id:body.companyId,company_id:body.companyId,origin_company_id:body.companyId,service_company_id:body.companyId,profile_id:authUserId,full_name:body.fullName,email,notes:"Temporary Master-created test account",acquisition_source:"company_created",assignment_status:"active",offer_status:"accepted",platform_managed:false}).select("id").single();
      if(customer.error||!customer.data)throw new Error(customer.error?.message||"Temporary Customer could not be created.");
      customerId=customer.data.id;
      const property=await service.from("properties").insert({organization_id:body.companyId,company_id:body.companyId,customer_id:customerId,address_line1:body.address||"100 Test Access Lane",city:"Hamilton",province:"ON",country:"Canada",property_notes:"Temporary test property created by Master."}).select("id").single();
      if(property.error||!property.data)throw new Error(property.error?.message||"Temporary Customer property could not be created.");
      propertyId=property.data.id;
    }

    if(body.role==="employee"){
      const employee=await service.from("employees").insert({organization_id:body.companyId,company_id:body.companyId,profile_id:authUserId,full_name:body.fullName,email,active:true,invite_status:"accepted"}).select("id").single();
      if(employee.error||!employee.data)throw new Error(employee.error?.message||"Temporary Employee could not be created.");
      employeeId=employee.data.id;
    }

    const expiresAt=body.expiresInMinutes==null?null:new Date(Date.now()+body.expiresInMinutes*60000).toISOString();
    const account=await service.from("temporary_test_accounts").insert({auth_user_id:authUserId,created_by_master_id:masterId,company_id:body.companyId,role:profileRole,email,display_name:body.fullName,customer_id:customerId||null,employee_id:employeeId||null,expires_at:expiresAt}).select("id,auth_user_id,company_id,role,email,display_name,customer_id,employee_id,expires_at,disabled_at,created_at").single();
    if(account.error||!account.data)throw new Error(account.error?.message||"Temporary access record could not be created.");

    await service.from("master_audit_log").insert({master_profile_id:masterId,company_id:body.companyId,action:"temporary_test_account.created",entity_type:"profile",entity_id:authUserId,details:{role:profileRole,email,expires_at:expiresAt,customer_id:customerId||null,property_id:propertyId||null,employee_id:employeeId||null}});

    return NextResponse.json({created:true,account:account.data,companyName:company.name,message:expiresAt?`Temporary ${profileRole} account created until ${new Date(expiresAt).toLocaleString("en-CA")}.`:`Unlimited test ${profileRole} account created. Disable it manually when testing is complete.`});
  }catch(error){
    if(propertyId)await service.from("properties").delete().eq("id",propertyId);
    if(customerId)await service.from("customers").delete().eq("id",customerId);
    if(employeeId)await service.from("employees").delete().eq("id",employeeId);
    if(authUserId){await service.from("profiles").delete().eq("id",authUserId);await service.auth.admin.deleteUser(authUserId).catch(()=>undefined)}
    const message=error instanceof Error?error.message:"Temporary account could not be created.";
    return NextResponse.json({error:message},{status:/session expired|sign in/i.test(message)?401:/Only an active Master/i.test(message)?403:400});
  }
}

export async function DELETE(request:NextRequest){
  try{
    const {service,masterId}=await requireMaster(request);
    const body=(await request.json()) as{id?:string};
    const id=String(body.id||"");
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))return NextResponse.json({error:"Choose a valid test account."},{status:400});
    const {data:account,error}=await service.from("temporary_test_accounts").select("id,auth_user_id,company_id,email,disabled_at").eq("id",id).maybeSingle();
    if(error||!account)return NextResponse.json({error:"Temporary test account not found."},{status:404});
    if(!account.disabled_at){const result=await service.rpc("disable_temporary_test_account",{p_account_id:id,p_reason:"disabled_by_master"});if(result.error)throw new Error(result.error.message)}
    await service.from("master_audit_log").insert({master_profile_id:masterId,company_id:account.company_id,action:"temporary_test_account.disabled",entity_type:"profile",entity_id:account.auth_user_id,details:{email:account.email}});
    return NextResponse.json({disabled:true,id});
  }catch(error){
    const message=error instanceof Error?error.message:"Temporary account could not be disabled.";
    return NextResponse.json({error:message},{status:/session expired|sign in/i.test(message)?401:403});
  }
}
