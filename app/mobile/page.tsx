"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MobileStartupSplash } from "@/components/mobile/MobileStartupSplash";

export default function MobileAppHome(){
  const [showSplash,setShowSplash]=useState(false);

  useEffect(()=>{
    // Never block the app. Splash is visual only and always ends quickly.
    setShowSplash(true);
    const t=window.setTimeout(()=>setShowSplash(false),1800);
    const emergency=window.setTimeout(()=>setShowSplash(false),2500);
    return()=>{window.clearTimeout(t); window.clearTimeout(emergency)};
  },[]);

  if(showSplash)return <MobileStartupSplash onOpen={()=>setShowSplash(false)}/>;

  return <main className="mobile-app-shell mobile-entry">
    <section className="mobile-hero-card">
      <div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>Damasio OS</strong><span>Mobile App</span></div></div>
      <h1>Simple field app</h1>
      <p>Use this first version to test the real mobile flow with Admin, Employee and Customer.</p>
    </section>

    <section className="mobile-role-grid">
      <Link className="mobile-role-card admin" href="/mobile/admin" prefetch={false}><span>01</span><strong>Admin</strong><p>Today, routes, alerts and return visits.</p></Link>
      <Link className="mobile-role-card employee" href="/mobile/employee" prefetch={false}><span>02</span><strong>Employee</strong><p>Route, Service Screen, Start, Finish and photos.</p></Link>
      <Link className="mobile-role-card customer" href="/mobile/customer" prefetch={false}><span>03</span><strong>Customer</strong><p>Status, feedback and return visit request.</p></Link>
    </section>

    <section className="mobile-mini-guide">
      <strong>Test path</strong>
      <p>Employee → Route → Open house → Start → Finish.</p>
    </section>
  </main>
}
