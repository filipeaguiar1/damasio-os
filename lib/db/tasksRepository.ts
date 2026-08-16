import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type AdminTaskPhoto = {
  id: string;
  storagePath: string;
  type: string;
  caption: string | null;
  createdAt: string;
};

export type AdminLiveTask = {
  id: string;
  customerId: string;
  propertyId: string;
  title: string;
  issue: string;
  priority: "low" | "normal" | "urgent";
  status: string;
  scheduledDate: string | null;
  createdAt: string;
  assignedAt: string | null;
  workStartedAt: string | null;
  workFinishedAt: string | null;
  resolvedAt: string | null;
  adminResolvedAt: string | null;
  durationSeconds: number | null;
  completionSummary: string | null;
  customerName: string;
  address: string;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  employeeName: string | null;
  crewName: string | null;
  photos: AdminTaskPhoto[];
};

export type AdminTaskProperty = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string | null;
  address: string;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  photoUrl: string | null;
};

export type AdminTaskWorker = {
  id: string;
  name: string;
  kind: "employee" | "crew";
};

export type AdminTaskWorkspace = {
  tasks: AdminLiveTask[];
  properties: AdminTaskProperty[];
  workers: AdminTaskWorker[];
};

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function nullable(value: unknown) {
  const result = text(value).trim();
  return result || null;
}

function normalizeTask(row: any): AdminLiveTask {
  return {
    id: text(row.id),
    customerId: text(row.customer_id ?? row.customerId),
    propertyId: text(row.property_id ?? row.propertyId),
    title: text(row.title),
    issue: text(row.customer_issue ?? row.issue),
    priority: (["low", "normal", "urgent"].includes(text(row.priority)) ? text(row.priority) : "normal") as AdminLiveTask["priority"],
    status: text(row.status || "open"),
    scheduledDate: nullable(row.scheduled_date ?? row.scheduledDate),
    createdAt: text(row.created_at ?? row.createdAt),
    assignedAt: nullable(row.assigned_at ?? row.assignedAt),
    workStartedAt: nullable(row.work_started_at ?? row.workStartedAt),
    workFinishedAt: nullable(row.work_finished_at ?? row.workFinishedAt),
    resolvedAt: nullable(row.resolved_at ?? row.resolvedAt),
    adminResolvedAt: nullable(row.admin_resolved_at ?? row.adminResolvedAt),
    durationSeconds: row.completion_duration_seconds == null ? null : Number(row.completion_duration_seconds),
    completionSummary: nullable(row.completion_summary ?? row.completionSummary),
    customerName: text((row.customer_name ?? row.customerName) || "Customer"),
    address: text((row.address_line1 ?? row.address) || "Property"),
    city: nullable(row.city),
    province: nullable(row.province),
    postalCode: nullable(row.postal_code ?? row.postalCode),
    employeeName: nullable(row.employee_name ?? row.employeeName),
    crewName: nullable(row.crew_name ?? row.crewName),
    photos: Array.isArray(row.photos) ? row.photos.map((photo: any) => ({
      id: text(photo.id),
      storagePath: text(photo.storagePath ?? photo.storage_path),
      type: text(photo.type ?? photo.photo_type),
      caption: nullable(photo.caption),
      createdAt: text(photo.createdAt ?? photo.created_at),
    })) : [],
  };
}

function normalizeProperty(row: any): AdminTaskProperty {
  return {
    id: text(row.id),
    customerId: text(row.customerId ?? row.customer_id),
    customerName: text((row.customerName ?? row.customer_name) || "Customer"),
    customerEmail: nullable(row.customerEmail ?? row.customer_email),
    address: text((row.address ?? row.address_line1) || "Property"),
    city: nullable(row.city),
    province: nullable(row.province),
    postalCode: nullable(row.postalCode ?? row.postal_code),
    photoUrl: nullable(row.photoUrl ?? row.photo_url),
  };
}

export async function getAdminTaskWorkspace(): Promise<AdminTaskWorkspace> {
  if (!isSupabaseConfigured()) return { tasks: [], properties: [], workers: [] };
  const supabase = getSupabaseBrowserClient() as any;
  const [board, properties, workers] = await Promise.all([
    supabase.rpc("get_live_task_board"),
    supabase.rpc("get_admin_task_properties"),
    supabase.rpc("get_task_dispatch_workers"),
  ]);
  if (board.error) throw new Error(board.error.message);
  if (properties.error) throw new Error(properties.error.message);
  if (workers.error) throw new Error(workers.error.message);

  const workerData = workers.data || {};
  return {
    tasks: Array.isArray(board.data?.tasks) ? board.data.tasks.map(normalizeTask) : [],
    properties: Array.isArray(properties.data) ? properties.data.map(normalizeProperty) : [],
    workers: [
      ...(Array.isArray(workerData.employees) ? workerData.employees.map((row: any) => ({ id: text(row.id), name: text(row.name), kind: "employee" as const })) : []),
      ...(Array.isArray(workerData.crews) ? workerData.crews.map((row: any) => ({ id: text(row.id), name: text(row.name), kind: "crew" as const })) : []),
    ],
  };
}

export async function createAdminLiveTask(input: {
  propertyId: string;
  title: string;
  issue: string;
  priority: "low" | "normal" | "urgent";
  scheduledDate?: string | null;
}) {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase.rpc("create_admin_task", {
    p_property_id: input.propertyId,
    p_title: input.title.trim(),
    p_issue: input.issue.trim(),
    p_priority: input.priority,
    p_scheduled_date: input.scheduledDate || null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function assignLiveTask(taskId: string, target: AdminTaskWorker, scheduledDate?: string | null) {
  const supabase = getSupabaseBrowserClient() as any;
  const { error } = await supabase.rpc("assign_task", {
    p_task_id: taskId,
    p_employee_id: target.kind === "employee" ? target.id : null,
    p_crew_id: target.kind === "crew" ? target.id : null,
    p_scheduled_date: scheduledDate || null,
  });
  if (error) throw new Error(error.message);
}

export async function unassignLiveTask(taskId: string) {
  const supabase = getSupabaseBrowserClient() as any;
  const { error } = await supabase.rpc("unassign_task", { p_task_id: taskId });
  if (error) throw new Error(error.message);
}

export async function resolveLiveTask(taskId: string, summary?: string | null) {
  const supabase = getSupabaseBrowserClient() as any;
  const { error } = await supabase.rpc("resolve_completed_task", {
    p_task_id: taskId,
    p_summary: summary?.trim() || null,
  });
  if (error) throw new Error(error.message);
}
