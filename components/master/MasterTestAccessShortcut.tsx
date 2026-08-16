"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";

export function MasterTestAccessShortcut(){
  const pathname=usePathname();
  const[nav,setNav]=useState<HTMLElement|null>(null);
  useEffect(()=>{const find=()=>setNav(document.querySelector<HTMLElement>(".master-sidebar nav"));find();const timer=window.setInterval(find,250);return()=>window.clearInterval(timer)},[pathname]);
  if(pathname==="/master/test-access"||!nav)return null;
  return createPortal(<Link href="/master/test-access" style={{minHeight:44,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,padding:"11px 14px",borderRadius:10,color:"inherit",fontWeight:800,textDecoration:"none"}}>Test Accounts <span aria-hidden="true">⏱</span></Link>,nav);
}
