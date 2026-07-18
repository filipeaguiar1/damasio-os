"use client";

import {useEffect,useRef} from "react";

function FourEverOpening({onFinished}:{onFinished:()=>void}){
  return <div className="four-ever-opening" aria-hidden="true">
    <video
      autoPlay
      muted
      playsInline
      preload="auto"
      poster="/brand/4ever-seasons-opening.png"
      onEnded={onFinished}
    >
      <source src="/brand/4ever-seasons-opening.mp4" type="video/mp4"/>
    </video>
  </div>
}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  useEffect(()=>{const timer=window.setTimeout(()=>openRef.current(),12000);return()=>window.clearTimeout(timer)},[]);
  return <main className="mobile-splash mobile-employee-startup four-ever-splash">
    <FourEverOpening onFinished={()=>openRef.current()}/>
    <button className="mobile-skip-splash four-ever-skip" onClick={onOpen}>Open app</button>
  </main>
}
