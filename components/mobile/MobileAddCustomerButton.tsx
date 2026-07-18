"use client";
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {usePathname,useRouter} from "next/navigation";

export function MobileAddCustomerButton(){
  const pathname=usePathname();
  const router=useRouter();
  const[mount,setMount]=useState<HTMLElement|null>(null);
  useEffect(()=>{
    if(pathname!=="/mobile/admin/customers")return;
    const strip=document.querySelector(".mobile-filter-strip");
    if(!strip)return;
    const host=document.createElement("span");
    host.className="mobile-customers-add-host";
    strip.insertBefore(host,strip.children[1]||null);
    setMount(host);
    return()=>{setMount(null);host.remove()};
  },[pathname]);
  if(!mount)return null;
  return createPortal(<button type="button" className="mobile-customers-add" onClick={()=>router.push("/mobile/admin/add-customer")} aria-label="Add Customer">＋</button>,mount)
}
