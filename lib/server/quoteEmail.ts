type QuoteAlertStage = "complete";

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

const SUPPORT_EMAIL = process.env.QUOTE_ALERT_TO_EMAIL || "support@4everseasons.com";

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
  const logoUrl = `${siteUrl}/brand/4ever-seasons-logo-mark.jpg`;
  const estimate = typeof input.estimatedTotal === "number" ? `$${input.estimatedTotal.toFixed(2)}` : "Admin review required";
  const from = process.env.CONTACT_FROM_EMAIL || "4Ever Seasons <no-reply@auth.4everseasons.com>";
  const subject = `New quote request — ${input.service}`;

  const phoneRow = input.phone ? `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;">Phone</td>
    <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(input.phone)}</td>
  </tr>` : "";

  const companyRow = input.companyName ? `<tr>
    <td style="padding:12px 0;color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;">Company route</td>
    <td style="padding:12px 0;color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(input.companyName)}</td>
  </tr>` : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef2ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#eef2ef;">
    <tr>
      <td align="center" style="padding-top:34px;padding-right:16px;padding-bottom:34px;padding-left:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dce4df;border-radius:18px;overflow:hidden;">
          <tr>
            <td bgcolor="#0d3024" style="background-color:#0d3024;padding-top:24px;padding-right:28px;padding-bottom:24px;padding-left:28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td width="64" valign="middle" style="width:64px;">
                    <img src="${escapeHtml(logoUrl)}" width="52" height="52" border="0" alt="4 Ever Seasons" style="display:block;width:52px;height:52px;border-radius:10px;">
                  </td>
                  <td valign="middle" style="padding-left:12px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.2;font-weight:800;color:#ffffff;">4 Ever Seasons</div>
                    <div style="padding-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;font-weight:700;letter-spacing:1.2px;color:#bfd6c8;text-transform:uppercase;">Property Maintenance</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top:30px;padding-right:30px;padding-bottom:10px;padding-left:30px;">
              <div style="display:inline-block;padding-top:7px;padding-right:10px;padding-bottom:7px;padding-left:10px;border-radius:999px;background-color:#e9f3ed;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1;font-weight:800;letter-spacing:1px;color:#176044;text-transform:uppercase;">New quote request</div>
              <h1 style="margin-top:16px;margin-right:0;margin-bottom:8px;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:29px;line-height:1.15;font-weight:800;color:#14291f;">A customer submitted a quote.</h1>
              <p style="margin-top:0;margin-right:0;margin-bottom:0;margin-left:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#64736b;">The request is saved in Quote Review and is ready for your team to review.</p>
            </td>
          </tr>
          <tr>
            <td style="padding-top:16px;padding-right:30px;padding-bottom:4px;padding-left:30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dfe7e2;border-radius:14px;background-color:#f8faf8;">
                <tr>
                  <td style="padding-top:20px;padding-right:20px;padding-bottom:20px;padding-left:20px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#66786e;text-transform:uppercase;">Preliminary estimate</div>
                    <div style="padding-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.1;font-weight:800;color:#0f5d40;">${escapeHtml(estimate)}</div>
                    <div style="padding-top:7px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#758179;">Final pricing remains subject to property and scope review.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding-top:18px;padding-right:30px;padding-bottom:4px;padding-left:30px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#52665b;text-transform:uppercase;">Quote details</div>
            </td>
          </tr>
          <tr>
            <td style="padding-top:4px;padding-right:30px;padding-bottom:8px;padding-left:30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;">Customer</td>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(input.name)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;">Service</td>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(input.service)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;">Property</td>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(input.address)}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;">Email</td>
                  <td style="padding:12px 0;border-bottom:1px solid #e4e9e5;color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(input.email)}</td>
                </tr>
                ${phoneRow}
                ${companyRow}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:22px;padding-right:30px;padding-bottom:32px;padding-left:30px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="#14774f" style="background-color:#14774f;border-radius:10px;">
                    <a href="${escapeHtml(adminUrl)}" style="display:inline-block;padding-top:14px;padding-right:24px;padding-bottom:14px;padding-left:24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.2;font-weight:800;color:#ffffff;text-decoration:none;">Open Quote Review</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="#f5f7f5" style="background-color:#f5f7f5;border-top:1px solid #e2e8e4;padding-top:18px;padding-right:28px;padding-bottom:18px;padding-left:28px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;color:#7a867f;text-align:center;">Quote details remain stored in 4 Ever Seasons Master. Replying to this email replies directly to the customer.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    "4 Ever Seasons — New quote request",
    "",
    `Customer: ${input.name}`,
    `Service: ${input.service}`,
    `Property: ${input.address}`,
    `Estimate: ${estimate}`,
    `Email: ${input.email}`,
    input.phone ? `Phone: ${input.phone}` : null,
    input.companyName ? `Company route: ${input.companyName}` : null,
    "",
    `Open Quote Review: ${adminUrl}`,
  ].filter(Boolean).join("\n");

  try {
    const payload: Record<string, unknown> = {
      from,
      to: [SUPPORT_EMAIL],
      subject,
      html,
      text,
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
