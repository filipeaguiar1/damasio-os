"use client";

import { useState } from "react";
import { AdvancedRoutePlannerV7 } from "@/components/admin/AdvancedRoutePlannerV7";
import { RouteAdvisorPanel } from "@/components/admin/RouteAdvisorPanel";

export function RouteAdvisorWorkspace(){
  const [manualOpen,setManualOpen]=useState(false);

  return <section className="route-advisor-workspace-v4">
    <AdvancedRoutePlannerV7/>

    <section className={`single-day-advisor ${manualOpen?"open":""}`}>
      <button type="button" className="single-day-toggle" aria-expanded={manualOpen} onClick={()=>setManualOpen(current=>!current)}>
        <span><b>Manual single-day route editor</b><small>{manualOpen?"Hide manual editor":"Adjust an existing day, add/remove houses or change the order"}</small></span>
        <i>{manualOpen?"−":"+"}</i>
      </button>
      {manualOpen&&<div className="single-day-body">
        <div className="single-day-warning"><strong>Choose the Employee and exact route date before editing.</strong><span>If that date already has a canonical route, publishing the reviewed result updates that same dated route. Completed/in-progress safeguards still apply. Future recurring Visits may follow the updated reference only when recurrence is explicitly applied.</span></div>
        <RouteAdvisorPanel/>
      </div>}
    </section>

    <style jsx global>{`
      .route-advisor-workspace-v4{display:grid;gap:18px}.single-day-advisor{border:1px solid #dbe7e1;border-radius:20px;background:#fff;overflow:hidden}.single-day-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;gap:16px;padding:17px 20px;border:0;background:#f7faf8;color:#173a2c;text-align:left;cursor:pointer}.single-day-toggle span{display:grid;gap:3px}.single-day-toggle b{font-size:17px}.single-day-toggle small{color:#6c7c74;font-weight:500}.single-day-toggle i{display:grid;place-items:center;flex:0 0 34px;width:34px;height:34px;border-radius:10px;background:#e8f4ed;color:#0b7655;font-style:normal;font-size:22px;font-weight:900}.single-day-advisor.open .single-day-toggle{border-bottom:1px solid #e5eee9}.single-day-body{display:grid;gap:12px;padding:14px}.single-day-warning{display:grid;gap:4px;padding:12px 14px;border-radius:13px;background:#fff8e8;border:1px solid #f1dfad;color:#684e10}.single-day-warning span{font-size:12px;line-height:1.45;color:#7c681f}.route-advisor-workspace-v4 .advisor-recommend,.route-advisor-workspace-v4 .advisor-recommendations{display:none!important}
    `}</style>
  </section>;
}
