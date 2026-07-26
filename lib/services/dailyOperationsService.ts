import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type DailyVisit={id:string;propertyId:string;customerId:string;scheduledDate:string;status:string;startedAt:string|null;finishedAt:string|null;durationSeconds:number|null;employeeNotes:string|null;customerVisibleSummary:string|null;customerName:string;address:string;city:string;province:string;serviceName:string;assignedTo:string};
export type DailyTask={id:string;propertyId:string;scheduledDate:string|null;status:string;priority:string;title:string;customerIssue:string;createdAt:string;workStartedAt:string|null;workFinishedAt:string|null;completionSummary:string|null;customerName:string;address:string;city:string;province:string;assignedTo:string};
export type DailyOperations={date:string;summary:{homesTotal:number;homesOpen:number;homesInProgress:number;homesDone:number;homesMissed:number;tasksOpen:number;tasksInProgress:number;tasksDone:number;urgentTasks:number;unassignedHomes:number;unassignedTasks:number};visits:DailyVisit[];tasks:DailyTask[];cities:Array<{city:string;total:number;completed:number;remaining:number}>;assignees:Array<{name:string;total:number;completed:number;inProgress:number;remaining:number}>};

export function usesLiveDailyOperations(){
  return isSupabaseConfigured();
}

export async function loadDailyOperations(date?:string):Promise<DailyOperations>{
  if(!isSupabaseConfigured()) throw new Error("Live operations require a connected database.");
  const{data,error}=await getSupabaseBrowserClient().rpc("get_live_daily_operations" as never,{p_date:date||null} as never);
  if(error)throw new Error(error.message);
  return data as unknown as DailyOperations;
}
