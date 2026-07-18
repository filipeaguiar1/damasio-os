import {getSupabaseBrowserClient,isSupabaseConfigured} from "@/lib/supabase/client";
import {readDemoSession} from "@/lib/auth/demoAuth";
import {getEmployeeTasks,type EmployeeTask} from "@/lib/storage";

type RawPhoto={bucket:string;storagePath:string;type:"issue"|"completion"};
type RawTask={id:string;property_id:string;customer_name:string;address_line1:string;city:string;province:string;postal_code:string|null;title:string;customer_issue:string;priority:EmployeeTask["priority"];status:EmployeeTask["status"];scheduled_date:string|null;created_at:string;assigned_at:string|null;work_started_at:string|null;work_finished_at:string|null;resolved_at:string|null;completion_duration_seconds:number|null;completion_summary:string|null;employee_name:string|null;crew_name:string|null;photos:RawPhoto[]};

export function usesLiveTaskBackend(){return isSupabaseConfigured()&&!readDemoSession()}

async function sign(bucket:string,path:string){const client=getSupabaseBrowserClient();const{data,error}=await client.storage.from(bucket).createSignedUrl(path,3600);if(error||!data?.signedUrl)throw new Error(error?.message||"Task photo could not be authorized.");return data.signedUrl}

export async function loadUnifiedTasks():Promise<EmployeeTask[]>{
  if(!usesLiveTaskBackend())return getEmployeeTasks();
  const client=getSupabaseBrowserClient();const{data,error}=await client.rpc("get_live_task_board" as never);if(error)throw new Error(error.message);
  const rows=((data||{}) as{tasks?:RawTask[]}).tasks||[];
  return Promise.all(rows.map(async row=>{const photos=await Promise.all((row.photos||[]).map(async photo=>({type:photo.type,url:await sign(photo.bucket,photo.storagePath)})));return{id:row.id,createdAt:row.created_at,leadId:row.property_id,customer:row.customer_name,address:[row.address_line1,row.city,row.province,row.postal_code].filter(Boolean).join(", "),title:row.title,description:row.customer_issue,status:row.status,priority:row.priority,assignedTo:row.employee_name||row.crew_name||"Admin",scheduledDate:row.scheduled_date||undefined,assignedAt:row.assigned_at||undefined,resolvedAt:row.resolved_at||undefined,completedBy:row.employee_name||row.crew_name||undefined,workStartedAt:row.work_started_at||undefined,workFinishedAt:row.work_finished_at||undefined,durationSeconds:row.completion_duration_seconds||undefined,completionSummary:row.completion_summary||undefined,workDone:row.completion_summary||undefined,requestPhotos:photos.filter(p=>p.type==="issue").map(p=>p.url),completionPhotos:photos.filter(p=>p.type==="completion").map(p=>p.url)} as EmployeeTask}))
}

async function rpc(name:string,args:Record<string,unknown>){const{error}=await getSupabaseBrowserClient().rpc(name as never,args as never);if(error)throw new Error(error.message)}
export function startLiveTask(taskId:string){return rpc("start_assigned_task",{p_task_id:taskId})}
export function completeLiveTask(taskId:string,summary:string){return rpc("complete_assigned_task",{p_task_id:taskId,p_summary:summary})}
export function resolveLiveTask(taskId:string,summary?:string){return rpc("resolve_completed_task",{p_task_id:taskId,p_summary:summary||null})}

export async function uploadLiveTaskPhotos(taskId:string,files:File[],type:"issue"|"completion"){
  const client=getSupabaseBrowserClient() as any;const{data:task,error}=await client.from("tasks").select("company_id,property_id").eq("id",taskId).single();if(error||!task)throw new Error(error?.message||"Task not found.");
  const urls:string[]=[];for(const file of files.slice(0,5)){const ext=file.name.split(".").pop()?.replace(/[^a-z0-9]/gi,"").toLowerCase()||"jpg";const path=`${task.company_id}/${task.property_id}/${taskId}/${crypto.randomUUID()}.${ext}`;const upload=await client.storage.from("task-photos").upload(path,file,{contentType:file.type||"image/jpeg"});if(upload.error)throw new Error(upload.error.message);await rpc("register_task_photo",{p_task_id:taskId,p_storage_path:path,p_photo_type:type,p_caption:type==="issue"?"Customer issue evidence":"Employee completion evidence"});urls.push(await sign("task-photos",path))}return urls
}
