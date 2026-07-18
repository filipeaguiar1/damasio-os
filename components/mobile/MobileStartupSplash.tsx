"use client";

import {useEffect,useRef} from "react";

function FourEverOpening(){
  return <div className="four-ever-opening" aria-hidden="true">
    <img src="/brand/4ever-seasons-opening.png" alt=""/>
    <span className="four-ever-motion summer"/>
    <span className="four-ever-motion autumn"/>
    <span className="four-ever-motion winter"/>
    <span className="four-ever-motion spring"/>
    <span className="four-ever-motion car-left"/>
    <span className="four-ever-motion car-right"/>
    <span className="four-ever-particles leaves"><i/><i/><i/><i/></span>
    <span className="four-ever-particles snow"><i/><i/><i/><i/><i/></span>
    <span className="four-ever-shine"/>
  </div>
}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  useEffect(()=>{const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;const timer=window.setTimeout(()=>openRef.current(),reduced?1300:5200);return()=>window.clearTimeout(timer)},[]);
  return <main className="mobile-splash mobile-employee-startup four-ever-splash">
    <FourEverOpening/>
    <button className="mobile-skip-splash four-ever-skip" onClick={onOpen}>Open app</button>
  </main>
}
