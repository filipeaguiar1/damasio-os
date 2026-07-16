"use client";
import Link from "next/link";

export function MobileAdminNav({active}:{active:"home"|"routes"|"tasks"|"alerts"|"more"}){
  const items=[
    ["home","/mobile/admin","⌂","Home"],
    ["routes","/mobile/admin/routes","↗","Routes"],
    ["tasks","/mobile/admin/tasks","✓","Returns"],
    ["alerts","/mobile/admin/alerts","!","Alerts"],
    ["more","/mobile/admin/more","•••","More"],
  ] as const;
  return <nav className="role-mobile-bottom" aria-label="Admin navigation">{items.map(([id,href,icon,label])=><Link className={active===id?"active":""} href={href} key={id}><i>{icon}</i><span>{label}</span></Link>)}</nav>
}
