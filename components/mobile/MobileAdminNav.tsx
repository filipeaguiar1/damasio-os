"use client";

export type MobileAdminNavSection = "home" | "routes" | "tasks" | "alerts" | "more";

/**
 * Admin mobile pages now use their page header and explicit back navigation.
 * Keeping this compatibility component prevents older page imports from
 * rendering the floating dock that obscured operational content.
 */
export function MobileAdminNav(_: { active: MobileAdminNavSection }) {
  return null;
}
