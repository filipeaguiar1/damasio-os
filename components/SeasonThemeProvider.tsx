"use client";
import {useEffect,useState} from "react";
import {loadSeasonTheme,readLocalSeasonTheme,SEASON_THEME_EVENT,type SeasonThemeConfig} from "@/lib/seasonTheme";

export function SeasonThemeProvider({children}:{children:React.ReactNode}){
  const[config,setConfig]=useState<SeasonThemeConfig>({mode:"auto",season:"summer",effectiveSeason:"summer"});
  useEffect(()=>{let active=true;const apply=(next:SeasonThemeConfig)=>{if(!active)return;setConfig(next);document.documentElement.dataset.season=next.effectiveSeason;document.documentElement.dataset.seasonMode=next.mode};apply(readLocalSeasonTheme());void loadSeasonTheme().then(apply);const on=(event:Event)=>apply((event as CustomEvent<SeasonThemeConfig>).detail||readLocalSeasonTheme());window.addEventListener(SEASON_THEME_EVENT,on);const timer=window.setInterval(()=>void loadSeasonTheme().then(apply),60000);return()=>{active=false;window.removeEventListener(SEASON_THEME_EVENT,on);window.clearInterval(timer)}},[]);
  return <><div className={`season-atmosphere ${config.effectiveSeason}`} aria-hidden="true"><div className="season-particles">{Array.from({length:18},(_,index)=><i key={index}/>)}</div></div>{children}</>
}
