import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type CustomerIdentity = {
  profileId: string;
  customerId: string;
  companyId: string;
};

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function serverClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Customer portal actions are not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

function missingColumn(message?: string, column?: string) {
  const value = String(message || "");
  return /schema cache|does not exist|could not find/i.test(value)
    && (!column || value.toLowerCase().includes(column.toLowerCase()));
}

async function insertCompanyCompatible(db: any, table: string, row: Record<string, unknown>) {
  let result = await db.from(table).insert(row);
  if (result.error && missingColumn(result.error.message, "company_id")) {
    const { company_id: _companyId, ...legacyRow } = row;
    result = await db.from(table).insert(legacyRow);
  }
  if (result.error) throw new Error(`${table}: ${result.error.message}`);
}

async function resolveCustomer(db: any, token: string): Promise<CustomerIdentity> {
  const auth = await db.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your customer session expired. Sign in again.");

  const profile = await db.from("profiles")
    .select("id,role,active,company_id,organization_id,email")
    .eq("id", auth.data.user.id)
    .maybeSingle();
  if (profile.error) throw new Error(profile.error.message);
  if (!profile.data?.active || profile.data.role !== "customer") {
    throw new Error("Only an active Customer account can use this action.");
  }

  const metadataCustomerId = auth.data.user.user_metadata?.customer_id;
  let customer: any = null;

  if (metadataCustomerId) {
    const byMetadata = await db.from("customers")
      .select("id,profile_id,email,company_id,organization_id,archived_at")
      .eq("id", metadataCustomerId)
      .maybeSingle();
    if (!byMetadata.error) customer = byMetadata.data;
  }

  if (!customer) {
    const byProfile = await db.from("customers")
      .select("id,profile_id,email,company_id,organization_id,archived_at")
      .eq("profile_id", auth.data.user.id)
      .maybeSingle();
    if (!byProfile.error) customer = byProfile.data;
  }

  if (!customer && auth.data.user.email) {
    const byEmail = await db.from("customers")
      .select("id,profile_id,email,company_id,organization_id,archived_at")
      .ilike("email", auth.data.user.email.trim())
      .limit(1)
      .maybeSingle();
    if (!byEmail.error) customer = byEmail.data;
  }

  if (!customer || customer.archived_at) throw new Error("Customer record was not found for this account.");

  const profileCompanyId = profile.data.company_id || profile.data.organization_id;
  const customerCompanyId = customer.company_id || customer.organization_id;
  const metadataCompanyId = auth.data.user.user_metadata?.company_id;
  const companyId = String(profileCompanyId || customerCompanyId || metadataCompanyId || "");
  if (!companyId) throw new Error("Customer account has no company identity.");
  if (customerCompanyId && String(customerCompanyId) !== companyId) {
    throw new Error("Customer company identity does not match the signed-in account.");
  }

  if (!customer.profile_id) {
    await db.from("customers").update({ profile_id: auth.data.user.id }).eq("id", customer.id).is("profile_id", null);
  } else if (String(customer.profile_id) !== String(auth.data.user.id)) {
    throw new Error("Customer record is linked to a different account.");
  }

  return {
    profileId: String(auth.data.user.id),
    customerId: String(customer.id),
    companyId,
  };
}

async function validateProperty(db: any, identity: CustomerIdentity, propertyId: string) {
  let query = db.from("properties")
    .select("id,customer_id,company_id,organization_id")
    .eq("id", propertyId)
    .eq("customer_id", identity.customerId)
    .maybeSingle();
  let result = await query;
  if (result.error && missingColumn(result.error.message, "company_id")) {
    result = await db.from("properties")
      .select("id,customer_id,organization_id")
      .eq("id", propertyId)
      .eq("customer_id", identity.customerId)
      .maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Property does not belong to this Customer.");
  const companyId = result.data.company_id || result.data.organization_id;
  if (companyId && String(companyId) !== identity.companyId) throw new Error("Property belongs to a different company.");
  return result.data;
}

async function validateFeedbackSource(
  db: any,
  identity: CustomerIdentity,
  input: { visitId?: string; taskId?: string },
) {
  if (Boolean(input.visitId) === Boolean(input.taskId)) {
    throw new Error("Choose exactly one completed Visit or resolved Task.");
  }

  if (input.visitId) {
    let result = await db.from("visits")
      .select("id,customer_id,property_id,company_id,organization_id,status")
      .eq("id", input.visitId)
      .eq("customer_id", identity.customerId)
      .maybeSingle();
    if (result.error && missingColumn(result.error.message, "company_id")) {
      result = await db.from("visits")
        .select("id,customer_id,property_id,organization_id,status")
        .eq("id", input.visitId)
        .eq("customer_id", identity.customerId)
        .maybeSingle();
    }
    if (result.error) throw new Error(result.error.message);
    if (!result.data || result.data.status !== "completed") throw new Error("Completed Visit was not found for this Customer.");
    const companyId = result.data.company_id || result.data.organization_id;
    if (companyId && String(companyId) !== identity.companyId) throw new Error("Visit belongs to a different company.");
    return { propertyId: String(result.data.property_id), visitId: String(result.data.id), taskId: null };
  }

  let result = await db.from("tasks")
    .select("id,customer_id,property_id,company_id,organization_id,status")
    .eq("id", input.taskId)
    .eq("customer_id", identity.customerId)
    .maybeSingle();
  if (result.error && missingColumn(result.error.message, "company_id")) {
    result = await db.from("tasks")
      .select("id,customer_id,property_id,organization_id,status")
      .eq("id", input.taskId)
      .eq("customer_id", identity.customerId)
      .maybeSingle();
  }
  if (result.error) throw new Error(result.error.message);
  if (!result.data || result.data.status !== "resolved") throw new Error("Resolved Task was not found for this Customer.");
  const companyId = result.data.company_id || result.data.organization_id;
  if (companyId && String(companyId) !== identity.companyId) throw new Error("Task belongs to a different company.");
  return { propertyId: String(result.data.property_id), visitId: null, taskId: String(result.data.id) };
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return failure("Sign in as the Customer to continue.", 401);

    const db = serverClient();
    const identity = await resolveCustomer(db, token);
    const body = await request.json() as {
      action?: "feedback" | "request";
      visitId?: string;
      taskId?: string;
      propertyId?: string;
      rating?: number;
      comment?: string;
      serviceName?: string;
      message?: string;
    };

    if (body.action === "feedback") {
      const rating = Number(body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return failure("Rating must be between 1 and 5.", 400);
      }
      const source = await validateFeedbackSource(db, identity, { visitId: body.visitId, taskId: body.taskId });
      await validateProperty(db, identity, source.propertyId);
      await insertCompanyCompatible(db, "feedback", {
        id: randomUUID(),
        organization_id: identity.companyId,
        company_id: identity.companyId,
        customer_id: identity.customerId,
        property_id: source.propertyId,
        visit_id: source.visitId,
        task_id: source.taskId,
        rating,
        comment: body.comment?.trim() || null,
      });

      if (rating <= 3 && body.comment?.trim()) {
        await insertCompanyCompatible(db, "tasks", {
          id: randomUUID(),
          organization_id: identity.companyId,
          company_id: identity.companyId,
          customer_id: identity.customerId,
          property_id: source.propertyId,
          source_visit_id: source.visitId,
          title: "Customer feedback follow-up",
          customer_issue: body.comment.trim(),
          priority: "urgent",
          status: "open",
        });
      }
      return NextResponse.json({ saved: true, action: "feedback" });
    }

    if (body.action === "request") {
      const serviceName = body.serviceName?.trim();
      if (!serviceName) return failure("Choose a service first.", 400);
      if (!body.propertyId) return failure("Customer property is required.", 400);
      await validateProperty(db, identity, body.propertyId);
      await insertCompanyCompatible(db, "service_requests", {
        id: randomUUID(),
        organization_id: identity.companyId,
        company_id: identity.companyId,
        customer_id: identity.customerId,
        property_id: body.propertyId,
        service_name: serviceName,
        message: body.message?.trim() || null,
        status: "pending",
      });
      return NextResponse.json({ saved: true, action: "request" });
    }

    return failure("Unsupported Customer portal action.", 400);
  } catch (error) {
    console.error("customer-portal-action", error);
    const message = error instanceof Error ? error.message : "Customer portal action failed.";
    const status = /session expired|sign in/i.test(message) ? 401 : /different|does not belong|only an active/i.test(message) ? 403 : 400;
    return failure(message, status);
  }
}
