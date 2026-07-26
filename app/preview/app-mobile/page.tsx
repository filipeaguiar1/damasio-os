"use client";

import { useState } from "react";

const roles = ["Master", "Employee", "Customer"] as const;
type Role = (typeof roles)[number];

const data = {
  Master: {
    eyebrow: "PLATFORM CONTROL",
    title: "Good evening, Filipe",
    subtitle: "Everything important across the platform, in one place.",
    stats: [["Companies", "18"], ["Active users", "246"], ["Open alerts", "3"], ["MRR", "$28.4K"]],
    actions: [["Companies", "Manage tenants"], ["Support", "Temporary access"], ["Finance", "Fees and payouts"], ["Security", "Access history"], ["Reports", "Platform health"], ["Settings", "Global controls"]],
    activity: [["Forever Seasons", "Healthy · Hamilton"], ["GreenEdge", "Payment review"], ["NorthLine", "New company created"]],
  },
  Employee: {
    eyebrow: "TODAY'S ROUTE",
    title: "6 homes assigned",
    subtitle: "Pedro · Crew A · Monday, July 27",
    stats: [["Completed", "2"], ["Remaining", "4"], ["Route time", "3h 18m"], ["Issues", "1"]],
    actions: [["Open route", "View today's homes"], ["Route map", "Optimized order"], ["Start visit", "Timer and service"], ["Photos", "Before and after"], ["Comments", "Service notes"], ["Tasks", "Return visits"]],
    activity: [["Isabelle Martin", "120 King St W · Lawn care"], ["Robert Lee", "55 Bay Street · Weekly"], ["Emma Wilson", "88 Main Street · Biweekly"]],
  },
  Customer: {
    eyebrow: "MY PROPERTY",
    title: "Your lawn is scheduled",
    subtitle: "Next visit: Tuesday, July 28 · 120 King St W",
    stats: [["Balance", "$75.00"], ["Next visit", "Tomorrow"], ["Open invoices", "1"], ["Properties", "2"]],
    actions: [["My visits", "Track service history"], ["Payments", "Cards and balance"], ["Request service", "Get a new quote"], ["Properties", "Manage addresses"], ["Support", "Report an issue"], ["Profile", "Account settings"]],
    activity: [["Lawn care", "Scheduled · Tomorrow"], ["Spring cleanup", "Completed · July 19"], ["Invoice #1048", "$42.00 · Due"]],
  },
} satisfies Record<Role, any>;

export default function MobileAppPreview() {
  const [role, setRole] = useState<Role>("Master");
  const current = data[role];

  return (
    <main className="preview-page">
      <div className="preview-toolbar">
        <strong>4Ever Seasons App Preview</strong>
        <div>{roles.map(item => <button key={item} className={role===item?"active":""} onClick={()=>setRole(item)}>{item}</button>)}</div>
      </div>

      <section className="phone-frame">
        <div className="phone-status"><span>9:41</span><span>● ● ●</span></div>
        <div className="app-shell">
          <header className="app-topbar">
            <div className="brand"><b>4</b><span><strong>4Ever Seasons</strong><small>{role} App</small></span></div>
            <button className="avatar">{role.slice(0,1)}</button>
          </header>

          <div className="app-scroll">
            <section className="hero-card">
              <span>{current.eyebrow}</span>
              <h1>{current.title}</h1>
              <p>{current.subtitle}</p>
            </section>

            <section className="stat-grid">
              {current.stats.map(([label,value]:string[]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
            </section>

            <section className="section-block">
              <div className="section-title"><div><span>QUICK ACTIONS</span><h2>What do you need?</h2></div><button>•••</button></div>
              <div className="action-grid">
                {current.actions.map(([title,desc]:string[],index:number)=><button key={title}><i>{["⌂","↗","✓","▣","✎","⚙"][index]}</i><strong>{title}</strong><small>{desc}</small></button>)}
              </div>
            </section>

            <section className="section-block">
              <div className="section-title"><div><span>RECENT</span><h2>{role==="Employee"?"Today's homes":"Latest activity"}</h2></div><button>View all</button></div>
              <div className="list-card">
                {current.activity.map(([title,desc]:string[],index:number)=><div className="list-row" key={title}><i>{index+1}</i><span><strong>{title}</strong><small>{desc}</small></span><b>›</b></div>)}
              </div>
            </section>
          </div>

          <nav className="bottom-nav">
            {[["⌂","Home"],["▦","Activity"],["＋","New"],["◉","Alerts"],["☰","More"]].map(([icon,label],index)=><button key={label} className={index===0?"active":""}><i>{icon}</i><span>{label}</span></button>)}
          </nav>
        </div>
      </section>

      <p className="preview-note">Standalone visual prototype. It does not change production data or require login.</p>

      <style jsx>{`
        .preview-page{min-height:100vh;padding:24px 14px 40px;background:#e8eee9;color:#10271d;font-family:Arial,sans-serif}
        .preview-toolbar{max-width:760px;margin:0 auto 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}.preview-toolbar>div{display:flex;gap:6px}.preview-toolbar button{border:1px solid #c6d4ca;border-radius:999px;background:#fff;padding:8px 11px;font-weight:800;color:#496158}.preview-toolbar button.active{background:#07583a;color:#fff;border-color:#07583a}
        .phone-frame{width:min(390px,100%);height:min(820px,calc(100vh - 130px));min-height:680px;margin:auto;padding:10px;border-radius:36px;background:#14231c;box-shadow:0 30px 80px rgba(8,38,25,.28)}
        .phone-status{height:26px;display:flex;justify-content:space-between;padding:0 18px;color:#fff;font-size:11px;font-weight:800}.app-shell{height:calc(100% - 26px);position:relative;overflow:hidden;border-radius:27px;background:#f3f6f4}.app-topbar{height:67px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:rgba(255,255,255,.94);border-bottom:1px solid #dbe5de}.brand{display:flex;align-items:center;gap:10px}.brand>b{width:37px;height:37px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#043d2e,#20a464);color:#fff;font-size:20px}.brand span,.brand strong,.brand small{display:block}.brand strong{font-size:13px}.brand small{margin-top:2px;color:#718078;font-size:9px}.avatar{width:38px;height:38px;border:0;border-radius:50%;background:#e5eee8;color:#07583a;font-weight:900}
        .app-scroll{height:calc(100% - 67px);overflow:auto;padding:15px 14px 92px}.hero-card{position:relative;overflow:hidden;padding:21px;border-radius:24px;background:linear-gradient(145deg,#043d2e,#07583a 70%,#20a464);color:#fff;box-shadow:0 16px 40px rgba(4,61,46,.2)}.hero-card:after{content:"";position:absolute;width:150px;height:150px;right:-55px;top:-65px;border-radius:50%;background:rgba(255,255,255,.08)}.hero-card span{font-size:9px;font-weight:900;letter-spacing:.12em;color:#a8edc5}.hero-card h1{margin:8px 0 7px;font-size:28px;line-height:1.04;letter-spacing:-.04em}.hero-card p{margin:0;color:#d7ece1;font-size:11px;line-height:1.5}
        .stat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:11px}.stat-grid article{padding:14px;border:1px solid #d8e3dc;border-radius:17px;background:#fff;box-shadow:0 8px 22px rgba(7,61,46,.07)}.stat-grid span,.stat-grid strong{display:block}.stat-grid span{font-size:9px;color:#718078;font-weight:800}.stat-grid strong{margin-top:5px;font-size:21px;color:#043d2e}
        .section-block{margin-top:18px}.section-title{display:flex;align-items:end;justify-content:space-between;margin:0 2px 9px}.section-title span{font-size:8px;color:#718078;font-weight:900;letter-spacing:.1em}.section-title h2{margin:3px 0 0;font-size:16px}.section-title button{border:0;background:transparent;color:#07583a;font-size:10px;font-weight:900}.action-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.action-grid button{min-height:108px;padding:14px;border:1px solid #d8e3dc;border-radius:18px;background:#fff;text-align:left;color:#10271d;box-shadow:0 8px 22px rgba(7,61,46,.06)}.action-grid i{width:36px;height:36px;display:grid;place-items:center;border-radius:12px;background:#eaf1ed;color:#07583a;font-style:normal;font-size:17px;font-weight:900}.action-grid strong,.action-grid small{display:block}.action-grid strong{margin-top:9px;font-size:12px}.action-grid small{margin-top:3px;color:#718078;font-size:9px;line-height:1.35}
        .list-card{overflow:hidden;border:1px solid #d8e3dc;border-radius:18px;background:#fff}.list-row{display:grid;grid-template-columns:38px 1fr auto;gap:10px;align-items:center;padding:11px 12px;border-bottom:1px solid #edf2ee}.list-row:last-child{border:0}.list-row>i{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:#eaf1ed;color:#07583a;font-style:normal;font-weight:900}.list-row span,.list-row strong,.list-row small{display:block;min-width:0}.list-row strong{font-size:11px}.list-row small{margin-top:3px;color:#718078;font-size:9px}.list-row>b{color:#7d8d85}
        .bottom-nav{position:absolute;left:10px;right:10px;bottom:9px;height:66px;display:grid;grid-template-columns:repeat(5,1fr);padding:7px;border:1px solid rgba(216,227,220,.95);border-radius:21px;background:rgba(255,255,255,.95);box-shadow:0 15px 36px rgba(4,61,46,.2);backdrop-filter:blur(16px)}.bottom-nav button{border:0;border-radius:14px;background:transparent;color:#718078}.bottom-nav button.active{background:linear-gradient(145deg,#043d2e,#07583a);color:#fff}.bottom-nav i,.bottom-nav span{display:block}.bottom-nav i{font-style:normal;font-size:17px;font-weight:900}.bottom-nav span{margin-top:3px;font-size:8px;font-weight:800}.preview-note{max-width:560px;margin:16px auto 0;text-align:center;color:#607369;font-size:11px}
        @media(max-width:440px){.preview-page{padding:8px 0 0}.preview-toolbar{padding:0 10px;flex-direction:column;align-items:flex-start}.phone-frame{width:100%;height:calc(100vh - 92px);min-height:640px;border-radius:0;padding:0}.phone-status{display:none}.app-shell{height:100%;border-radius:0}.preview-note{display:none}}
      `}</style>
    </main>
  );
}
