"use client";

import {useEffect,useRef} from "react";

function FourEverOpening(){
  return <div className="four-ever-opening" aria-hidden="true">
    <img src="/brand/4ever-seasons-opening.png" alt=""/>
  </div>
}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  useEffect(()=>{const timer=window.setTimeout(()=>openRef.current(),2600);return()=>window.clearTimeout(timer)},[]);
  return <main className="mobile-splash mobile-employee-startup four-ever-splash">
    <FourEverOpening/>
    <button className="mobile-skip-splash four-ever-skip" onClick={onOpen}>Open app</button>
  </main>
}
