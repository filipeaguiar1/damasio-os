"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { purgeLegacyCustomerDemoData } from "@/lib/customer/purgeLegacyCustomerDemoData";

export function CustomerLegacyDataGuard() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/customer") || pathname.startsWith("/mobile/customer")) {
      purgeLegacyCustomerDemoData();
    }
  }, [pathname]);

  return null;
}
