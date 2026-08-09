"use client";

import {useCallback,useEffect,useMemo,useRef,type CSSProperties} from "react";

type Season="spring"|"summer"|"fall"|"winter";
const OPENING_MS=4400;

function currentSeason(date=new Date()):Season{
  const month=date.getMonth();
  if(month>=2&&month<=4)return"spring";
  if(month>=5&&month<=7)return"summer";
  if(month>=8&&month<=10)return"fall";
  return"winter";
}

function rotationFor(season:Season){
  const target=season==="summer"?1080:season==="fall"?990:season==="winter"?900:810;
  return{target:`${target}deg`,counter:`${-target}deg`};
}

function Sun(){return <svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="sunG"><stop stopColor="#fff6a8"/><stop offset=".55" stopColor="#ffd645"/><stop offset="1" stopColor="#f39a18"/></radialGradient></defs><g stroke="#e8a928" strokeWidth="4" strokeLinecap="round"><path d="M50 5v14M50 81v14M5 50h14M81 50h14M18 18l10 10M72 72l10 10M82 18 72 28M28 72 18 82"/></g><circle cx="50" cy="50" r="24" fill="url(#sunG)" stroke="#efb020" strokeWidth="2.5"/></svg>}
function Snow(){return <svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#6ab2d5" strokeWidth="4" strokeLinecap="round"><path d="M50 7v86M13 28l74 44M13 72l74-44"/><path d="m50 7-9 11M50 7l9 11M50 93l-9-11M50 93l9-11M13 28l15 1M13 28l6 13M87 72l-15-1M87 72l-6-13M13 72l15-1M13 72l6-13M87 28l-15 1M87 28l-6 13"/></g></svg>}
function Spring(){return <svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="leafG" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#9dc953"/><stop offset="1" stopColor="#3f7d32"/></linearGradient></defs><path d="M48 90C47 66 42 45 30 19" fill="none" stroke="#537f39" strokeWidth="4" strokeLinecap="round"/><path d="M31 20C14 18 10 36 19 48 34 49 42 36 31 20Z" fill="url(#leafG)"/><path d="M43 48C51 28 70 25 84 35 80 52 65 61 43 59Z" fill="#78ad45"/><path d="M54 66C63 52 80 53 91 64 83 79 68 83 54 77Z" fill="#4c8b35"/></svg>}
function Fall(){return <svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="fallG" x1=".2" y1=".1" x2=".8" y2="1"><stop stopColor="#f8cf45"/><stop offset=".45" stopColor="#ed8f24"/><stop offset="1" stopColor="#b84d1a"/></linearGradient></defs><path d="M50 8 58 29 73 18 69 39 92 35 77 52 88 61 65 63 68 84 53 72 50 95 46 72 31 84 35 63 12 61 24 51 8 35 31 39 27 18 42 29Z" fill="url(#fallG)" stroke="#c55c1c" strokeWidth="2"/><path d="M50 70v23" stroke="#9b4518" strokeWidth="3.5" strokeLinecap="round"/></svg>}

export function MobileStartupSplash({onOpen}:{onOpen:()=>void;showMark?:boolean;message?:string}){
  const openRef=useRef(onOpen);
  const doneRef=useRef(false);
  openRef.current=onOpen;
  const season=useMemo(()=>currentSeason(),[]);
  const rotation=rotationFor(season);

  const finish=useCallback(()=>{
    if(doneRef.current)return;
    doneRef.current=true;
    openRef.current();
  },[]);

  useEffect(()=>{
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer=window.setTimeout(finish,reduced?1500:OPENING_MS);
    return()=>window.clearTimeout(timer);
  },[finish]);

  const style={"--orbit-target":rotation.target,"--counter-target":rotation.counter} as CSSProperties;

  return <main className="ever-opening" style={style} aria-label="4Ever Seasons opening">
    <div className="ever-paper"/>
    <div className="ever-glow ever-glow-a"/><div className="ever-glow ever-glow-b"/>
    <svg className="ever-foliage ever-foliage-left" viewBox="0 0 240 420" aria-hidden="true"><path d="M-20 410C70 328 65 232 126 149 160 102 196 68 245 34" fill="none" stroke="#6f9150" strokeWidth="6" opacity=".24"/><g fill="#789b52" opacity=".18"><ellipse cx="50" cy="340" rx="50" ry="18" transform="rotate(-38 50 340)"/><ellipse cx="82" cy="287" rx="42" ry="16" transform="rotate(25 82 287)"/><ellipse cx="105" cy="226" rx="47" ry="17" transform="rotate(-25 105 226)"/><ellipse cx="149" cy="163" rx="42" ry="15" transform="rotate(31 149 163)"/></g></svg>
    <svg className="ever-foliage ever-foliage-right" viewBox="0 0 220 390" aria-hidden="true"><path d="M226 9C164 56 157 117 122 172 90 223 58 279 2 369" fill="none" stroke="#b67b3c" strokeWidth="5" opacity=".16"/><g fill="#c77d31" opacity=".12"><circle cx="173" cy="73" r="31"/><circle cx="120" cy="161" r="25"/><circle cx="68" cy="264" r="28"/></g></svg>

    <section className="ever-stage">
      <div className="ever-emblem">
        <div className="ever-ring ever-ring-outer"/><div className="ever-ring ever-ring-inner"/>
        <div className="ever-wheel">
          <div className={`ever-icon ever-summer ${season==="summer"?"is-current":""}`}><span><Sun/></span></div>
          <div className={`ever-icon ever-fall ${season==="fall"?"is-current":""}`}><span><Fall/></span></div>
          <div className={`ever-icon ever-winter ${season==="winter"?"is-current":""}`}><span><Snow/></span></div>
          <div className={`ever-icon ever-spring ${season==="spring"?"is-current":""}`}><span><Spring/></span></div>
        </div>
        <div className="ever-four-wrap"><span className="ever-four">4</span><i className="ever-leaf"/></div>
      </div>
      <div className="ever-wordmark"><div><strong>4</strong>Ever Seasons</div><span>PROPERTY MAINTENANCE</span></div>
    </section>

    <style jsx global>{`
      .ever-opening{position:fixed!important;inset:0!important;z-index:99999!important;display:grid!important;place-items:center!important;width:100vw!important;height:100dvh!important;overflow:hidden!important;background:radial-gradient(circle at 50% 37%,#fffdf8 0 16%,#faf5e8 43%,#f3ead5 100%)!important;color:#16482b!important}
      .ever-paper{position:absolute;inset:0;opacity:.26;background-image:radial-gradient(circle at 18% 22%,rgba(87,62,27,.055) 0 1px,transparent 1.3px),radial-gradient(circle at 73% 70%,rgba(87,62,27,.04) 0 1px,transparent 1.2px);background-size:19px 19px,25px 25px;mix-blend-mode:multiply}
      .ever-glow{position:absolute;border-radius:999px;filter:blur(60px);opacity:.2;pointer-events:none}.ever-glow-a{width:46vw;height:46vw;max-width:420px;max-height:420px;background:#e7cf91;top:18%;left:50%;transform:translateX(-50%)}.ever-glow-b{width:42vw;height:42vw;max-width:360px;max-height:360px;background:#9fca75;bottom:-8%;left:-8%;opacity:.1}
      .ever-foliage{position:absolute;pointer-events:none;opacity:0;animation:everFoliageIn 1.2s ease .55s forwards}.ever-foliage-left{left:-42px;bottom:-46px;width:min(50vw,270px)}.ever-foliage-right{right:-36px;top:-32px;width:min(44vw,235px)}
      .ever-stage{position:relative;z-index:2;width:min(86vw,430px);display:flex;flex-direction:column;align-items:center;transform:translateY(-1.5vh)}
      .ever-emblem{position:relative;width:min(78vw,370px);aspect-ratio:1;display:grid;place-items:center}
      .ever-ring{position:absolute;border-radius:50%;opacity:0}.ever-ring-outer{inset:5%;border:1px solid rgba(175,136,66,.42);box-shadow:0 0 48px rgba(196,154,77,.08);animation:everRingIn .8s ease .72s forwards}.ever-ring-inner{inset:15%;border:1px solid rgba(175,136,66,.20);animation:everRingIn .8s ease .9s forwards}
      .ever-four-wrap{position:relative;z-index:4;width:50%;height:61%;display:grid;place-items:center;opacity:0;transform:scale(.86);animation:everFourIn .95s cubic-bezier(.16,.78,.18,1) .08s forwards}
      .ever-four{font-family:Georgia,'Times New Roman',serif;font-size:clamp(152px,42vw,210px);font-weight:500;line-height:.74;letter-spacing:-.10em;background:linear-gradient(155deg,#89b84d 0%,#377d39 43%,#174f2c 76%,#0f3e26 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 10px 14px rgba(45,76,41,.13))}
      .ever-leaf{position:absolute;width:34%;height:15%;right:5%;top:18%;border-radius:100% 0 100% 0;background:linear-gradient(140deg,#a0c95e,#4f8b36);transform:rotate(-29deg);box-shadow:inset -5px -4px 10px rgba(36,88,40,.12)}
      .ever-wheel{position:absolute;inset:8%;z-index:5;opacity:0;transform:rotate(0deg);animation:everWheel 2.8s cubic-bezier(.14,.72,.13,1) .78s forwards}
      .ever-icon{position:absolute;width:22%;aspect-ratio:1;display:grid;place-items:center;filter:drop-shadow(0 6px 10px rgba(55,65,42,.10))}.ever-icon span{display:block;width:100%;height:100%;animation:everCounter 2.8s cubic-bezier(.14,.72,.13,1) .78s forwards}.ever-icon svg{width:100%;height:100%;display:block}.ever-summer{left:39%;top:-3%}.ever-fall{right:-3%;top:39%}.ever-winter{left:39%;bottom:-3%}.ever-spring{left:-3%;top:39%}
      .ever-icon.is-current{animation:everCurrent 1s ease 3.55s infinite alternate}
      .ever-wordmark{text-align:center;margin-top:-9px;opacity:0;transform:translateY(10px);animation:everWordmarkIn .85s ease 3.08s forwards}.ever-wordmark>div{font-family:Georgia,'Times New Roman',serif;font-size:clamp(31px,8.7vw,46px);letter-spacing:-.035em;color:#174c2c}.ever-wordmark strong{font-weight:600;color:#5b913b;margin-right:1px}.ever-wordmark>span{display:block;margin-top:7px;font:700 clamp(8px,2.35vw,11px)/1.2 Arial,sans-serif;letter-spacing:.34em;color:#876d43}
      @keyframes everFourIn{to{opacity:1;transform:scale(1)}}@keyframes everRingIn{to{opacity:1}}@keyframes everFoliageIn{to{opacity:1}}@keyframes everWheel{0%{opacity:0;transform:rotate(0deg)}12%{opacity:1}100%{opacity:1;transform:rotate(var(--orbit-target))}}@keyframes everCounter{to{transform:rotate(var(--counter-target))}}@keyframes everWordmarkIn{to{opacity:1;transform:translateY(0)}}@keyframes everCurrent{from{filter:drop-shadow(0 6px 10px rgba(55,65,42,.10))}to{filter:drop-shadow(0 0 13px rgba(222,178,67,.48)) drop-shadow(0 6px 10px rgba(55,65,42,.10))}}
      @media(prefers-reduced-motion:reduce){.ever-opening *{animation-duration:.01ms!important;animation-delay:0ms!important;animation-iteration-count:1!important}.ever-wheel{opacity:1;transform:rotate(var(--orbit-target))}.ever-icon span{transform:rotate(var(--counter-target))}.ever-wordmark,.ever-ring,.ever-four-wrap,.ever-foliage{opacity:1;transform:none}}
    `}</style>
  </main>;
}
