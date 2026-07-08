import { getSupabaseBrowserClient, isSupabaseConfigured } from "../supabase/client";
import type { Task } from "../supabase/database.types";

export async function listAdminOpenTasks() {
  if (!isSupabaseConfigured()) return [] as Task[];
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .in("status", ["open", "assigned", "in_progress", "returned_to_admin"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function assignTaskToEmployee(taskId: string, employeeId: string, crewId: string | null, scheduledDate: string) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("tasks")
    .update({
      assigned_employee_id: employeeId,
      assigned_crew_id: crewId,
      scheduled_date: scheduledDate,
      assigned_at: new Date().toISOString(),
      status: "assigned",
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function returnTaskToAdmin(taskId: string) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("tasks")
    .update({
      assigned_employee_id: null,
      assigned_crew_id: null,
      scheduled_date: null,
      returned_at: new Date().toISOString(),
      status: "returned_to_admin",
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function completeTask(taskId: string, summary: string) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("tasks")
    .update({
      completion_summary: summary,
      resolved_at: new Date().toISOString(),
      status: "resolved",
    })
    .eq("id", taskId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
