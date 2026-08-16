import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type AlertTask = { id:string; customerId:string; propertyId:string; customerName:string; address:string; title:string; detail:string; status:string; priority:string; scheduledDate:string|null; createdAt:string };
export type AlertPayment = { id:string; customerId:string; propertyId:string|null; customerName:string; address:string|null; number:string; status:string; total:number; createdAt:string };
export type AlertFeedback = { id:string; customerId:string; propertyId:string|null; customerName:string; address:string|null; rating:number; comment:string|null; visitId:string|null; taskId:string|null; createdAt:string };
export type AlertVisit = { id:string; customerId:string; propertyId:string|null; customerName:string; address:string|null; scheduledDate:string; status:string; category:"completed"|"booked"|"upcoming"|"overdue"|"active"; createdAt:string };
export type AdminAlertCenter = { tasks:AlertTask[]; payments:AlertPayment[]; feedback:AlertFeedback[]; visits:AlertVisit[] };

const empty: AdminAlertCenter = { tasks:[], payments:[], feedback:[], visits:[] };

export async function getAdminAlertCenter():Promise<AdminAlertCenter>{
  const supabase=getSupabaseBrowserClient() as any;
  const {data,error}=await supabase.rpc("get_admin_alert_center");
  if(error) throw new Error(error.message);
  const value=(data||{}) as Partial<AdminAlertCenter>;
  return {
    tasks:Array.isArray(value.tasks)?value.tasks:[],
    payments:Array.isArray(value.payments)?value.payments:[],
    feedback:Array.isArray(value.feedback)?value.feedback:[],
    visits:Array.isArray(value.visits)?value.visits:[],
  };
}

export { empty as emptyAdminAlertCenter };
