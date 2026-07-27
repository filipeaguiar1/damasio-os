"use client";

/**
 * Compatibility shell kept so existing customer pages do not need parallel
 * navigation implementations. Customer navigation now lives in the page
 * modules and headers, so no fixed element can cover mobile content.
 */
export function MobileCustomerNav(_props: { active: "home" | "services" | "request" | "billing" | "more" }) {
  return null;
}
