const CANONICAL_SITE_URL = "https://www.4everseasons.com";

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configured) {
    try {
      const url = new URL(configured);
      const hostname = url.hostname.toLowerCase();

      if (hostname === "4everseasons.com" || hostname === "www.4everseasons.com") {
        return CANONICAL_SITE_URL;
      }

      if (process.env.NODE_ENV !== "production" && (hostname === "localhost" || hostname === "127.0.0.1")) {
        return configured.replace(/\/+$/, "");
      }
    } catch {
      // Ignore invalid configuration and fall back to the canonical public domain.
    }
  }

  return CANONICAL_SITE_URL;
}
