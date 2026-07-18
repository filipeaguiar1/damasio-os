import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { EmployeeTask } from "@/lib/storage";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export async function loadAssignedEmployeeTasks(): Promise<EmployeeTask[]> {
  const supabase = getSupabaseBrowserClient() as any;
  const { data, error } = await supabase
    .from("tasks")
    .select("id,created_at,property_id,title,customer_issue,status,priority,scheduled_date,assigned_at,resolved_at,completion_summary,properties(address_line1,customers(full_name)),employees(full_name),crews(name)")
    .in("status", ["assigned", "in_progress", "returned_to_admin"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => {
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    const customerRecord = Array.isArray(property?.customers) ? property.customers[0] : property?.customers;
    const employee = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const crew = Array.isArray(row.crews) ? row.crews[0] : row.crews;
    return {
      id: row.id,
      createdAt: row.created_at,
      leadId: row.property_id || "",
      customer: customerRecord?.full_name || "Customer",
      address: property?.address_line1 || "",
      title: row.title,
      description: row.customer_issue,
      status: row.status === "returned_to_admin" ? "open" : row.status,
      priority: row.priority,
      assignedTo: employee?.full_name || crew?.name || "Employee",
      scheduledDate: row.scheduled_date || undefined,
      assignedAt: row.assigned_at || undefined,
      resolvedAt: row.resolved_at || undefined,
      completionSummary: row.completion_summary || undefined,
      source: "customer" as const,
    } as EmployeeTask;
  });
}

export async function updateAssignedEmployeeTask(taskId: string, status: "in_progress" | "returned_to_admin" | "resolved", completionSummary?: string) {
  const supabase = getSupabaseBrowserClient() as any;
  const patch: Record<string, unknown> = { status };
  if (status === "in_progress") patch.assigned_at = new Date().toISOString();
  if (status === "returned_to_admin") patch.returned_at = new Date().toISOString();
  if (status === "resolved") {
    patch.resolved_at = new Date().toISOString();
    patch.completion_summary = completionSummary?.trim() || null;
  }
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) throw new Error(error.message);
}

export async function saveEmployeeVisitNote(visitId: string, note: string) {
  const value = note.trim();
  if (!visitId) throw new Error("Visit is required.");
  if (!value) throw new Error("Type a comment before saving.");
  if (value.length > 2000) throw new Error("Comment is too long.");
  const supabase = getSupabaseBrowserClient() as any;
  const { error } = await supabase.from("visits").update({ employee_notes: value }).eq("id", visitId);
  if (error) throw new Error(error.message);
}

export async function uploadEmployeeVisitPhoto(visitId: string, file: File, photoType: "before" | "after" | "issue" | "completion" = "completion") {
  if (!visitId) throw new Error("Visit is required.");
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Photo must be smaller than 8 MB.");

  const supabase = getSupabaseBrowserClient() as any;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user?.id) throw new Error("Your Employee session is invalid. Sign in again.");

  const { data: visit, error: visitError } = await supabase
    .from("visits")
    .select("id,company_id,property_id")
    .eq("id", visitId)
    .maybeSingle();
  if (visitError) throw new Error(visitError.message);
  if (!visit?.company_id) throw new Error("Visit is not available for this Employee.");

  const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const storagePath = `${visit.company_id}/${visitId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("work-photos").upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const publicUrl = supabase.storage.from("work-photos").getPublicUrl(storagePath).data.publicUrl as string;

  const { error: recordError } = await supabase.from("photos").insert({
    organization_id: visit.company_id,
    company_id: visit.company_id,
    property_id: visit.property_id,
    visit_id: visitId,
    uploaded_by: auth.user.id,
    storage_path: storagePath,
    public_url: publicUrl,
    photo_type: photoType,
  });
  if (recordError) {
    await supabase.storage.from("work-photos").remove([storagePath]);
    throw new Error(recordError.message);
  }
  return publicUrl;
}
