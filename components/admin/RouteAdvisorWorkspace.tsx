"use client";

import { AdvancedRoutePlanner } from "@/components/admin/AdvancedRoutePlanner";
import { RouteAdvisorPanel } from "@/components/admin/RouteAdvisorPanel";

export function RouteAdvisorWorkspace(){
  return <section className="route-advisor-workspace-v3">
    <AdvancedRoutePlanner/>
    <section className="single-day-advisor">
      <header><span>DAILY ROUTE FINE-TUNING</span><h2>Need to adjust one specific day?</h2><p>Use the Route Advisor below for manual single-day changes, map order and individual publication.</p></header>
      <RouteAdvisorPanel/>
    </section>
    <style jsx global>{`
      .route-advisor-workspace-v3{display:grid;gap:18px}.single-day-advisor{display:grid;gap:14px}.single-day-advisor>header{padding:16px 18px;border:1px solid #dbe7e1;border-radius:18px;background:#f7faf8}.single-day-advisor>header span{font-size:10px;font-weight:950;letter-spacing:.12em;color:#0b7655}.single-day-advisor>header h2{margin:4px 0;color:#173a2c;font-size:22px}.single-day-advisor>header p{margin:0;color:#6c7c74}.route-advisor-workspace-v3 .advisor-recommend,.route-advisor-workspace-v3 .advisor-recommendations{display:none!important}
    `}</style>
  </section>;
}
