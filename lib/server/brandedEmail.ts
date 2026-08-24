export type BrandedEmailDetail = {
  label: string;
  value: string;
};

export type BrandedEmailHighlight = {
  label: string;
  value: string;
  note?: string;
};

export type BrandedEmailCta = {
  label: string;
  href: string;
};

export type BrandedEmailMessage = {
  to: string | string[];
  subject: string;
  replyTo?: string;
  idempotencyKey?: string;
  eyebrow: string;
  title: string;
  intro?: string;
  highlight?: BrandedEmailHighlight;
  sectionTitle?: string;
  details?: BrandedEmailDetail[];
  cta?: BrandedEmailCta;
  footer?: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  }[char] || char));
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.4everseasons.com").replace(/\/$/, "");
}

function renderDetails(details: BrandedEmailDetail[]) {
  return details.map((detail, index) => {
    const border = index === details.length - 1 ? "" : "border-bottom:1px solid #e4e9e5;";
    return `<tr>
      <td style="padding:12px 0;${border}color:#708078;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;width:38%;vertical-align:top;">${escapeHtml(detail.label)}</td>
      <td style="padding:12px 0;${border}color:#183228;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;font-weight:700;vertical-align:top;">${escapeHtml(detail.value)}</td>
    </tr>`;
  }).join("");
}

export function renderBrandedEmail(message: Omit<BrandedEmailMessage, "to" | "replyTo" | "idempotencyKey">) {
  const rootUrl = siteUrl();
  const logoUrl = `${rootUrl}/brand/4ever-seasons-logo-mark.jpg`;
  const details = (message.details || []).filter(detail => detail.value.trim());

  const highlightHtml = message.highlight ? `<tr>
    <td style="padding:16px 30px 4px 30px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #dfe7e2;border-radius:14px;background-color:#f8faf8;">
        <tr><td style="padding:20px;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#66786e;text-transform:uppercase;">${escapeHtml(message.highlight.label)}</div>
          <div style="padding-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:30px;line-height:1.1;font-weight:800;color:#0f5d40;">${escapeHtml(message.highlight.value)}</div>
          ${message.highlight.note ? `<div style="padding-top:7px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#758179;">${escapeHtml(message.highlight.note)}</div>` : ""}
        </td></tr>
      </table>
    </td>
  </tr>` : "";

  const detailsHtml = details.length ? `<tr>
    <td style="padding:18px 30px 4px 30px;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.3;font-weight:800;letter-spacing:1px;color:#52665b;text-transform:uppercase;">${escapeHtml(message.sectionTitle || "Details")}</div>
    </td>
  </tr>
  <tr><td style="padding:4px 30px 8px 30px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${renderDetails(details)}</table>
  </td></tr>` : "";

  const ctaHtml = message.cta ? `<tr><td align="center" style="padding:22px 30px 32px 30px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#14774f" style="background-color:#14774f;border-radius:10px;">
      <a href="${escapeHtml(message.cta.href)}" style="display:inline-block;padding:14px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.2;font-weight:800;color:#ffffff;text-decoration:none;">${escapeHtml(message.cta.label)}</a>
    </td></tr></table>
  </td></tr>` : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="X-UA-Compatible" content="IE=edge"><title>${escapeHtml(message.subject)}</title></head>
<body style="margin:0;padding:0;background-color:#eef2ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#eef2ef;"><tr><td align="center" style="padding:34px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background-color:#ffffff;border:1px solid #dce4df;border-radius:18px;overflow:hidden;">
<tr><td bgcolor="#0d3024" style="background-color:#0d3024;padding:24px 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="64" valign="middle" style="width:64px;"><img src="${escapeHtml(logoUrl)}" width="52" height="52" border="0" alt="4 Ever Seasons" style="display:block;width:52px;height:52px;border-radius:10px;"></td>
<td valign="middle" style="padding-left:12px;"><div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:1.2;font-weight:800;color:#ffffff;">4 Ever Seasons</div><div style="padding-top:4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.3;font-weight:700;letter-spacing:1.2px;color:#bfd6c8;text-transform:uppercase;">Property Maintenance</div></td>
</tr></table></td></tr>
<tr><td style="padding:30px 30px 10px 30px;"><div style="display:inline-block;padding:7px 10px;border-radius:999px;background-color:#e9f3ed;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1;font-weight:800;letter-spacing:1px;color:#176044;text-transform:uppercase;">${escapeHtml(message.eyebrow)}</div><h1 style="margin:16px 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:29px;line-height:1.15;font-weight:800;color:#14291f;">${escapeHtml(message.title)}</h1>${message.intro ? `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#64736b;">${escapeHtml(message.intro)}</p>` : ""}</td></tr>
${highlightHtml}${detailsHtml}${ctaHtml}
<tr><td bgcolor="#f5f7f5" style="background-color:#f5f7f5;border-top:1px solid #e2e8e4;padding:18px 28px;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;color:#7a867f;text-align:center;">${escapeHtml(message.footer || "4 Ever Seasons · Hamilton, Burlington & Oakville")}</p></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `4 Ever Seasons — ${message.eyebrow}`,
    "",
    message.title,
    message.intro || null,
    "",
    message.highlight ? `${message.highlight.label}: ${message.highlight.value}` : null,
    message.highlight?.note || null,
    details.length ? "" : null,
    ...details.map(detail => `${detail.label}: ${detail.value}`),
    message.cta ? "" : null,
    message.cta ? `${message.cta.label}: ${message.cta.href}` : null,
    "",
    message.footer || "4 Ever Seasons · Hamilton, Burlington & Oakville",
  ].filter(value => value !== null).join("\n");

  return { html, text };
}

export async function sendBrandedEmail(message: BrandedEmailMessage) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Branded email skipped: RESEND_API_KEY is not configured", { subject: message.subject });
    return false;
  }

  const from = process.env.CONTACT_FROM_EMAIL || "4Ever Seasons <no-reply@auth.4everseasons.com>";
  const { html, text } = renderBrandedEmail(message);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        html,
        text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      console.error("Branded email delivery failed", { subject: message.subject, status: response.status, detail: await response.text() });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Branded email delivery error", { subject: message.subject, error });
    return false;
  }
}
