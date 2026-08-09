"use client";

import {useEffect,useMemo,useRef,type CSSProperties} from "react";

type Season="spring"|"summer"|"fall"|"winter";

const OPENING_MS=3300;

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

function SunIcon(){return <svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="#f5a900" strokeWidth="5" strokeLinecap="round"><path d="M50 4v16M50 80v16M4 50h16M80 50h16M17 17l12 12M71 71l12 12M83 17 71 29M29 71 17 83"/></g><circle cx="50" cy="50" r="28" fill="url(#sunGlow)" stroke="#f7b500" strokeWidth="4"/><defs><radialGradient id="sunGlow" cx="38%" cy="32%"><stop offset="0" stopColor="#fff9a6"/><stop offset=".45" stopColor="#ffd92f"/><stop offset="1" stopColor="#ff9d00"/></radialGradient></defs></svg>}
function SpringIcon(){return <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M49 89C47 60 42 38 27 17" fill="none" stroke="#397f2a" strokeWidth="5" strokeLinecap="round"/><path d="M28 20C12 20 8 36 17 48 30 47 37 37 28 20Z" fill="#79bd4b"/><path d="M42 45C51 25 67 23 78 30 75 47 62 57 42 55Z" fill="#5fa538"/><path d="M52 62C62 49 77 51 86 60 78 75 65 79 52 73Z" fill="#3f8e2c"/><path d="M24 50C12 51 9 65 17 74 31 71 35 61 24 50Z" fill="#68ad3c"/></svg>}
function FallIcon(){return <svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 6 58 27 73 18 69 38 91 34 76 50 88 58 64 61 66 83 53 70 50 94 47 69 33 83 36 61 12 58 24 49 9 34 31 38 27 18 43 27Z" fill="url(#fallLeaf)" stroke="#dc6f08" strokeWidth="2.5" strokeLinejoin="round"/><path d="M50 61v31" stroke="#a44c08" strokeWidth="4" strokeLinecap="round"/><defs><linearGradient id="fallLeaf" x1="25" y1="15" x2="76" y2="82"><stop stopColor="#ffd13b"/><stop offset=".52" stopColor="#ff8b1f"/><stop offset="1" stopColor="#d9540b"/></linearGradient></defs></svg>}
function SnowIcon(){return <svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="#31a9df" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><path d="M50 7v86M13 28l74 44M13 72l74-44"/><path d="m50 7-9 12M50 7l9 12M50 93l-9-12M50 93l9-12M13 28l15 1M13 28l7 13M87 72l-15-1M87 72l-7-13M13 72l15-1M13 72l7-13M87 28l-15 1M87 28l-7 13"/></g></svg>}

function SeasonalOpening({onFinished}:{onFinished:()=>void}){
  const season=useMemo(()=>currentSeason(),[]);
  const rotation=seasonRotation(season);
  useEffect(()=>{
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer=window.setTimeout(onFinished,reduced?900:OPENING_MS);
    return()=>window.clearTimeout(timer);
  },[onFinished]);
  const orbitStyle={"--target-rotation":rotation.target,"--counter-rotation":rotation.counter} as CSSProperties;
  return <div className={`seasonal-opening seasonal-opening-${season}`} aria-label={`4Ever Seasons opening. Current season: ${season}.`}>
    <div className="seasonal-opening-stage">
      <div className="seasonal-emblem">
        <div className="seasonal-halo"/>
        <div className="seasonal-orbit" style={orbitStyle}>
          <div className={`seasonal-icon seasonal-summer ${season==="summer"?"is-current":""}`}><span className="seasonal-icon-inner"><SunIcon/></span></div>
          <div className={`seasonal-icon seasonal-fall ${season==="fall"?"is-current":""}`}><span className="seasonal-icon-inner"><FallIcon/></span></div>
          <div className={`seasonal-icon seasonal-winter ${season==="winter"?"is-current":""}`}><span className="seasonal-icon-inner"><SnowIcon/></span></div>
          <div className={`seasonal-icon seasonal-spring ${season==="spring"?"is-current":""}`}><span className="seasonal-icon-inner"><SpringIcon/></span></div>
        </div>
        <div className="seasonal-four">4</div>
      </div>
      <div className="seasonal-wordmark"><strong><span>4</span>Ever</strong><strong>Seasons</strong><small>PROPERTY MAINTENANCE</small><i/></div>
    </div>
    <style jsx global>{`
      .four-ever-splash{padding:0!important;overflow:hidden!important;background:#f8f1df!important}
      .seasonal-opening{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 50% 31%,rgba(255,255,255,.98) 0 16%,rgba(255,248,226,.97) 42%,#f1e6c9 100%);color:#154d29}
      .seasonal-opening:before,.seasonal-opening:after{content:"";position:absolute;pointer-events:none;filter:blur(14px);opacity:.46}
      .seasonal-opening:before{width:52vw;height:52vw;max-width:420px;max-height:420px;left:-18vw;bottom:-16vw;background:radial-gradient(ellipse at 30% 65%,rgba(93,137,42,.52),transparent 57%),radial-gradient(ellipse at 58% 38%,rgba(143,173,61,.34),transparent 55%);transform:rotate(-24deg)}
      .seasonal-opening:after{width:44vw;height:44vw;max-width:350px;max-height:350px;right:-12vw;top:-13vw;background:radial-gradient(ellipse at 45% 35%,rgba(198,155,76,.32),transparent 60%);transform:rotate(20deg)}
      .seasonal-opening-stage{position:relative;z-index:1;width:min(84vw,430px);display:flex;flex-direction:column;align-items:center;transform:translateY(-2vh)}
      .seasonal-emblem{--orbit-radius:min(31vw,146px);position:relative;width:min(72vw,340px);aspect-ratio:1;display:grid;place-items:center}
      .seasonal-halo{position:absolute;inset:7%;border:1.5px solid rgba(194,142,36,.58);border-radius:50%;opacity:0;box-shadow:0 0 0 9px rgba(255,220,102,.07),0 0 38px rgba(255,199,69,.17);animation:seasonHaloIn .55s ease .42s forwards}
      .seasonal-four{position:relative;z-index:4;margin-top:-1%;font-family:Georgia,'Times New Roman',serif;font-size:clamp(132px,39vw,190px);font-weight:500;line-height:.76;letter-spacing:-.09em;background:linear-gradient(145deg,#77b536 2%,#1d792d 47%,#0c4c24 94%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 5px 6px rgba(31,95,37,.1));animation:seasonFourReveal .7s cubic-bezier(.18,.82,.2,1) both}
      .seasonal-four:after{content:"";position:absolute;width:28%;height:8%;right:11%;bottom:14%;border-radius:80% 10% 80% 10%;background:linear-gradient(110deg,#286f2f,#6cac35);transform:rotate(-18deg);transform-origin:left center;opacity:.92}
      .seasonal-orbit{--target-rotation:1440deg;--counter-rotation:-1440deg;position:absolute;inset:0;z-index:5;opacity:0;animation:seasonIconsIn .35s ease .48s forwards,seasonOrbit 2.42s cubic-bezier(.16,.68,.16,1) .56s forwards;will-change:transform}
      .seasonal-icon{position:absolute;left:50%;top:50%;width:clamp(52px,15vw,72px);height:clamp(52px,15vw,72px);display:grid;place-items:center;filter:drop-shadow(0 6px 6px rgba(31,70,31,.12));transform-origin:center center}
      .seasonal-icon-inner{display:grid;width:100%;height:100%;animation:seasonCounterOrbit 2.42s cubic-bezier(.16,.68,.16,1) .56s forwards;will-change:transform}
      .seasonal-icon svg{width:100%;height:100%;overflow:visible}
      .seasonal-summer{transform:translate(-50%,-50%) rotate(0deg) translateY(calc(-1 * var(--orbit-radius))) rotate(0deg)}
      .seasonal-fall{transform:translate(-50%,-50%) rotate(90deg) translateY(calc(-1 * var(--orbit-radius))) rotate(-90deg)}
      .seasonal-winter{transform:translate(-50%,-50%) rotate(180deg) translateY(calc(-1 * var(--orbit-radius))) rotate(-180deg)}
      .seasonal-spring{transform:translate(-50%,-50%) rotate(270deg) translateY(calc(-1 * var(--orbit-radius))) rotate(-270deg)}
      .seasonal-icon.is-current svg{animation:seasonCurrentGlow .62s ease 2.72s both;transform-origin:center}
      .seasonal-wordmark{margin-top:clamp(14px,3.5vh,28px);display:flex;flex-direction:column;align-items:center;opacity:0;transform:translateY(12px);animation:seasonWordmarkIn .62s cubic-bezier(.2,.8,.2,1) 2.28s forwards}
      .seasonal-wordmark strong{font-family:Georgia,'Times New Roman',serif;color:#174d28;font-size:clamp(45px,13vw,62px);font-weight:500;line-height:.78;letter-spacing:-.055em}
      .seasonal-wordmark strong:first-child{margin-left:-.06em}
      .seasonal-wordmark strong:first-child span{font-size:1.06em}
      .seasonal-wordmark small{margin-top:22px;color:#215c31;font-family:Arial,sans-serif;font-size:clamp(10px,2.9vw,13px);font-weight:700;letter-spacing:.28em}
      .seasonal-wordmark i{position:relative;width:118px;height:1px;margin-top:16px;background:linear-gradient(90deg,transparent,#6c9b3c 24%,#6c9b3c 76%,transparent)}
      .seasonal-wordmark i:after{content:"";position:absolute;left:50%;top:50%;width:13px;height:20px;border-radius:100% 0 100% 0;background:#66a733;transform:translate(-50%,-50%) rotate(36deg);box-shadow:0 0 0 5px #f6eed8}
      @keyframes seasonFourReveal{0%{opacity:0;transform:scale(.74);filter:blur(6px)}60%{opacity:1;transform:scale(1.04);filter:blur(0)}100%{opacity:1;transform:scale(1);filter:blur(0)}}
      @keyframes seasonHaloIn{to{opacity:1}}
      @keyframes seasonIconsIn{from{opacity:0;filter:blur(4px)}to{opacity:1;filter:blur(0)}}
      @keyframes seasonOrbit{0%{transform:rotate(0deg)}68%{transform:rotate(calc(var(--target-rotation) - 38deg))}86%{transform:rotate(calc(var(--target-rotation) + 8deg))}100%{transform:rotate(var(--target-rotation))}}
      @keyframes seasonCounterOrbit{0%{transform:rotate(0deg)}68%{transform:rotate(calc(var(--counter-rotation) + 38deg))}86%{transform:rotate(calc(var(--counter-rotation) - 8deg))}100%{transform:rotate(var(--counter-rotation))}}
      @keyframes seasonCurrentGlow{0%{filter:none;transform:scale(1)}55%{filter:drop-shadow(0 0 13px rgba(255,189,39,.52));transform:scale(1.16)}100%{filter:drop-shadow(0 4px 7px rgba(31,70,31,.14));transform:scale(1.08)}}
      @keyframes seasonWordmarkIn{to{opacity:1;transform:translateY(0)}}
      @media(max-height:700px){.seasonal-opening-stage{transform:translateY(-1vh)}.seasonal-emblem{--orbit-radius:min(25vh,128px);width:min(59vh,300px)}.seasonal-wordmark{margin-top:8px}.seasonal-wordmark small{margin-top:15px}.seasonal-wordmark i{margin-top:11px}}
      @media(prefers-reduced-motion:reduce){.seasonal-four,.seasonal-halo,.seasonal-orbit,.seasonal-icon-inner,.seasonal-icon.is-current svg,.seasonal-wordmark{animation-duration:.01ms!important;animation-delay:0ms!important}.seasonal-orbit{transform:rotate(var(--target-rotation))!important;opacity:1!important}.seasonal-icon-inner{transform:rotate(var(--counter-rotation))!important}.seasonal-wordmark{opacity:1!important;transform:none!important}}
    `}</style>
  </div>
}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  openRef.current=onOpen;
  return <main className="mobile-splash mobile-employee-startup four-ever-splash">
    <SeasonalOpening onFinished={()=>openRef.current()}/>
  </main>
}
