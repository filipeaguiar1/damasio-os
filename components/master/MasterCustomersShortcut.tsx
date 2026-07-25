"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MasterCustomersShortcut() {
  const pathname = usePathname();
  if (pathname === "/master/customers") return null;
  return <Link href="/master/customers" style={{position:"fixed",left:20,bottom:22,zIndex:90,padding:"11px 16px",borderRadius:12,background:"#0b5c43",color:"#fff",fontWeight:800,textDecoration:"none",boxShadow:"0 12px 28px rgba(4,61,46,.25)"}}>Customers</Link>;
}
