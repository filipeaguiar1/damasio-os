"use client";

import {useCallback,useEffect,useRef} from "react";

const OPENING_FALLBACK_MS=5500;
const OPENING_VIDEO="/brand/4ever-seasons-opening-current.mp4?v=20260809-pixverse-1";

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  const doneRef=useRef(false);
  openRef.current=onOpen;

  const finish=useCallback(()=>{
    if(doneRef.current)return;
    doneRef.current=true;
    openRef.current();
  },[]);

  useEffect(()=>{
    const timer=window.setTimeout(finish,OPENING_FALLBACK_MS);
    return()=>window.clearTimeout(timer);
  },[finish]);

  return <main className="four-ever-video-opening" aria-label="4Ever Seasons opening">
    <video
      autoPlay
      muted
      playsInline
      preload="auto"
      onEnded={finish}
      onError={finish}
      src={OPENING_VIDEO}
    />
    <style jsx global>{`
      .four-ever-video-opening{position:fixed!important;inset:0!important;z-index:99999!important;width:100vw!important;height:100dvh!important;overflow:hidden!important;background:#f4eddc!important}
      .four-ever-video-opening video{display:block!important;width:100%!important;height:100%!important;object-fit:cover!important;object-position:center!important;background:#f4eddc!important}
    `}</style>
  </main>;
}
