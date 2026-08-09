"use client";

import {useCallback,useEffect,useRef} from "react";

const VIDEO_SRC="/brand/4ever-seasons-opening-image-summer.mp4";
const FALLBACK_MS=3500;
const LEGACY_NATIVE_STARTUP_UA="4EverSeasonsAndroid/52.1.5";

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  const finishedRef=useRef(false);
  openRef.current=onOpen;

  const finish=useCallback(()=>{
    if(finishedRef.current)return;
    finishedRef.current=true;
    openRef.current();
  },[]);

  useEffect(()=>{
    // v52.1.5 APK still owns a native startup player. Do not stack the web
    // opening on top of it; its remote cache is migrated by mobile-startup.json.
    if(window.navigator.userAgent.includes(LEGACY_NATIVE_STARTUP_UA)){
      finish();
      return;
    }
    const timer=window.setTimeout(finish,FALLBACK_MS);
    return()=>window.clearTimeout(timer);
  },[finish]);

  return <main className="mobile-splash mobile-employee-startup four-ever-splash-video">
    <video
      className="four-ever-opening-video"
      src={VIDEO_SRC}
      autoPlay
      muted
      playsInline
      preload="auto"
      onEnded={finish}
      onError={finish}
      aria-label="4Ever Seasons opening"
    />
    <style jsx global>{`
      .four-ever-splash-video{
        position:fixed!important;
        inset:0!important;
        z-index:99999!important;
        width:100vw!important;
        height:100dvh!important;
        min-height:100dvh!important;
        padding:0!important;
        overflow:hidden!important;
        background:#f4eddc!important;
      }
      .four-ever-opening-video{
        display:block;
        width:100%;
        height:100%;
        object-fit:cover;
        object-position:center;
        background:#f4eddc;
      }
    `}</style>
  </main>;
}
