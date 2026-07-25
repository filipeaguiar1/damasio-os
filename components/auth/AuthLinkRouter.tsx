"use client";

import { useEffect } from "react";

export function AuthLinkRouter() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const type = hash.get("type") || query.get("type");
    const hasSession = Boolean(hash.get("access_token") || hash.get("refresh_token") || query.get("code"));
    const hasError = Boolean(hash.get("error") || query.get("error") || hash.get("error_code") || query.get("error_code"));

    if (!hasSession && !hasError) return;

    const target = type === "recovery" ? "/reset-password?onboarding=company" : "/auth/complete";
    const suffix = `${window.location.search}${window.location.hash}`;
    window.location.replace(`${target}${suffix}`);
  }, []);

  return null;
}
