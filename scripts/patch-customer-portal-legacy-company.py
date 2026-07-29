from pathlib import Path

path = Path("lib/repositories/customerPortalRepository.ts")
text = path.read_text()
changed = False

anchor = '''async function getCustomerFallbackIdentity(supabase: any, board: CustomerPortalBoard) {'''
helper = '''async function insertCustomerScoped(supabase: any, table: string, row: Record<string, unknown>) {
  let result = await supabase.from(table).insert(row);
  const missingCompanyColumn = result.error
    && /could not find the ['\"]company_id['\"] column|company_id.*schema cache/i.test(String(result.error.message || ""));
  if (missingCompanyColumn) {
    const { company_id: _companyId, ...legacyRow } = row;
    result = await supabase.from(table).insert(legacyRow);
  }
  if (result.error) throw new Error(result.error.message);
}

async function getCustomerFallbackIdentity(supabase: any, board: CustomerPortalBoard) {'''

if anchor in text and "async function insertCustomerScoped" not in text:
    text = text.replace(anchor, helper, 1)
    changed = True

replacements = [
    (
'''  const request = await supabase.from("service_requests").insert({
    organization_id: identity.companyId,
    company_id: identity.companyId,
    customer_id: identity.customerId,
    property_id: identity.propertyId,
    service_name: input.serviceName.trim(),
    message: input.message?.trim() || null,
    status: "pending",
  });
  if (request.error) throw new Error(request.error.message);''',
'''  await insertCustomerScoped(supabase, "service_requests", {
    organization_id: identity.companyId,
    company_id: identity.companyId,
    customer_id: identity.customerId,
    property_id: identity.propertyId,
    service_name: input.serviceName.trim(),
    message: input.message?.trim() || null,
    status: "pending",
  });''',
    ),
    (
'''  const feedback = await supabase.from("feedback").insert({
    organization_id: identity.companyId,
    company_id: identity.companyId,
    customer_id: identity.customerId,
    property_id: identity.propertyId,
    visit_id: input.visitId || null,
    task_id: input.taskId || null,
    rating: input.rating,
    comment: input.comment?.trim() || null,
  });
  if (feedback.error) throw new Error(feedback.error.message);''',
'''  await insertCustomerScoped(supabase, "feedback", {
    organization_id: identity.companyId,
    company_id: identity.companyId,
    customer_id: identity.customerId,
    property_id: identity.propertyId,
    visit_id: input.visitId || null,
    task_id: input.taskId || null,
    rating: input.rating,
    comment: input.comment?.trim() || null,
  });''',
    ),
    (
'''    const followUp = await supabase.from("tasks").insert({
      organization_id: identity.companyId,
      company_id: identity.companyId,
      customer_id: identity.customerId,
      property_id: identity.propertyId,
      source_visit_id: input.visitId || null,
      title: "Customer feedback follow-up",
      customer_issue: input.comment.trim(),
      priority: "urgent",
      status: "open",
    });
    if (followUp.error) throw new Error(followUp.error.message);''',
'''    await insertCustomerScoped(supabase, "tasks", {
      organization_id: identity.companyId,
      company_id: identity.companyId,
      customer_id: identity.customerId,
      property_id: identity.propertyId,
      source_visit_id: input.visitId || null,
      title: "Customer feedback follow-up",
      customer_issue: input.comment.trim(),
      priority: "urgent",
      status: "open",
    });''',
    ),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new, 1)
        changed = True

if changed:
    path.write_text(text)

print("changed" if changed else "already-fixed")
