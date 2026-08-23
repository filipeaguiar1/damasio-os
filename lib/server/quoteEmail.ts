import { sendBrandedEmail } from "@/lib/server/brandedEmail";

type QuoteAlertInput = {
  stage: "complete";
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

export async function sendQuoteAlert(input: QuoteAlertInput) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.4everseasons.com").replace(/\/$/, "");
  const estimate = typeof input.estimatedTotal === "number" ? `$${input.estimatedTotal.toFixed(2)}` : "Admin review required";

  return sendBrandedEmail({
    to: SUPPORT_EMAIL,
    replyTo: input.email,
    subject: `New quote request — ${input.service}`,
    eyebrow: "New quote request",
    title: "A customer submitted a quote.",
    intro: "The request is saved in Quote Review and is ready for your team to review.",
    highlight: {
      label: "Preliminary estimate",
      value: estimate,
      note: "Final pricing remains subject to property and scope review.",
    },
    sectionTitle: "Quote details",
    details: [
      { label: "Customer", value: input.name },
      { label: "Service", value: input.service },
      { label: "Property", value: input.address },
      { label: "Email", value: input.email },
      ...(input.phone ? [{ label: "Phone", value: input.phone }] : []),
      ...(input.companyName ? [{ label: "Company route", value: input.companyName }] : []),
    ],
    cta: { label: "Open Quote Review", href: `${siteUrl}/master` },
    footer: "Quote details remain stored in 4 Ever Seasons Master. Replying to this email replies directly to the customer.",
  });
}
