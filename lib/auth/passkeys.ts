"use client";

export function passkeysFeatureEnabled() {
  return process.env.NEXT_PUBLIC_PASSKEYS_ENABLED === "true";
}

export function isDesktopPasskeyEnvironment() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
  if (mobileUserAgent) return false;
  if (!("PublicKeyCredential" in window)) return false;
  return true;
}

export function canOfferDesktopPasskeys() {
  return passkeysFeatureEnabled() && isDesktopPasskeyEnvironment();
}
