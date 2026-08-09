"use client";

import {useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {MobileStartupSplash} from "@/components/mobile/MobileStartupSplash";

/**
 * Shows the branded opening once per document/app launch even when the browser
 * restores a deep mobile route such as /mobile/employee. The /mobile entry
 * route already owns its splash, so we deliberately skip that path.
 */
export function GlobalMobileStartup(){
  const pathname=usePathname();
  const initialPath=useRef(pathname);
  const [visible,setVisible]=useState(false);

  useEffect(()=>{
    const path=initialPath.current;
    if(path.startsWith("/mobile")&&path!=="/mobile")setVisible(true);
  },[]);

  if(!visible)return null;
  return <MobileStartupSplash onOpen={()=>setVisible(false)}/>;
}
