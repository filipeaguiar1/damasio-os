"use client";

import {useEffect} from "react";
import {useRouter} from "next/navigation";

export default function MobileEntry(){
  const router=useRouter();

  useEffect(()=>{
    router.replace("/mobile/login");
  },[router]);

  return <main className="mobile-app-shell mobile-login-page" aria-busy="true">
    <section className="mobile-hero-card">
      <div className="mobile-brand-row"><div className="mobile-brand-mark">4</div><div><strong>4Ever Seasons</strong><span>Secure mobile access</span></div></div>
      <h1>Opening mobile</h1>
      <p>Preparing your mobile workspace...</p>
    </section>
  </main>;
}
