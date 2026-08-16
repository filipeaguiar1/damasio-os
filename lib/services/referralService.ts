import {
  listCompanyReferrals,
  respondCompanyReferral,
  type CompanyReferral,
  type CompanyReferralDecisionResult,
} from "@/lib/repositories/referralRepository";
import { addCustomerWithProperty } from "@/lib/services/customerPropertyService";

function frequency(service?: string) {
  const value = (service || "").toLowerCase();
  return value.includes("biweekly") || value.includes("bi-weekly")
    ? "biweekly" as const
    : value.includes("monthly")
      ? "monthly" as const
      : value.includes("weekly")
        ? "weekly" as const
        : "one_time" as const;
}

function readDemo(): CompanyReferral[] {
  try {
    return (JSON.parse(localStorage.getItem("damasio_master_leads") || "[]") as any[])
      .filter((item) => item.assigned_company_id === "demo-company")
      .map((item) => ({
        id: item.id,
        fullName: item.full_name,
        email: item.email,
        phone: item.phone,
        address: item.address,
        serviceRequested: item.service_requested,
        notes: item.notes,
        status: item.status,
        createdAt: item.created_at,
      }));
  } catch {
    return [];
  }
}

export async function loadCompanyReferrals() {
  try {
    return await listCompanyReferrals();
  } catch {
    return typeof window !== "undefined" ? readDemo() : [];
  }
}

export async function answerCompanyReferral(
  referral: CompanyReferral,
  accept: boolean,
): Promise<CompanyReferralDecisionResult> {
  try {
    return await respondCompanyReferral(referral.id, accept);
  } catch (error) {
    if (typeof window === "undefined" || referral.id !== String(referral.id) || !readDemo().some((item) => item.id === referral.id)) {
      throw error;
    }

    if (accept) {
      await addCustomerWithProperty({
        fullName: referral.fullName,
        email: referral.email,
        phone: referral.phone,
        addressLine1: referral.address || "Address pending",
        customerNotes: `Master referral ${referral.id}${referral.notes ? ` | ${referral.notes}` : ""}`,
        serviceName: referral.serviceRequested || "Property Service",
        frequency: frequency(referral.serviceRequested),
        subtotal: 0,
      });
    }

    const rows = readDemo().map((item) => item.id === referral.id
      ? { ...item, status: accept ? "converted" : "declined" }
      : item);
    try {
      const raw = JSON.parse(localStorage.getItem("damasio_master_leads") || "[]") as any[];
      localStorage.setItem("damasio_master_leads", JSON.stringify(raw.map((item) => item.id === referral.id
        ? { ...item, status: accept ? "converted" : "declined", accepted_at: accept ? new Date().toISOString() : undefined }
        : item)));
    } catch {}

    return {
      referrals: rows,
      accepted: accept,
      inviteSent: false,
      accessMethod: "demo",
      accessWarning: null,
      message: accept
        ? `${referral.fullName} accepted in demo mode.`
        : `${referral.fullName} declined in demo mode.`,
    };
  }
}
