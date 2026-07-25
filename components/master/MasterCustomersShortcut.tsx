"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MasterCustomersShortcut() {
  const pathname = usePathname();
  if (pathname === "/master/customers") return null;
  return <Link href="/master/customers" className="master-customers-shortcut">Customers</Link>;
}
