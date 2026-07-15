"use client";

import {useEffect,useRef} from "react";

function SeasonalFieldScene(){
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

export function MobileStartupSplash({onOpen}:{onOpen:()=>void}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  useEffect(()=>{const timer=window.setTimeout(()=>openRef.current(),2400);return()=>window.clearTimeout(timer)},[]);
  return <main className="mobile-splash mobile-employee-startup">
    <h1 className="mobile-splash-wordmark">Damasio <strong>OS</strong></h1>
    <p>Your workday, connected.</p>
    <SeasonalFieldScene />
    <button className="mobile-skip-splash" onClick={onOpen}>Skip</button>
  </main>
}
