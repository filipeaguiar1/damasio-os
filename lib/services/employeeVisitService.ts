import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

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
