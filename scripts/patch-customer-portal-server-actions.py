from pathlib import Path

path = Path("lib/repositories/customerPortalRepository.ts")
text = path.read_text()
changed = False

helper_start = text.find("async function insertCustomerScoped")
request_start = text.find("export async function createCustomerPortalRequest")
if helper_start >= 0 and request_start > helper_start:
    helper = '''async function callCustomerPortalAction(body: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient() as any;
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error("Customer session expired.");
  const response = await fetch("/api/customer/portal-actions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Customer portal action failed.");
  return getCustomerPortalBoard();
}

'''
    text = text[:helper_start] + helper + text[request_start:]
    changed = True

request_old_start = text.find("export async function createCustomerPortalRequest")
feedback_start = text.find("export async function submitCustomerPortalFeedback")
if request_old_start >= 0 and feedback_start > request_old_start:
    request_new = '''export async function createCustomerPortalRequest(input: { serviceName: string; message?: string }) {
  const supabase = getSupabaseBrowserClient() as any;
  const rpc = await supabase.rpc("create_customer_portal_request", {
    p_service_name: input.serviceName,
    p_message: input.message || null,
  });
  if (!rpc.error) return normalizeBoard(rpc.data || emptyBoard);

  const fallbackAllowed = rpc.error.code === "PGRST202"
    || /could not find the function public\\.create_customer_portal_request|schema cache|permission denied/i.test(String(rpc.error.message || ""));
  if (!fallbackAllowed) throw new Error(rpc.error.message);

  const board = await getCustomerPortalBoard();
  if (!board.property?.propertyId) throw new Error("Customer property not found for this account.");
  return callCustomerPortalAction({
    action: "request",
    propertyId: board.property.propertyId,
    serviceName: input.serviceName,
    message: input.message || null,
  });
}

'''
    text = text[:request_old_start] + request_new + text[feedback_start:]
    changed = True

feedback_start = text.find("export async function submitCustomerPortalFeedback")
if feedback_start >= 0:
    feedback_new = '''export async function submitCustomerPortalFeedback(input: { visitId?: string; taskId?: string; rating: number; comment?: string }) {
  const supabase = getSupabaseBrowserClient() as any;
  const args = {
    p_visit_id: input.visitId || null,
    p_task_id: input.taskId || null,
    p_rating: input.rating,
    p_comment: input.comment || null,
  };
  const rpc = await supabase.rpc("submit_customer_portal_feedback", args);
  if (!rpc.error) return normalizeBoard(rpc.data || emptyBoard);

  const fallbackAllowed = rpc.error.code === "PGRST202"
    || /could not find the function public\\.submit_customer_portal_feedback|schema cache|permission denied/i.test(String(rpc.error.message || ""));
  if (!fallbackAllowed) throw new Error(rpc.error.message);

  return callCustomerPortalAction({
    action: "feedback",
    visitId: input.visitId || null,
    taskId: input.taskId || null,
    rating: input.rating,
    comment: input.comment || null,
  });
}
'''
    text = text[:feedback_start] + feedback_new
    changed = True

if changed:
    path.write_text(text)

print("changed" if changed else "already-fixed")
