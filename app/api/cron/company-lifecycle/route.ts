import {createHmac} from "crypto";
import {NextRequest,NextResponse} from "next/server";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;

type LifecycleEvent={id:string;company_id:string;event_type:"company.trashed"|"company.restored"|"company.purge_due";attempts:number;snapshot:Record<string,unknown>};
const buckets=["property-photos","work-photos","task-photos","before-after","documents"];

function serverClient(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("Supabase lifecycle worker is not configured.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function authorize(request:NextRequest){
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)throw new Error("Unauthorized lifecycle worker request.");
}
function parseStorageFile(publicUrl?:string|null){
  if(!publicUrl)return null;
  const match=publicUrl.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  return match?{bucket:decodeURIComponent(match[1]),path:decodeURIComponent(match[2])}:null;
}
async function listStorageTree(client:SupabaseClient,bucket:string,prefix:string):Promise<string[]>{
  const files:string[]=[];let offset=0;
  for(;;){
    const{data,error}=await client.storage.from(bucket).list(prefix,{limit:1000,offset,sortBy:{column:"name",order:"asc"}});
    if(error){if(error.message.toLowerCase().includes("not found"))return files;throw error;}
    for(const object of data||[]){
      const path=prefix?`${prefix}/${object.name}`:object.name;
      if(object.id)files.push(path);else files.push(...await listStorageTree(client,bucket,path));
    }
    if((data?.length||0)<1000)break;offset+=1000;
  }
  return files;
}
async function syncAuth(client:SupabaseClient,companyId:string,eventType:LifecycleEvent["event_type"]){
  const{data,error}=await client.from("profiles").select("id").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if(error)throw error;
  const action=eventType==="company.trashed"?"blocked":eventType==="company.restored"?"restored":"deleted";
  for(const profile of data||[]){
    const result=eventType==="company.purge_due"
      ?await client.auth.admin.deleteUser(profile.id)
      :await client.auth.admin.updateUserById(profile.id,{ban_duration:eventType==="company.trashed"?"876000h":"none"});
    if(result.error&&!result.error.message.toLowerCase().includes("not found"))throw result.error;
  }
  return{action,count:data?.length||0};
}
async function purgeStorage(client:SupabaseClient,companyId:string){
  const{data:photos,error}=await client.from("photos").select("storage_path,public_url").or(`company_id.eq.${companyId},organization_id.eq.${companyId}`);
  if(error)throw error;
  const pathsByBucket=new Map<string,Set<string>>();
  for(const photo of photos||[]){
    const parsed=parseStorageFile(photo.public_url);
    if(parsed){if(!pathsByBucket.has(parsed.bucket))pathsByBucket.set(parsed.bucket,new Set());pathsByBucket.get(parsed.bucket)!.add(parsed.path);}
  }
  // New uploads use a company-id prefix. This also covers private documents,
  // which do not have a public URL in the photos table.
  for(const bucket of buckets){
    for(const path of await listStorageTree(client,bucket,companyId)){if(!pathsByBucket.has(bucket))pathsByBucket.set(bucket,new Set());pathsByBucket.get(bucket)!.add(path);}
  }
  let removed=0;
  for(const[bucket,paths]of pathsByBucket){if(!paths.size)continue;const{error}=await client.storage.from(bucket).remove([...paths]);if(error)throw error;removed+=paths.size;}
  return{action:"deleted",count:removed};
}
async function syncTools(event:LifecycleEvent){
  const url=process.env.COMPANY_LIFECYCLE_WEBHOOK_URL;
  if(!url)return{action:"no_connected_tools",delivered:false};
  const payload=JSON.stringify({event_id:event.id,event_type:event.event_type,company_id:event.company_id,occurred_at:new Date().toISOString()});
  const secret=process.env.COMPANY_LIFECYCLE_WEBHOOK_SECRET||"";
  const signature=createHmac("sha256",secret).update(payload).digest("hex");
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json","x-damasio-event-id":event.id,"x-damasio-signature":`sha256=${signature}`},body:payload,signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Connected tools webhook returned ${response.status}.`);
  return{action:"notified",delivered:true};
}
async function processEvent(client:SupabaseClient,event:LifecycleEvent){
  const result:Record<string,unknown>={database:{action:event.event_type},files:{action:"retained"}};
  if(event.event_type==="company.purge_due")result.files=await purgeStorage(client,event.company_id);
  result.accounts=await syncAuth(client,event.company_id,event.event_type);
  result.tools=await syncTools(event);
  if(event.event_type==="company.purge_due"){
    const{error}=await client.from("organizations").delete().eq("id",event.company_id).not("deleted_at","is",null).lte("purge_after",new Date().toISOString());
    if(error)throw error;result.database={action:"deleted"};
  }
  const{error}=await client.from("master_company_lifecycle_events").update({sync_status:"completed",processed_at:new Date().toISOString(),last_error:null,snapshot:{...event.snapshot,sync_result:result}}).eq("id",event.id);
  if(error)throw error;
  return result;
}

export async function GET(request:NextRequest){
  try{
    authorize(request);const client=serverClient();
    const{error:queueError}=await client.rpc("master_queue_expired_company_purges");if(queueError)throw queueError;
    const{data,error}=await client.from("master_company_lifecycle_events").select("id,company_id,event_type,attempts,snapshot").in("sync_status",["pending","failed"]).lt("attempts",10).order("created_at").limit(10);
    if(error)throw error;
    const results=[];
    for(const event of(data||[])as LifecycleEvent[]){
      const{data:claimed}=await client.from("master_company_lifecycle_events").update({sync_status:"processing",attempts:event.attempts+1,last_error:null}).eq("id",event.id).in("sync_status",["pending","failed"]).select("id").maybeSingle();
      if(!claimed)continue;
      try{results.push({id:event.id,ok:true,result:await processEvent(client,event)});}catch(processError){const message=processError instanceof Error?processError.message:"Lifecycle processing failed.";await client.from("master_company_lifecycle_events").update({sync_status:"failed",last_error:message}).eq("id",event.id);results.push({id:event.id,ok:false,error:message});}
    }
    return NextResponse.json({processed:results.length,results});
  }catch(error){const message=error instanceof Error?error.message:"Lifecycle worker failed.";return NextResponse.json({error:message},{status:message.startsWith("Unauthorized")?401:500});}
}
