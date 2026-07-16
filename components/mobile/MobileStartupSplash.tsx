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

export function MobileStartupSplash({onOpen,showMark=true,message="Field app loading..."}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  useEffect(()=>{const timer=window.setTimeout(()=>openRef.current(),1750);return()=>window.clearTimeout(timer)},[]);
  return <main className="mobile-splash mobile-employee-startup">
    {showMark&&<div className="mobile-logo-pulse"><span>D</span></div>}
    <h1>Damasio OS</h1>
    <p>{message}</p>
    <SeasonalFieldScene />
    <button className="mobile-skip-splash" onClick={onOpen}>Open app</button>
  </main>
}
