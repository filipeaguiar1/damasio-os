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
    let host:HTMLElement|null=null;
    let createdStrip:Element|null=null;

    const attach=()=>{
      if(host?.isConnected)return true;
      let strip=document.querySelector(".mobile-filter-strip");
      if(!strip){
        const list=document.querySelector(".mobile-tool-list");
        if(!list)return false;
        strip=document.createElement("nav");
        strip.className="mobile-filter-strip mobile-customers-filter-fallback";
        const all=document.createElement("button");
        all.type="button";
        all.className="active";
        all.textContent="All";
        strip.appendChild(all);
        list.parentElement?.insertBefore(strip,list);
        createdStrip=strip;
      }
      host=document.createElement("span");
      host.className="mobile-customers-add-host";
      strip.insertBefore(host,strip.children[1]||null);
      setMount(host);
      return true;
    };

    attach();
    const observer=new MutationObserver(()=>attach());
    observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();setMount(null);host?.remove();createdStrip?.remove()};
  },[pathname]);

  if(!mount)return null;
  return createPortal(
    <button type="button" className="mobile-customers-add" onClick={()=>router.push("/mobile/admin/add-customer")} aria-label="Add Customer">+</button>,
    mount
  );
}
