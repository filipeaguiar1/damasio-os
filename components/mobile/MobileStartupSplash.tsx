"use client";

import {useRef} from "react";

function FourEverOpening({onFinished}:{onFinished:()=>void}){
  return <div className="four-ever-opening" aria-hidden="true">
    <video
      autoPlay
      muted
      playsInline
      preload="auto"
      onEnded={onFinished}
      onError={onFinished}
    >
      <source src="/brand/4ever-seasons-opening.mp4" type="video/mp4"/>
    </video>
  </div>
}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  return <main className="mobile-splash mobile-employee-startup four-ever-splash">
    <FourEverOpening onFinished={()=>openRef.current()}/>
  </main>
}
