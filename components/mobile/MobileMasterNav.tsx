"use client";

import Link from "next/link";

export type MobileMasterSection="overview"|"companies"|"leads"|"finance"|"more";

export function MobileMasterNav({active}:{active:MobileMasterSection}){
  const items=[
    ["overview","/mobile/master","⌂","Overview"],
    ["companies","/mobile/master/companies","▦","Companies"],
    ["leads","/mobile/master/leads","◎","Leads"],
    ["finance","/mobile/master/finance","$","Finance"],
    ["more","/mobile/master/more","•••","More"],
  ] as const;

  return <nav className="role-mobile-bottom" aria-label="Master navigation">
    {items.map(([id,href,icon,label])=><Link className={active===id?"active":""} href={href} key={id}><i>{icon}</i><span>{label}</span></Link>)}
  </nav>;
}
