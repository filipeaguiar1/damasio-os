from pathlib import Path

path = Path("lib/repositories/customerPortalRepository.ts")
text = path.read_text()

old = '''export function createCustomerPortalRequest(input: { serviceName: string; message?: string }) {
  return rpcBoard("create_customer_portal_request", {
    p_service_name: input.serviceName,
    p_message: input.message || null,
  });
}
'''

new = '''export async function createCustomerPortalRequest(input: { serviceName: string; message?: string }) {
  const supabase = getSupabaseBrowserClient() as any;
  const rpc = await supabase.rpc("create_customer_portal_request", {
    p_service_name: input.serviceName,
    p_message: input.message || null,
  });
  if (!rpc.error) return normalizeBoard(rpc.data || emptyBoard);

  const missingRpc = rpc.error.code === "PGRST202"
    || /could not find the function public\\.create_customer_portal_request|schema cache/i.test(String(rpc.error.message || ""));
  if (!missingRpc) throw new Error(rpc.error.message);

  const board = await getCustomerPortalBoard();
  if (!board.property?.propertyId || !board.property.customerId) {
    throw new Error("Customer property not found for this account.");
  }
  const property = await supabase
    .from("properties")
    .select("id,company_id,organization_id,customer_id")
    .eq("id", board.property.propertyId)
    .maybeSingle();
  if (property.error) throw new Error(property.error.message);
  if (!property.data || property.data.customer_id !== board.property.customerId) {
    throw new Error("Customer property identity does not match this account.");
  }
  const companyId = property.data.company_id || property.data.organization_id;
  if (!companyId) throw new Error("Customer property has no company identity.");

  const request = await supabase.from("service_requests").insert({
    organization_id: companyId,
    company_id: companyId,
    customer_id: board.property.customerId,
    property_id: board.property.propertyId,
    service_name: input.serviceName.trim(),
    message: input.message?.trim() || null,
    status: "pending",
  });
  if (request.error) throw new Error(request.error.message);
  return getCustomerPortalBoard();
}
'''

if old not in text:
    print("already-fixed")
else:
    path.write_text(text.replace(old, new, 1))
    print("changed")
