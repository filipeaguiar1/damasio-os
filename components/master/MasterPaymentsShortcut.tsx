"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MasterPaymentsShortcut() {
  const pathname = usePathname();
  if (pathname === "/master/payments") return null;
  return (
    <Link
      href="/master/payments"
      style={{
        position: "fixed",
        right: 22,
        bottom: 22,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "13px 17px",
        borderRadius: 999,
        background: "#0d6844",
        color: "#fff",
        textDecoration: "none",
        fontWeight: 950,
        boxShadow: "0 16px 38px rgba(8,45,33,.25)",
      }}
    >
      <span style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 9, background: "rgba(255,255,255,.16)" }}>$</span>
      Payments & Contracts
    </Link>
  );
}
