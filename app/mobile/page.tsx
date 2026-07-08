"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function GrassAnimation(){
  return <div className="mobile-splash-scene" aria-hidden="true">
    <div className="mobile-sun" />
    <div className="mobile-cloud c1" />
    <div className="mobile-cloud c2" />
    <div className="mobile-worker">
      <div className="worker-head" />
      <div className="worker-body" />
      <div className="worker-arm" />
      <div className="mower-handle" />
      <div className="mower-base"><span /><span /></div>
    </div>
    <div className="grass-lines"><i/><i/><i/><i/><i/><i/><i/><i/></div>
  </div>
}

export default function MobileAppHome(){
  const [showSplash,setShowSplash]=useState(false);

  useEffect(()=>{
    // Never block the app. Splash is visual only and always ends quickly.
    setShowSplash(true);
    const t=window.setTimeout(()=>setShowSplash(false),1800);
    const emergency=window.setTimeout(()=>setShowSplash(false),2500);
    return()=>{window.clearTimeout(t); window.clearTimeout(emergency)};
  },[]);

  if(showSplash){
    return <main className="mobile-splash">
      <div className="mobile-logo-pulse"><span>D</span></div>
      <h1>Damasio OS</h1>
      <p>Field app loading...</p>
      <GrassAnimation />
      <button className="mobile-skip-splash" onClick={()=>setShowSplash(false)}>Open app</button>
    </main>
  }

  return <main className="mobile-app-shell mobile-entry">
    <section className="mobile-hero-card">
      <div className="mobile-brand-row"><div className="mobile-brand-mark">D</div><div><strong>Damasio OS</strong><span>Mobile App</span></div></div>
      <h1>Simple field app</h1>
      <p>Use this first version to test the real mobile flow with Admin, Employee and Customer.</p>
    </section>

    <section className="mobile-role-grid">
      <Link className="mobile-role-card admin" href="/mobile/admin"><span>01</span><strong>Admin</strong><p>Today, routes, alerts and return visits.</p></Link>
      <Link className="mobile-role-card employee" href="/mobile/employee"><span>02</span><strong>Employee</strong><p>Route, Service Screen, Start, Finish and photos.</p></Link>
      <Link className="mobile-role-card customer" href="/mobile/customer"><span>03</span><strong>Customer</strong><p>Status, feedback and return visit request.</p></Link>
    </section>

    <section className="mobile-mini-guide">
      <strong>Test path</strong>
      <p>Employee → Route → Open house → Start → Finish.</p>
    </section>
  </main>
}
