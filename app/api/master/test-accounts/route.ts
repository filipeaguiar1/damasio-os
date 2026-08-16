import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const dynamic = "force-dynamic";

const singleSchema=z.object({
  mode:z.literal("single").optional(),
  companyId:z.string().uuid(),
  role:z.enum(["company","customer","employee"]),
  fullName:z.string().trim().min(2).max(120),
  email:z.string().trim().email().max(200),
  password:z.string().min(10).max(128),
  expiresInMinutes:z.number().int().min(15).max(43200).nullable(),
  address:z.string().trim().max(220).optional(),
}).strict();

const ecosystemSchema=z.object({
  mode:z.literal("ecosystem"),
  companyName:z.string().trim().min(2).max(120),
  employeeCount:z.number().int().min(1).max(8),
  customerCount:z.number().int().min(1).max(40),
  password:z.string().min(10).max(128),
  expiresInMinutes:z.number().int().min(15).max(43200).nullable(),
}).strict();

const patchSchema=z.object({
  id:z.string().uuid(),
  displayName:z.string().trim().min(2).max(120),
}).strict();

const createSchema=z.union([singleSchema,ecosystemSchema]);

type Credential={email:string;password:string;role:string;company:string;expiresAt:string|null;displayName:string};

type CreatedEmployee={employeeId:string;crewId:string;displayName:string};

const demoProperties:[string,string,string][]=[
  ["177 Westmount Avenue","Toronto","M6E 3K4"],
  ["71 Main St W","Hamilton","L8P 4Y5"],
  ["120 King St W","Hamilton","L8P 4V2"],
  ["88 Lakeshore Rd E","Oakville","L6J 1H3"],
  ["450 Brant St","Burlington","L7R 2G4"],
  ["50 Aberdeen Ave","Hamilton","L8P 2N5"],
  ["190 Locke St S","Hamilton","L8P 4B4"],
  ["21 King St E","Dundas","L9H 1B7"],
  ["100 Main St E","Grimsby","L3M 1N8"],
  ["30 Main St W","Beamsville","L0R 1B0"],
];

const demoServices=[
  {name:"Weekly lawn care",frequency:"weekly",subtotal:95},
  {name:"Garden maintenance",frequency:"biweekly",subtotal:145},
  {name:"Hedge trimming",frequency:"monthly",subtotal:180},
  {name:"Seasonal cleanup",frequency:"one_time",subtotal:260},
];

function adminClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Temporary test access is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) as any;
}

function missingColumn(message:string){return /column .* does not exist|Could not find .* column|schema cache/i.test(message)}
function slugify(value:string){const base=value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,44)||"test-universe";return `${base}-${Date.now().toString(36)}`}
function today(){return new Date().toISOString().slice(0,10)}
function expiresAt(minutes:number|null){return minutes==null?null:new Date(Date.now()+minutes*60000).toISOString()}
function testEmail(runId:string,suffix:string){return `t${runId}${suffix}@4s.test`.toLowerCase()}

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

async function insertWithFallback(service:any,table:string,payload:Record<string,unknown>,fallbackKeys:string[],select="id"){
  let result=await service.from(table).insert(payload).select(select).single();
  if(result.error&&missingColumn(result.error.message)&&fallbackKeys.length){
    const fallback={...payload};
    for(const key of fallbackKeys)delete fallback[key];
    result=await service.from(table).insert(fallback).select(select).single();
  }
  if(result.error||!result.data)throw new Error(result.error?.message||`${table} could not be created.`);
  return result.data;
}

async function upsertProfile(service:any,payload:Record<string,unknown>){
  let result=await service.from("profiles").upsert(payload,{onConflict:"id"});
  if(result.error&&missingColumn(result.error.message)){
    const fallback={...payload};
    delete fallback.company_id;
    delete fallback.route_start_address;
    delete fallback.daily_route_capacity;
    result=await service.from("profiles").upsert(fallback,{onConflict:"id"});
  }
  if(result.error)throw new Error(result.error.message);
}

async function trackAccount(service:any,input:{authUserId:string;masterId:string;companyId:string;role:string;email:string;displayName:string;customerId?:string|null;employeeId?:string|null;expiresAt:string|null}){
  const account=await service.from("temporary_test_accounts").insert({auth_user_id:input.authUserId,created_by_master_id:input.masterId,company_id:input.companyId,role:input.role,email:input.email,display_name:input.displayName,customer_id:input.customerId||null,employee_id:input.employeeId||null,expires_at:input.expiresAt}).select("id,auth_user_id,company_id,role,email,display_name,customer_id,employee_id,expires_at,disabled_at,created_at").single();
  if(account.error||!account.data)throw new Error(account.error?.message||"Temporary access record could not be created.");
  return account.data;
}

async function createAuthLogin(service:any,input:{companyId:string;role:string;fullName:string;email:string;password:string;metadata?:Record<string,unknown>}){
  const email=input.email.toLowerCase();
  if(await findUserByEmail(service,email))throw new Error(`The email ${email} already exists. Temporary accounts never overwrite existing credentials.`);
  const created=await service.auth.admin.createUser({email,password:input.password,email_confirm:true,user_metadata:{full_name:input.fullName,test_account:true,...input.metadata}});
  if(created.error||!created.data.user)throw new Error(created.error?.message||"Temporary Auth user could not be created.");
  const authUserId=created.data.user.id;
  await upsertProfile(service,{id:authUserId,organization_id:input.companyId,company_id:input.companyId,role:input.role,full_name:input.fullName,email,active:true});
  return{authUserId,email};
}

async function createCompany(service:any,name:string){
  const slug=slugify(name);
  return insertWithFallback(service,"organizations",{name,slug,active:true,plan_name:"Professional",contact_email:"admin@4s.test"},["plan_name","contact_email","active"],"id,name");
}

async function createCrewEmployee(service:any,input:{companyId:string;authUserId:string;fullName:string;email:string;index:number}){
  const crew=await insertWithFallback(service,"crews",{organization_id:input.companyId,company_id:input.companyId,name:`${input.fullName} route crew`,active:true},[],"id");
  const common={organization_id:input.companyId,company_id:input.companyId,profile_id:input.authUserId,crew_id:crew.id,full_name:input.fullName,email:input.email,address_line1:"71 Main St W, Hamilton, ON",route_start_address:"71 Main St W, Hamilton, ON",active:true,invite_status:"accepted",daily_route_capacity:16};
  const employee=await insertWithFallback(service,"employees",common,["daily_route_capacity","route_start_address","invite_status"],"id");
  return{employeeId:String(employee.id),crewId:String(crew.id),displayName:input.fullName};
}

async function createCustomerChain(service:any,input:{companyId:string;runId:string;index:number;profileId?:string|null;email?:string|null}){
  const number=String(input.index+1).padStart(2,"0");
  const [addressLine1,city,postalCode]=demoProperties[input.index%demoProperties.length];
  const plan=demoServices[input.index%demoServices.length];
  const email=(input.email||testEmail(input.runId,`c${number}`)).toLowerCase();
  const tax=Math.round(plan.subtotal*.13*100)/100;
  const total=Math.round((plan.subtotal+tax)*100)/100;
  const customer=await insertWithFallback(service,"customers",{organization_id:input.companyId,company_id:input.companyId,service_company_id:input.companyId,origin_company_id:input.companyId,profile_id:input.profileId||null,full_name:`Test Customer ${number}`,email,phone:`905-555-${String(3000+input.index).slice(-4)}`,notes:"Master-created connected test universe",acquisition_source:"company_created",assignment_status:"active",offer_status:"accepted",platform_managed:false,archived_at:null},["service_company_id","origin_company_id","acquisition_source","assignment_status","offer_status","platform_managed","archived_at"],"id");
  const property=await insertWithFallback(service,"properties",{organization_id:input.companyId,company_id:input.companyId,customer_id:customer.id,address_line1:addressLine1,city,province:"ON",postal_code:postalCode,country:"Canada",lot_size:["small","legacy","oversize"][input.index%3],grass_height:["2in","3in","4in"][input.index%3],gate:input.index%3===0,dog:false,irrigation:input.index%4===0,access_notes:"Connected test property",property_notes:`${plan.name} · created by Master test universe`,geocode_status:"not_mapped",latitude:null,longitude:null},["lot_size","grass_height","gate","dog","irrigation","access_notes","property_notes","geocode_status","latitude","longitude"],"id");
  const quote=await insertWithFallback(service,"quotes",{organization_id:input.companyId,company_id:input.companyId,customer_id:customer.id,property_id:property.id,quote_number:`TEST-${input.runId.toUpperCase()}-${number}`,status:"approved",subtotal:plan.subtotal,tax,total,notes:`${plan.name} · Master test universe`},[],"id");
  const job=await insertWithFallback(service,"jobs",{organization_id:input.companyId,company_id:input.companyId,customer_id:customer.id,property_id:property.id,quote_id:quote.id,service_name:plan.name,frequency:plan.frequency,active:true,next_visit_date:null},[],"id");
  return{customerId:String(customer.id),jobId:String(job.id)};
}

async function publishRoutes(service:any,employees:CreatedEmployee[],jobIds:string[]){
  const routeDate=today();
  for(let index=0;index<employees.length;index+=1){
    const assigned=jobIds.filter((_,jobIndex)=>jobIndex%employees.length===index);
    if(!assigned.length)continue;
    const result=await service.rpc("publish_canonical_route",{p_employee_id:employees[index].employeeId,p_crew_id:employees[index].crewId,p_route_date:routeDate,p_ordered_job_ids:assigned,p_source_visit_ids:[]});
    if(result.error)throw new Error(result.error.message);
  }
}

async function createEcosystem(service:any,masterId:string,body:z.infer<typeof ecosystemSchema>){
  const createdAuthIds:string[]=[];
  let companyId="";
  try{
    const runId=Date.now().toString(36).slice(-5);
    const company=await createCompany(service,body.companyName);
    companyId=String(company.id);
    const companyName=String(company.name||body.companyName);
    const expiration=expiresAt(body.expiresInMinutes);
    const credentials:Credential[]=[];

    const adminEmail=testEmail(runId,"a");
    const admin=await createAuthLogin(service,{companyId,role:"admin",fullName:"Test Company Admin",email:adminEmail,password:body.password,metadata:{test_universe:true,company_id:companyId}});
    createdAuthIds.push(admin.authUserId);
    await trackAccount(service,{authUserId:admin.authUserId,masterId,companyId,role:"admin",email:admin.email,displayName:"Test Company Admin",expiresAt:expiration});
    credentials.push({email:admin.email,password:body.password,role:"Company Admin",company:companyName,expiresAt:expiration,displayName:"Test Company Admin"});

    const employees:CreatedEmployee[]=[];
    for(let index=0;index<body.employeeCount;index+=1){
      const displayName=`Test Worker ${String(index+1).padStart(2,"0")}`;
      const email=testEmail(runId,`w${index+1}`);
      const login=await createAuthLogin(service,{companyId,role:"employee",fullName:displayName,email,password:body.password,metadata:{test_universe:true,company_id:companyId}});
      createdAuthIds.push(login.authUserId);
      const employee=await createCrewEmployee(service,{companyId,authUserId:login.authUserId,fullName:displayName,email:login.email,index});
      employees.push(employee);
      await trackAccount(service,{authUserId:login.authUserId,masterId,companyId,role:"employee",email:login.email,displayName,employeeId:employee.employeeId,expiresAt:expiration});
      credentials.push({email:login.email,password:body.password,role:"Employee / Worker",company:companyName,expiresAt:expiration,displayName});
    }

    const customerEmail=testEmail(runId,"c");
    const customerLogin=await createAuthLogin(service,{companyId,role:"customer",fullName:"Test Customer 01",email:customerEmail,password:body.password,metadata:{test_universe:true,company_id:companyId}});
    createdAuthIds.push(customerLogin.authUserId);

    const jobIds:string[]=[];
    let loginCustomerId="";
    for(let index=0;index<body.customerCount;index+=1){
      const chain=await createCustomerChain(service,{companyId,runId,index,profileId:index===0?customerLogin.authUserId:null,email:index===0?customerLogin.email:null});
      if(index===0)loginCustomerId=chain.customerId;
      jobIds.push(chain.jobId);
    }
    await trackAccount(service,{authUserId:customerLogin.authUserId,masterId,companyId,role:"customer",email:customerLogin.email,displayName:"Test Customer 01",customerId:loginCustomerId,expiresAt:expiration});
    credentials.push({email:customerLogin.email,password:body.password,role:"Customer",company:companyName,expiresAt:expiration,displayName:"Test Customer 01"});

    await publishRoutes(service,employees,jobIds);
    await service.from("master_audit_log").insert({master_profile_id:masterId,company_id:companyId,action:"temporary_test_universe.created",entity_type:"organization",entity_id:companyId,details:{company_name:companyName,employee_count:body.employeeCount,customer_count:body.customerCount,expires_at:expiration}});
    return{companyId,companyName,credentials,message:`Connected test universe created for ${companyName}: ${body.employeeCount} worker(s), ${body.customerCount} customer(s), and published route(s).`};
  }catch(error){
    for(const id of createdAuthIds.reverse()){
      await service.from("profiles").delete().eq("id",id).catch(()=>undefined);
      await service.auth.admin.deleteUser(id).catch(()=>undefined);
    }
    if(companyId)await service.from("organizations").delete().eq("id",companyId).catch(()=>undefined);
    throw error;
  }
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

    if(body.mode==="ecosystem"){
      const universe=await createEcosystem(service,masterId,body);
      return NextResponse.json({created:true,mode:"ecosystem",...universe});
    }

    const {data:company,error:companyError}=await service.from("organizations").select("id,name,active,deleted_at").eq("id",body.companyId).maybeSingle();
    if(companyError||!company?.active||company.deleted_at)throw new Error("Choose an active company.");
    const email=body.email.toLowerCase();
    if(await findUserByEmail(service,email))throw new Error("This email already exists. Temporary accounts never overwrite existing credentials.");

    const profileRole=body.role==="company"?"admin":body.role;
    const created=await createAuthLogin(service,{companyId:body.companyId,role:profileRole,fullName:body.fullName,email,password:body.password,metadata:{test_account:true}});
    authUserId=created.authUserId;

    if(body.role==="customer"){
      const customer=await insertWithFallback(service,"customers",{organization_id:body.companyId,company_id:body.companyId,origin_company_id:body.companyId,service_company_id:body.companyId,profile_id:authUserId,full_name:body.fullName,email,notes:"Temporary Master-created test account",acquisition_source:"company_created",assignment_status:"active",offer_status:"accepted",platform_managed:false},["origin_company_id","service_company_id","acquisition_source","assignment_status","offer_status","platform_managed"],"id");
      customerId=customer.id;
      const property=await insertWithFallback(service,"properties",{organization_id:body.companyId,company_id:body.companyId,customer_id:customerId,address_line1:body.address||"100 Test Access Lane",city:"Hamilton",province:"ON",country:"Canada",property_notes:"Temporary test property created by Master."},[],"id");
      propertyId=property.id;
    }

    if(body.role==="employee"){
      const employee=await createCrewEmployee(service,{companyId:body.companyId,authUserId,fullName:body.fullName,email,index:0});
      employeeId=employee.employeeId;
    }

    const expiration=expiresAt(body.expiresInMinutes);
    const account=await trackAccount(service,{authUserId,masterId,companyId:body.companyId,role:profileRole,email,displayName:body.fullName,customerId:customerId||null,employeeId:employeeId||null,expiresAt:expiration});

    await service.from("master_audit_log").insert({master_profile_id:masterId,company_id:body.companyId,action:"temporary_test_account.created",entity_type:"profile",entity_id:authUserId,details:{role:profileRole,email,expires_at:expiration,customer_id:customerId||null,property_id:propertyId||null,employee_id:employeeId||null}});

    return NextResponse.json({created:true,account,companyName:company.name,message:expiration?`Temporary ${profileRole} account created until ${new Date(expiration).toLocaleString("en-CA")}.`:`Unlimited test ${profileRole} account created. Disable it manually when testing is complete.`});
  }catch(error){
    if(propertyId)await service.from("properties").delete().eq("id",propertyId);
    if(customerId)await service.from("customers").delete().eq("id",customerId);
    if(employeeId)await service.from("employees").delete().eq("id",employeeId);
    if(authUserId){await service.from("profiles").delete().eq("id",authUserId);await service.auth.admin.deleteUser(authUserId).catch(()=>undefined)}
    const message=error instanceof Error?error.message:"Temporary account could not be created.";
    return NextResponse.json({error:message},{status:/session expired|sign in/i.test(message)?401:/Only an active Master/i.test(message)?403:400});
  }
}

export async function PATCH(request:NextRequest){
  try{
    const {service,masterId}=await requireMaster(request);
    const body=patchSchema.parse(await request.json());
    const {data:account,error}=await service.from("temporary_test_accounts").select("id,auth_user_id,company_id,role,email,display_name,customer_id,employee_id,expires_at,disabled_at,disabled_reason,created_at").eq("id",body.id).maybeSingle();
    if(error||!account)return NextResponse.json({error:"Temporary test account not found."},{status:404});
    const updated=await service.from("temporary_test_accounts").update({display_name:body.displayName}).eq("id",body.id).select("id,auth_user_id,company_id,role,email,display_name,customer_id,employee_id,expires_at,disabled_at,disabled_reason,created_at").single();
    if(updated.error||!updated.data)throw new Error(updated.error?.message||"Temporary test profile could not be updated.");
    const profileUpdate=await service.from("profiles").update({full_name:body.displayName}).eq("id",account.auth_user_id);
    if(profileUpdate.error)throw new Error(profileUpdate.error.message);
    if(account.customer_id){const customerUpdate=await service.from("customers").update({full_name:body.displayName}).eq("id",account.customer_id);if(customerUpdate.error)throw new Error(customerUpdate.error.message)}
    if(account.employee_id){const employeeUpdate=await service.from("employees").update({full_name:body.displayName}).eq("id",account.employee_id);if(employeeUpdate.error)throw new Error(employeeUpdate.error.message)}
    await service.auth.admin.updateUserById(account.auth_user_id,{user_metadata:{full_name:body.displayName,test_account:true}}).catch(()=>undefined);
    await service.from("master_audit_log").insert({master_profile_id:masterId,company_id:account.company_id,action:"temporary_test_account.updated",entity_type:"profile",entity_id:account.auth_user_id,details:{email:account.email,display_name:body.displayName}});
    return NextResponse.json({updated:true,account:updated.data,message:"Test profile name updated."});
  }catch(error){
    const message=error instanceof Error?error.message:"Temporary account could not be updated.";
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
