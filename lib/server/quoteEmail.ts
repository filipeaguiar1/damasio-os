type QuoteAlertStage = "prequote" | "complete";

type QuoteAlertInput = {
  stage: QuoteAlertStage;
  name: string;
  email: string;
  phone?: string;
  address: string;
  service: string;
  estimatedTotal?: number | null;
  leadId?: string | null;
  companyName?: string | null;
};

const SUPPORT_EMAIL = "support@4everseasons.com";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char] || char));
}

export async function sendQuoteAlert(input: QuoteAlertInput) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Quote alert skipped: RESEND_API_KEY is not configured", { stage: input.stage, leadId: input.leadId || null });
    return false;
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.4everseasons.com").replace(/\/$/, "");
  const adminUrl = `${siteUrl}/master`;
  const isComplete = input.stage === "complete";
  const heading = isComplete ? "New completed quote request" : "New pre-quote viewed";
  const subject = isComplete ? `New completed quote: ${input.service}` : `New pre-quote: ${input.service}`;
  const estimate = typeof input.estimatedTotal === "number" ? `$${input.estimatedTotal.toFixed(2)}` : "Admin review";
  const from = process.env.CONTACT_FROM_EMAIL || "4Ever Seasons <no-reply@auth.4everseasons.com>";

  const html = `<div style="font-family:Arial,sans-serif;color:#17231d;line-height:1.6;max-width:640px">
    <h2 style="margin-bottom:8px">${escapeHtml(heading)}</h2>
    <p style="margin-top:0;color:#5d6d64">A customer ${isComplete ? "submitted a quote for Admin review" : "reached the quote review screen"} on 4everseasons.com.</p>
    <table style="border-collapse:collapse;width:100%;margin:20px 0">
      <tr><td style="padding:7px 0;color:#67766e">Customer</td><td style="padding:7px 0;font-weight:700">${escapeHtml(input.name)}</td></tr>
      <tr><td style="padding:7px 0;color:#67766e">Service</td><td style="padding:7px 0;font-weight:700">${escapeHtml(input.service)}</td></tr>
      <tr><td style="padding:7px 0;color:#67766e">Property</td><td style="padding:7px 0;font-weight:700">${escapeHtml(input.address)}</td></tr>
      <tr><td style="padding:7px 0;color:#67766e">Estimate shown</td><td style="padding:7px 0;font-weight:700">${escapeHtml(estimate)}</td></tr>
      <tr><td style="padding:7px 0;color:#67766e">Email</td><td style="padding:7px 0">${escapeHtml(input.email)}</td></tr>
      ${input.phone ? `<tr><td style="padding:7px 0;color:#67766e">Phone</td><td style="padding:7px 0">${escapeHtml(input.phone)}</td></tr>` : ""}
      ${input.companyName ? `<tr><td style="padding:7px 0;color:#67766e">Company route</td><td style="padding:7px 0">${escapeHtml(input.companyName)}</td></tr>` : ""}
    </table>
    <p><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#0f5132;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open Master Admin</a></p>
    <p style="font-size:12px;color:#718078">This email is an alert only. The platform remains the source of record for quote details.</p>
  </div>`;

  try {
    const payload: Record<string, unknown> = {
      from,
      to: [SUPPORT_EMAIL],
      subject,
      html,
      reply_to: input.email,
    };
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.error("Quote alert delivery failed", { stage: input.stage, leadId: input.leadId || null, status: response.status, detail: await response.text() });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Quote alert delivery error", { stage: input.stage, leadId: input.leadId || null, error });
    return false;
  }
}
