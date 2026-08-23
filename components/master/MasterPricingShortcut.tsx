"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MasterPricingShortcut(){
  const pathname=usePathname();
  if(pathname==="/master/pricing") return null;
  return <Link href="/master/pricing" style={{position:"fixed",right:22,bottom:82,zIndex:80,display:"flex",alignItems:"center",gap:10,padding:"13px 17px",borderRadius:999,background:"#153c2e",color:"#fff",textDecoration:"none",fontWeight:950,boxShadow:"0 16px 38px rgba(8,45,33,.2)"}}><span style={{display:"grid",placeItems:"center",width:26,height:26,borderRadius:9,background:"rgba(255,255,255,.14)"}}>$</span>Pricing & Memberships</Link>;
}
