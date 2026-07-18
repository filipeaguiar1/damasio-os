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
    let strip=document.querySelector(".mobile-filter-strip");
    let createdStrip=false;
    if(!strip){const list=document.querySelector(".mobile-tool-list");if(!list)return;strip=document.createElement("nav");strip.className="mobile-filter-strip mobile-customers-filter-fallback";const all=document.createElement("button");all.type="button";all.className="active";all.textContent="All";strip.appendChild(all);list.parentElement?.insertBefore(strip,list);createdStrip=true}
    const host=document.createElement("span");
    host.className="mobile-customers-add-host";
    strip.insertBefore(host,strip.children[1]||null);
    setMount(host);
    return()=>{setMount(null);host.remove();if(createdStrip)strip?.remove()};
  },[pathname]);
  if(!mount)return null;
  return createPortal(<button type="button" className="mobile-customers-add" onClick={()=>router.push("/mobile/admin/add-customer")} aria-label="Add Customer">＋</button>,mount)
}
