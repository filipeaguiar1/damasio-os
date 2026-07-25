"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MasterCustomersShortcut() {
  const pathname = usePathname();
  if (pathname === "/master/customers") return null;

  return (
    <Link
      href="/master/customers"
      aria-label="Open Master Customers"
      style={{
        position: "fixed",
        left: 18,
        top: 132,
        zIndex: 120,
        width: 220,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "11px 14px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,.18)",
        background: "#0b5c43",
        color: "#fff",
        fontWeight: 800,
        textDecoration: "none",
        boxShadow: "0 10px 24px rgba(4,61,46,.24)",
      }}
    >
      <span>Customers</span>
      <span aria-hidden="true">→</span>
    </Link>
  );
}
