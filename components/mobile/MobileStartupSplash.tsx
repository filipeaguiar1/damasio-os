"use client";

import {useEffect,useMemo,useRef,type CSSProperties} from "react";

type Season="spring"|"summer"|"fall"|"winter";

const OPENING_MS=5600;

function currentSeason(date=new Date()):Season{
  const month=date.getMonth();
  if(month>=2&&month<=4)return"spring";
  if(month>=5&&month<=7)return"summer";
  if(month>=8&&month<=10)return"fall";
  return"winter";
}

function seasonRotation(season:Season){
  const degrees=season==="summer"?1440:season==="fall"?1350:season==="winter"?1260:1170;
  return{target:`${degrees}deg`,counter:`${-degrees}deg`};
}

function SunIcon(){
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><radialGradient id="openingSun" cx="38%" cy="30%"><stop offset="0" stopColor="#fff8b0"/><stop offset=".48" stopColor="#ffd332"/><stop offset="1" stopColor="#f59a00"/></radialGradient></defs>
    <g stroke="#e9a313" strokeWidth="4.6" strokeLinecap="round" opacity=".92"><path d="M60 7v16M60 97v16M7 60h16M97 60h16M22 22l11 11M87 87l11 11M98 22 87 33M33 87 22 98"/></g>
    <circle cx="60" cy="60" r="27" fill="url(#openingSun)" stroke="#f4b417" strokeWidth="3.5"/>
  </svg>;
}

function SpringIcon(){
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="openingSpring" x1="18" y1="20" x2="94" y2="102"><stop stopColor="#9bca57"/><stop offset=".55" stopColor="#5e9f37"/><stop offset="1" stopColor="#397b2d"/></linearGradient></defs>
    <path d="M57 105C55 77 49 48 31 21" fill="none" stroke="#4b7f31" strokeWidth="4.7" strokeLinecap="round"/>
    <path d="M33 24C16 23 9 39 18 53 34 54 43 41 33 24Z" fill="url(#openingSpring)"/>
    <path d="M48 52C57 31 76 28 91 37 87 56 71 66 48 63Z" fill="#73ac42"/>
    <path d="M59 72C69 56 88 57 101 68 92 85 75 91 59 84Z" fill="#468c32"/>
    <path d="M31 61C17 61 12 76 21 86 37 82 42 71 31 61Z" fill="#68a83c"/>
  </svg>;
}

function FallIcon(){
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="openingFall" x1="25" y1="18" x2="92" y2="98"><stop stopColor="#f8cf40"/><stop offset=".42" stopColor="#eb8b1d"/><stop offset="1" stopColor="#ba4c16"/></linearGradient></defs>
    <path d="M60 10 69 34 87 22 82 45 108 41 91 60 103 70 76 73 78 99 63 84 60 111 56 83 40 99 44 73 17 70 30 59 12 41 39 45 34 22 52 34Z" fill="url(#openingFall)" stroke="#c45a18" strokeWidth="2.4" strokeLinejoin="round"/>
    <path d="M60 76v34" stroke="#9b4317" strokeWidth="4" strokeLinecap="round"/>
  </svg>;
}

function SnowIcon(){
  return <svg viewBox="0 0 120 120" aria-hidden="true">
    <g stroke="#4da9d1" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d="M60 9v102M16 34l88 52M16 86l88-52"/>
      <path d="m60 9-11 14M60 9l11 14M60 111l-11-14M60 111l11-14M16 34l18 1M16 34l8 16M104 86l-18-1M104 86l-8-16M16 86l18-1M16 86l8-16M104 34l-18 1M104 34l-8 16"/>
    </g>
  </svg>;
}

function SeasonalOpening({onFinished}:{onFinished:()=>void}){
  const season=useMemo(()=>currentSeason(),[]);
  const rotation=seasonRotation(season);

  useEffect(()=>{
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer=window.setTimeout(onFinished,reduced?1200:OPENING_MS);
    return()=>window.clearTimeout(timer);
  },[onFinished]);

  const orbitStyle={"--target-rotation":rotation.target,"--counter-rotation":rotation.counter} as CSSProperties;

  return <div className={`seasonal-opening seasonal-opening-${season}`} aria-label={`4Ever Seasons opening. Current season: ${season}.`}>
    <div className="seasonal-paper-noise"/>
    <svg className="seasonal-corner seasonal-corner-spring" viewBox="0 0 210 260" aria-hidden="true">
      <path d="M-8 247C45 213 52 162 86 117 111 84 141 56 208 31" fill="none" stroke="#658944" strokeWidth="5" strokeLinecap="round" opacity=".5"/>
      <g fill="#789b48" opacity=".42"><ellipse cx="40" cy="205" rx="35" ry="13" transform="rotate(-38 40 205)"/><ellipse cx="68" cy="169" rx="31" ry="12" transform="rotate(22 68 169)"/><ellipse cx="91" cy="126" rx="34" ry="13" transform="rotate(-22 91 126)"/><ellipse cx="124" cy="89" rx="28" ry="11" transform="rotate(30 124 89)"/><ellipse cx="161" cy="57" rx="31" ry="12" transform="rotate(-15 161 57)"/></g>
    </svg>
    <svg className="seasonal-corner seasonal-corner-fall" viewBox="0 0 220 250" aria-hidden="true">
      <path d="M218 16C165 48 151 92 122 128 96 161 66 189 12 227" fill="none" stroke="#b87a31" strokeWidth="4.5" strokeLinecap="round" opacity=".28"/>
      <g fill="#c8752a" opacity=".22"><path d="m175 42 8 18 14-8-5 19 19-2-14 13 8 9-21 1 2 20-12-11-2 21-5-20-13 12 5-20-20-3 11-8-13-13 20 3-3-19 14 9Z"/><path d="m70 172 8 18 14-8-5 19 19-2-14 13 8 9-21 1 2 20-12-11-2 21-5-20-13 12 5-20-20-3 11-8-13-13 20 3-3-19 14 9Z"/></g>
    </svg>
    <svg className="seasonal-corner seasonal-corner-winter" viewBox="0 0 220 220" aria-hidden="true">
      <g stroke="#75b4cf" strokeWidth="3" strokeLinecap="round" opacity=".2"><path d="M185 12v86M148 34l74 44M148 78l74-44"/><path d="M43 125v76M10 145l66 38M10 183l66-38"/></g>
    </svg>

    <div className="seasonal-opening-stage">
      <div className="seasonal-brand-kicker">FOUR SEASONS · ONE STANDARD</div>
      <div className="seasonal-emblem">
        <div className="seasonal-halo seasonal-halo-outer"/>
        <div className="seasonal-halo seasonal-halo-inner"/>
        <div className="seasonal-spark seasonal-spark-a"/><div className="seasonal-spark seasonal-spark-b"/><div className="seasonal-spark seasonal-spark-c"/>
        <div className="seasonal-orbit" style={orbitStyle}>
          <div className={`seasonal-icon seasonal-summer ${season==="summer"?"is-current":""}`}><span className="seasonal-icon-inner"><SunIcon/></span></div>
          <div className={`seasonal-icon seasonal-fall ${season==="fall"?"is-current":""}`}><span className="seasonal-icon-inner"><FallIcon/></span></div>
          <div className={`seasonal-icon seasonal-winter ${season==="winter"?"is-current":""}`}><span className="seasonal-icon-inner"><SnowIcon/></span></div>
          <div className={`seasonal-icon seasonal-spring ${season==="spring"?"is-current":""}`}><span className="seasonal-icon-inner"><SpringIcon/></span></div>
        </div>
        <div className="seasonal-four-wrap"><div className="seasonal-four">4</div><div className="seasonal-four-leaf"/></div>
      </div>
      <div className="seasonal-wordmark">
        <div className="seasonal-wordmark-name"><span className="seasonal-wordmark-four">4</span><span>Ever</span> <span>Seasons</span></div>
        <div className="seasonal-wordmark-rule"><i/></div>
        <small>PROPERTY MAINTENANCE</small>
      </div>
      <div className="seasonal-loading-line"><span/></div>
    </div>

    <style jsx global>{`
      .four-ever-splash{padding:0!important;overflow:hidden!important;background:#f3ecd9!important}
      .seasonal-opening{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 38%,#fffdf7 0 13%,#faf5e7 42%,#efe5cd 100%);color:#174d2b}
      .seasonal-paper-noise{position:absolute;inset:0;pointer-events:none;opacity:.28;background-image:radial-gradient(circle at 15% 24%,rgba(107,75,29,.055) 0 1px,transparent 1.3px),radial-gradient(circle at 72% 68%,rgba(107,75,29,.045) 0 1px,transparent 1.2px);background-size:18px 18px,23px 23px;mix-blend-mode:multiply}
      .seasonal-opening:before{content:"";position:absolute;inset:-12%;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,transparent 47%,rgba(123,91,39,.055) 72%,rgba(88,62,24,.09) 100%)}
      .seasonal-corner{position:absolute;pointer-events:none;opacity:0;filter:blur(.1px);animation:seasonCornerIn 1.25s ease .35s forwards}
      .seasonal-corner-spring{left:-34px;bottom:-30px;width:min(52vw,265px)}
      .seasonal-corner-fall{right:-40px;top:-28px;width:min(48vw,250px)}
      .seasonal-corner-winter{right:-38px;bottom:-32px;width:min(42vw,220px)}
      .seasonal-opening-stage{position:relative;z-index:2;width:min(88vw,460px);display:flex;flex-direction:column;align-items:center;transform:translateY(-1.2vh)}
      .seasonal-brand-kicker{height:18px;margin-bottom:4px;font:600 clamp(8px,2.2vw,10px)/1.2 Arial,sans-serif;letter-spacing:.34em;color:#7b815b;opacity:0;transform:translateY(-5px);animation:seasonKickerIn .7s ease 4.42s forwards}
      .seasonal-emblem{--orbit-radius:min(29.5vw,145px);position:relative;width:min(76vw,360px);aspect-ratio:1;display:grid;place-items:center}
      .seasonal-halo{position:absolute;border-radius:50%;opacity:0;pointer-events:none}
      .seasonal-halo-outer{inset:3.5%;border:1px solid rgba(190,147,67,.37);box-shadow:0 0 55px rgba(211,173,86,.08);animation:seasonHaloOuter 1s ease .65s forwards}
      .seasonal-halo-inner{inset:13%;border:1px solid rgba(192,151,71,.22);animation:seasonHaloInner .9s ease .82s forwards}
      .seasonal-four-wrap{position:relative;z-index:4;width:48%;height:62%;display:grid;place-items:center;opacity:0;transform:scale(.83);animation:seasonFourReveal 1.08s cubic-bezier(.16,.78,.18,1) .08s forwards}
      .seasonal-four{font-family:Georgia,'Times New Roman',serif;font-size:clamp(144px,41vw,202px);font-weight:500;line-height:.72;letter-spacing:-.105em;background:linear-gradient(154deg,#87b944 0%,#367d35 44%,#174e2b 78%,#0f3f26 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 8px 8px rgba(34,79,37,.08))}
      .seasonal-four-leaf{position:absolute;width:28%;height:8%;right:11%;bottom:18%;border-radius:95% 9% 92% 8%;background:linear-gradient(110deg,#2f7333,#77a944);transform:rotate(-18deg) scaleX(0);transform-origin:left center;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);animation:seasonFourLeaf .58s cubic-bezier(.17,.82,.2,1) .74s forwards}
      .seasonal-four-leaf:after{content:"";position:absolute;left:7%;top:52%;width:82%;height:1px;background:rgba(239,250,221,.38);transform:rotate(-7deg);transform-origin:left}
      .seasonal-orbit{--target-rotation:1440deg;--counter-rotation:-1440deg;position:absolute;inset:0;z-index:6;opacity:0;animation:seasonIconsIn .85s ease .92s forwards,seasonOrbit 3.45s cubic-bezier(.12,.67,.12,1) 1.16s forwards;will-change:transform}
      .seasonal-icon{position:absolute;left:50%;top:50%;width:clamp(48px,14.5vw,70px);height:clamp(48px,14.5vw,70px);display:grid;place-items:center;filter:drop-shadow(0 6px 7px rgba(45,64,34,.11));transform-origin:center center}
      .seasonal-icon-inner{display:grid;width:100%;height:100%;animation:seasonCounterOrbit 3.45s cubic-bezier(.12,.67,.12,1) 1.16s forwards;will-change:transform}
      .seasonal-icon svg{width:100%;height:100%;overflow:visible}
      .seasonal-summer{transform:translate(-50%,-50%) rotate(0deg) translateY(calc(-1 * var(--orbit-radius))) rotate(0deg)}
      .seasonal-fall{transform:translate(-50%,-50%) rotate(90deg) translateY(calc(-1 * var(--orbit-radius))) rotate(-90deg)}
      .seasonal-winter{transform:translate(-50%,-50%) rotate(180deg) translateY(calc(-1 * var(--orbit-radius))) rotate(-180deg)}
      .seasonal-spring{transform:translate(-50%,-50%) rotate(270deg) translateY(calc(-1 * var(--orbit-radius))) rotate(-270deg)}
      .seasonal-icon.is-current svg{transform-origin:center;animation:seasonCurrentGlow .72s cubic-bezier(.2,.8,.2,1) 4.42s both}
      .seasonal-spark{position:absolute;z-index:3;width:4px;height:4px;border-radius:50%;background:#d7b657;opacity:0;box-shadow:0 0 0 3px rgba(215,182,87,.09)}
      .seasonal-spark-a{left:22%;top:24%;animation:seasonSpark 1.25s ease 1.08s forwards}.seasonal-spark-b{right:20%;bottom:27%;animation:seasonSpark 1.2s ease 1.45s forwards}.seasonal-spark-c{right:24%;top:20%;animation:seasonSpark 1.1s ease 2.05s forwards}
      .seasonal-wordmark{margin-top:clamp(4px,1.1vh,10px);display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(13px);animation:seasonWordmarkIn .78s cubic-bezier(.18,.8,.18,1) 4.35s forwards}
      .seasonal-wordmark-name{font-family:Georgia,'Times New Roman',serif;color:#184d2b;font-size:clamp(41px,11.2vw,58px);font-weight:500;line-height:.9;letter-spacing:-.052em;white-space:nowrap}
      .seasonal-wordmark-name>span:last-child{color:#366f36}
      .seasonal-wordmark-four{display:inline-block;margin-right:-.03em;color:#2e7435;font-size:1.06em}
      .seasonal-wordmark-rule{position:relative;width:min(65vw,275px);height:17px;margin-top:9px;display:grid;place-items:center}
      .seasonal-wordmark-rule:before,.seasonal-wordmark-rule:after{content:"";position:absolute;top:8px;width:42%;height:1px;background:linear-gradient(90deg,transparent,#8da16c)}
      .seasonal-wordmark-rule:before{left:0}.seasonal-wordmark-rule:after{right:0;transform:scaleX(-1)}
      .seasonal-wordmark-rule i{display:block;width:12px;height:18px;border-radius:100% 0 100% 0;background:linear-gradient(145deg,#89b64a,#4d8b35);transform:rotate(40deg);box-shadow:0 0 0 4px #f6f0df}
      .seasonal-wordmark small{margin-top:3px;color:#416a42;font:700 clamp(9px,2.45vw,11px)/1 Arial,sans-serif;letter-spacing:.31em}
      .seasonal-loading-line{width:min(48vw,205px);height:2px;margin-top:24px;border-radius:999px;background:rgba(35,85,43,.09);overflow:hidden;opacity:0;animation:seasonLoadingFade .35s ease 1.05s forwards}
      .seasonal-loading-line span{display:block;width:100%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#88aa54,#276c36,#c79c3f);transform:translateX(-102%);animation:seasonLoading 3.75s cubic-bezier(.2,.65,.18,1) 1.12s forwards}
      @keyframes seasonCornerIn{to{opacity:1}}
      @keyframes seasonKickerIn{to{opacity:.72;transform:translateY(0)}}
      @keyframes seasonHaloOuter{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:scale(1)}}
      @keyframes seasonHaloInner{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
      @keyframes seasonFourReveal{0%{opacity:0;transform:scale(.83);filter:blur(6px)}58%{opacity:1;transform:scale(1.035);filter:blur(0)}100%{opacity:1;transform:scale(1);filter:blur(0)}}
      @keyframes seasonFourLeaf{to{transform:rotate(-18deg) scaleX(1)}}
      @keyframes seasonIconsIn{0%{opacity:0;filter:blur(5px)}100%{opacity:1;filter:blur(0)}}
      @keyframes seasonOrbit{0%{transform:rotate(0deg)}62%{transform:rotate(calc(var(--target-rotation) - 74deg))}82%{transform:rotate(calc(var(--target-rotation) + 12deg))}93%{transform:rotate(calc(var(--target-rotation) - 3deg))}100%{transform:rotate(var(--target-rotation))}}
      @keyframes seasonCounterOrbit{0%{transform:rotate(0deg)}62%{transform:rotate(calc(var(--counter-rotation) + 74deg))}82%{transform:rotate(calc(var(--counter-rotation) - 12deg))}93%{transform:rotate(calc(var(--counter-rotation) + 3deg))}100%{transform:rotate(var(--counter-rotation))}}
      @keyframes seasonCurrentGlow{0%{filter:none;transform:scale(1)}52%{filter:drop-shadow(0 0 16px rgba(222,177,56,.42));transform:scale(1.17)}100%{filter:drop-shadow(0 5px 8px rgba(42,75,33,.12));transform:scale(1.1)}}
      @keyframes seasonSpark{0%{opacity:0;transform:scale(.2)}35%{opacity:.8;transform:scale(1.15)}100%{opacity:0;transform:scale(.35)}}
      @keyframes seasonWordmarkIn{to{opacity:1;transform:translateY(0)}}
      @keyframes seasonLoadingFade{to{opacity:1}}
      @keyframes seasonLoading{0%{transform:translateX(-102%)}78%{transform:translateX(-8%)}100%{transform:translateX(0)}}
      @media(max-height:720px){.seasonal-opening-stage{transform:translateY(-.5vh)}.seasonal-brand-kicker{margin-bottom:0}.seasonal-emblem{--orbit-radius:min(24.5vh,128px);width:min(58vh,310px)}.seasonal-wordmark{margin-top:0}.seasonal-wordmark-rule{margin-top:5px}.seasonal-loading-line{margin-top:14px}}
      @media(prefers-reduced-motion:reduce){.seasonal-corner,.seasonal-brand-kicker,.seasonal-halo,.seasonal-four-wrap,.seasonal-four-leaf,.seasonal-orbit,.seasonal-icon-inner,.seasonal-icon.is-current svg,.seasonal-wordmark,.seasonal-loading-line,.seasonal-loading-line span{animation-duration:.01ms!important;animation-delay:0ms!important}.seasonal-corner{opacity:1!important}.seasonal-brand-kicker,.seasonal-wordmark,.seasonal-loading-line{opacity:1!important;transform:none!important}.seasonal-four-wrap{opacity:1!important;transform:none!important}.seasonal-orbit{transform:rotate(var(--target-rotation))!important;opacity:1!important}.seasonal-icon-inner{transform:rotate(var(--counter-rotation))!important}.seasonal-loading-line span{transform:none!important}}
    `}</style>
  </div>;
}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  return <main className="mobile-splash mobile-employee-startup four-ever-splash">
    <SeasonalOpening onFinished={()=>openRef.current()}/>
  </main>;
}
