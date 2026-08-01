import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";
import {reliableRpc} from "@/lib/supabase/reliableRpc";
import type {EmployeeTask} from "@/lib/storage";

type RawPhoto={bucket:string;storagePath:string;type:"issue"|"completion"};
type RawTask={id:string;property_id:string;customer_name:string;address_line1:string;city:string;province:string;postal_code:string|null;title:string;customer_issue:string;priority:EmployeeTask["priority"];status:EmployeeTask["status"];scheduled_date:string|null;created_at:string;assigned_at:string|null;work_started_at:string|null;work_finished_at:string|null;resolved_at:string|null;completion_duration_seconds:number|null;completion_summary:string|null;employee_name:string|null;crew_name:string|null;photos:RawPhoto[]};
type AdminInboxTask={id:string;kind:string;serviceName:string;message:string|null;status:string;priority:string|null;scheduledDate?:string|null;propertyId?:string|null;customerName:string;address:string;createdAt:string|null};

export function usesLiveTaskBackend(){return isSupabaseConfigured()}

async function sign(bucket:string,path:string){const client=getSupabaseBrowserClient();const{data,error}=await client.storage.from(bucket).createSignedUrl(path,3600);if(error||!data?.signedUrl)throw new Error(error?.message||"Task photo could not be authorized.");return data.signedUrl}

function normalizePriority(value:string|null):EmployeeTask["priority"]{return value==="low"||value==="urgent"?value:"normal"}
function normalizeStatus(value:string):EmployeeTask["status"]{return (["open","assigned","in_progress","completed","resolved"] as string[]).includes(value)?value as EmployeeTask["status"]:"open"}

async function loadAdminTaskFallback(client:ReturnType<typeof getSupabaseBrowserClient>):Promise<EmployeeTask[]>{
  const{data:session}=await client.auth.getSession();const token=session.session?.access_token;const userId=session.session?.user.id;if(!token||!userId)return[];
  const{data:profile}=await (client as any).from("profiles").select("role").eq("id",userId).maybeSingle();
  if(!profile||!["admin","manager"].includes(String(profile.role)))return[];
  const response=await fetch("/api/admin/service-requests",{headers:{authorization:`Bearer ${token}`},cache:"no-store"});
  const result=await response.json();if(!response.ok)throw new Error(result.error||"Admin task fallback could not be loaded.");
  return ((result.requests||[]) as AdminInboxTask[]).filter(item=>item.kind==="customer_task").map(item=>({id:item.id,createdAt:item.createdAt||new Date().toISOString(),leadId:item.propertyId||item.id,customer:item.customerName,address:item.address,title:item.serviceName,description:item.message||"Customer follow-up requested.",status:normalizeStatus(item.status),priority:normalizePriority(item.priority),assignedTo:"Admin",scheduledDate:item.scheduledDate||undefined,requestPhotos:[],completionPhotos:[]} as EmployeeTask));
}

export async function loadUnifiedTasks():Promise<EmployeeTask[]>{
  if(!usesLiveTaskBackend())throw new Error("Live Tasks require a connected database.");
  const client=getSupabaseBrowserClient();let rows:RawTask[]=[];let rpcFailure:unknown=null;
  try{const data=await reliableRpc(client,"get_live_task_board",{}, {attempts:2,timeoutMs:18000});rows=((data||{}) as{tasks?:RawTask[]}).tasks||[]}catch(error){rpcFailure=error}
  const mapped=await Promise.all(rows.map(async row=>{const photos=await Promise.all((row.photos||[]).map(async photo=>({type:photo.type,url:await sign(photo.bucket,photo.storagePath)})));return{id:row.id,createdAt:row.created_at,leadId:row.property_id,customer:row.customer_name,address:[row.address_line1,row.city,row.province,row.postal_code].filter(Boolean).join(", "),title:row.title,description:row.customer_issue,status:row.status,priority:row.priority,assignedTo:row.employee_name||row.crew_name||"Admin",scheduledDate:row.scheduled_date||undefined,assignedAt:row.assigned_at||undefined,resolvedAt:row.resolved_at||undefined,completedBy:row.employee_name||row.crew_name||undefined,workStartedAt:row.work_started_at||undefined,workFinishedAt:row.work_finished_at||undefined,durationSeconds:row.completion_duration_seconds||undefined,completionSummary:row.completion_summary||undefined,workDone:row.completion_summary||undefined,requestPhotos:photos.filter(p=>p.type==="issue").map(p=>p.url),completionPhotos:photos.filter(p=>p.type==="completion").map(p=>p.url)} as EmployeeTask}));
  const fallback=await loadAdminTaskFallback(client).catch(()=>[]);const byId=new Map<string,EmployeeTask>();fallback.forEach(task=>byId.set(task.id,task));mapped.forEach(task=>byId.set(task.id,task));
  const merged=[...byId.values()].sort((left,right)=>right.createdAt.localeCompare(left.createdAt));
  if(!merged.length&&rpcFailure)throw rpcFailure;
  return merged
}

async function rpc(name:string,args:Record<string,unknown>){return reliableRpc(getSupabaseBrowserClient(),name,args,{attempts:2,timeoutMs:18000})}
export function startLiveTask(taskId:string){return rpc("start_assigned_task",{p_task_id:taskId})}
export function completeLiveTask(taskId:string,summary:string){return rpc("complete_assigned_task",{p_task_id:taskId,p_summary:summary})}
export function resolveLiveTask(taskId:string,summary?:string){return rpc("resolve_completed_task",{p_task_id:taskId,p_summary:summary||null})}

export type DispatchWorker={id:string;name:string;kind:"employee"|"crew"};
export type DispatchProperty={id:string;customer:string;address:string};
export async function loadDispatchProperties():Promise<DispatchProperty[]>{
  if(!usesLiveTaskBackend())throw new Error("Live dispatch requires a connected database.");
  const{data,error}=await getSupabaseBrowserClient().rpc("get_customer_property_directory" as never);
  if(error)throw new Error(error.message);
  return ((data||[]) as Array<{property_id:string;full_name:string;address_line1:string;city:string;province:string;postal_code:string|null}>).map(row=>({id:row.property_id,customer:row.full_name,address:[row.address_line1,row.city,row.province,row.postal_code].filter(Boolean).join(", ")}));
}
export async function loadDispatchWorkers():Promise<DispatchWorker[]>{
  if(!usesLiveTaskBackend())throw new Error("Live dispatch requires a connected database.");
  const{data,error}=await getSupabaseBrowserClient().rpc("get_task_dispatch_workers" as never);
  if(error)throw new Error(error.message);
  const payload=(data||{}) as{employees?:Array<{id:string;name:string}>;crews?:Array<{id:string;name:string}>};
  return [...(payload.employees||[]).map(item=>({...item,kind:"employee" as const})),...(payload.crews||[]).map(item=>({...item,kind:"crew" as const}))];
}
export function createLiveAdminTask(input:{propertyId:string;title:string;issue:string;priority:string;scheduledDate?:string}){return rpc("create_admin_task",{p_property_id:input.propertyId,p_title:input.title,p_issue:input.issue,p_priority:input.priority,p_scheduled_date:input.scheduledDate||null})}
export async function createLiveCustomerTask(input:{propertyId:string;title:string;issue:string;priority:string}){return String(await rpc("create_customer_task",{p_property_id:input.propertyId,p_title:input.title,p_issue:input.issue,p_priority:input.priority}))}
export function assignLiveTask(taskId:string,worker:DispatchWorker,scheduledDate?:string){return rpc("assign_task",{p_task_id:taskId,p_employee_id:worker.kind==="employee"?worker.id:null,p_crew_id:worker.kind==="crew"?worker.id:null,p_scheduled_date:scheduledDate||null})}
export function unassignLiveTask(taskId:string){return rpc("unassign_task",{p_task_id:taskId})}

export async function uploadLiveTaskPhotos(taskId:string,files:File[],type:"issue"|"completion"){
  const client=getSupabaseBrowserClient() as any;const{data:task,error}=await client.from("tasks").select("company_id,property_id").eq("id",taskId).single();if(error||!task)throw new Error(error?.message||"Task not found.");
  const urls:string[]=[];for(const file of files.slice(0,5)){const ext=file.name.split(".").pop()?.replace(/[^a-z0-9]/gi,"").toLowerCase()||"jpg";const path=`${task.company_id}/${task.property_id}/${taskId}/${crypto.randomUUID()}.${ext}`;const upload=await client.storage.from("task-photos").upload(path,file,{contentType:file.type||"image/jpeg"});if(upload.error)throw new Error(upload.error.message);await rpc("register_task_photo",{p_task_id:taskId,p_storage_path:path,p_photo_type:type,p_caption:type==="issue"?"Customer issue evidence":"Employee completion evidence"});urls.push(await sign("task-photos",path))}return urls
}
