"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

export function MasterCustomersShortcut() {
  const pathname = usePathname();
  const [nav, setNav] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const findNav = () => setNav(document.querySelector(".master-sidebar nav"));
    findNav();
    const timer = window.setInterval(findNav, 250);
    return () => window.clearInterval(timer);
  }, [pathname]);

  if (pathname === "/master/customers" || !nav) return null;

  return createPortal(
    <Link
      href="/master/customers"
      style={{
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "11px 14px",
        borderRadius: 10,
        color: "inherit",
        fontWeight: 800,
        textDecoration: "none",
      }}
    >
      Customers <span aria-hidden="true">›</span>
    </Link>,
    nav,
  );
}
