from pathlib import Path

path = Path("lib/repositories/customerPortalRepository.ts")
text = path.read_text()

old = '''export function submitCustomerPortalFeedback(input: { visitId?: string; taskId?: string; rating: number; comment?: string }) {
  return rpcBoard("submit_customer_portal_feedback", {
    p_visit_id: input.visitId || null,
    p_task_id: input.taskId || null,
    p_rating: input.rating,
    p_comment: input.comment || null,
  });
}
'''

new = '''export async function submitCustomerPortalFeedback(input: { visitId?: string; taskId?: string; rating: number; comment?: string }) {
  const supabase = getSupabaseBrowserClient() as any;
  const args = {
    p_visit_id: input.visitId || null,
    p_task_id: input.taskId || null,
    p_rating: input.rating,
    p_comment: input.comment || null,
  };
  const rpc = await supabase.rpc("submit_customer_portal_feedback", args);
  if (!rpc.error) return normalizeBoard(rpc.data || emptyBoard);

  const missingRpc = rpc.error.code === "PGRST202"
    || /could not find the function public\\.submit_customer_portal_feedback|schema cache/i.test(String(rpc.error.message || ""));
  if (!missingRpc) throw new Error(rpc.error.message);

  const sourceTable = input.visitId ? "visits" : "tasks";
  const sourceId = input.visitId || input.taskId;
  if (!sourceId) throw new Error("Choose a completed item first.");
  const source = await supabase
    .from(sourceTable)
    .select("id,company_id,organization_id,customer_id,property_id")
    .eq("id", sourceId)
    .maybeSingle();
  if (source.error) throw new Error(source.error.message);
  if (!source.data?.customer_id || !source.data?.property_id) throw new Error("Completed item is not linked to this customer property.");

  const companyId = source.data.company_id || source.data.organization_id;
  if (!companyId) throw new Error("Completed item has no company identity.");
  const feedback = await supabase.from("feedback").insert({
    organization_id: companyId,
    company_id: companyId,
    customer_id: source.data.customer_id,
    property_id: source.data.property_id,
    visit_id: input.visitId || null,
    task_id: input.taskId || null,
    rating: input.rating,
    comment: input.comment?.trim() || null,
  });
  if (feedback.error) throw new Error(feedback.error.message);

  if (input.rating <= 3 && input.comment?.trim()) {
    const followUp = await supabase.from("tasks").insert({
      organization_id: companyId,
      company_id: companyId,
      customer_id: source.data.customer_id,
      property_id: source.data.property_id,
      source_visit_id: input.visitId || null,
      title: "Customer feedback follow-up",
      customer_issue: input.comment.trim(),
      priority: "urgent",
      status: "open",
    });
    if (followUp.error) throw new Error(followUp.error.message);
  }

  return getCustomerPortalBoard();
}
'''

if old not in text:
    print("already-fixed")
else:
    path.write_text(text.replace(old, new, 1))
    print("changed")
