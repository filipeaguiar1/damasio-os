"use client";

import { useEffect } from "react";
import { defaultPricingConfig, normalizePricingConfig, type PricingConfig } from "@/lib/pricing";

export const PRICING_EVENT="4ever:pricing";

function applyPricing(config:PricingConfig){
  (globalThis as any).__4EVER_PRICING_CONFIG__=config;
  if(typeof window!=="undefined") window.dispatchEvent(new CustomEvent(PRICING_EVENT,{detail:config}));
}

function updateVisibleYearCarePrice(config:PricingConfig){
  if(typeof document==="undefined") return;
  const price=config.memberships.year_care;
  document.querySelectorAll<HTMLElement>(".year-care-price").forEach(node=>{node.textContent=`From $${price}/month`;});
  document.querySelectorAll<HTMLElement>(".plan-card-year .plan-price strong").forEach(node=>{node.textContent=`From $${price}`;});
  document.querySelectorAll<HTMLElement>(".premium-service-note").forEach(note=>{
    const title=note.querySelector("strong")?.textContent||"";
    const copy=note.querySelector<HTMLElement>("span");
    if(copy&&title.includes("Year Care")) copy.textContent=`Starts at $${price}/month. Final monthly price is confirmed after we review the property size and requested scope.`;
  });
}

export function PricingBootstrap(){
  useEffect(()=>{
    let alive=true;
    let current=defaultPricingConfig;
    const observer=new MutationObserver(()=>updateVisibleYearCarePrice(current));
    observer.observe(document.body,{childList:true,subtree:true});
    void fetch("/api/public/pricing",{cache:"no-store"})
      .then(response=>response.ok?response.json():Promise.reject(new Error("pricing")))
      .then(result=>{if(!alive)return;current=normalizePricingConfig(result?.config);applyPricing(current);updateVisibleYearCarePrice(current);})
      .catch(()=>{if(!alive)return;current=defaultPricingConfig;applyPricing(current);updateVisibleYearCarePrice(current);});
    return()=>{alive=false;observer.disconnect();};
  },[]);
  return null;
}
