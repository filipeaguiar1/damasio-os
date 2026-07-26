"use client";

function click(selector:string){const element=document.querySelector<HTMLElement>(selector);element?.click();window.scrollTo({top:0,behavior:"smooth"});}

export function PremiumEmployeeNav(){
  return <nav className="premium-mobile-nav premium-employee-nav" aria-label="Employee navigation">
    <button className="active" onClick={()=>{click(".employee-home-switch button:first-child");click(".mobile-tabs button:first-child")}}><i>⌂</i><span>Home</span></button>
    <button onClick={()=>{click(".employee-home-switch button:first-child");click(".mobile-tabs button:first-child")}}><i>▣</i><span>Route</span></button>
    <button onClick={()=>click(".mobile-tabs button:nth-child(2)")}><i>☑</i><span>Tasks</span></button>
    <button onClick={()=>click(".mobile-tabs button:first-child")}><i>◷</i><span>Visits</span></button>
    <button onClick={()=>click(".employee-profile-trigger")}><i>⋮</i><span>More</span></button>
  </nav>;
}
