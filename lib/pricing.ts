export type ServiceKey = "weekly_lawn"|"biweekly_lawn"|"one_time_lawn"|"spring_cleanup"|"fall_cleanup"|"snow_removal"|"extra_service"|"year_care";
export type QuoteSizeKey = "xs" | "small" | "medium" | "large" | "xlarge" | "legacy" | "oversize";
export type SizeKey = QuoteSizeKey;
export type GrassHeightKey = "2in" | "3in" | "4in" | "5in";
export type GrassHandlingKey = "mulched" | "bag_green_bin" | "bag_leave_property" | "removed" | "no_preference";
export type DifficultyKey = "yes" | "no";
export type CleanupLeafLevelKey = "light" | "moderate" | "heavy" | "not_sure";
export type CleanupDebrisLevelKey = "light" | "typical" | "wooded";
export type CleanupDisposalKey = "haul_away" | "bag_leave_property" | "mulch_wooded_area" | "quote_both";
export type CleanupVisitCountKey = "one" | "two" | "unlimited";
export type SnowDrivewaySizeKey = "one_car" | "two_car" | "three_car" | "four_plus" | "custom";
export type SnowAreaKey = "under_500" | "500_1000" | "1000_1500" | "1500_plus";
export type SnowSidewalkKey = "no" | "front_walk" | "sidewalk_steps" | "all_paved";
export type SnowSaltKey = "no" | "yes" | "quote_both";
export type SnowBillingKey = "per_storm" | "seasonal" | "both";

export type ServicePricingRule = {
  base:number;
  sizeMultipliers:Record<QuoteSizeKey,number>;
  difficultyFee:number;
  grassHeightFees?:Record<GrassHeightKey,number>;
  grassHandlingFees?:Record<GrassHandlingKey,number>;
  cleanupLeafFees?:Record<CleanupLeafLevelKey,number>;
  cleanupDebrisFees?:Record<CleanupDebrisLevelKey,number>;
  cleanupDisposalFees?:Record<CleanupDisposalKey,number>;
  cleanupVisitFees?:Record<CleanupVisitCountKey,number>;
  snowDrivewayFees?:Record<SnowDrivewaySizeKey,number>;
  snowAreaFees?:Record<SnowAreaKey,number>;
  snowSidewalkFees?:Record<SnowSidewalkKey,number>;
  snowSaltFees?:Record<SnowSaltKey,number>;
};

export type PricingConfig={
  services:Record<ServiceKey,ServicePricingRule>;
  memberships:{routine:number;seasonal:number;year_care:number};
};

export const HST_RATE=0.13;
export const serviceLabels:Record<ServiceKey,string>={weekly_lawn:"Weekly Lawn Care",biweekly_lawn:"Biweekly Lawn Care",one_time_lawn:"One-Time Lawn Cut",spring_cleanup:"Spring Cleanup",fall_cleanup:"Fall Cleanup",snow_removal:"Snow Removal",extra_service:"Extra Service Request",year_care:"Year Care"};

const SIZE:Record<QuoteSizeKey,number>={xs:.85,small:1,medium:1,large:1.45,legacy:1.45,xlarge:2.1,oversize:2.1};
const HEIGHT:Record<GrassHeightKey,number>={"2in":0,"3in":0,"4in":10,"5in":20};
const HANDLING:Record<GrassHandlingKey,number>={mulched:0,bag_green_bin:8,bag_leave_property:12,removed:25,no_preference:0};
const LEAF:Record<CleanupLeafLevelKey,number>={light:0,moderate:45,heavy:95,not_sure:35};
const DEBRIS:Record<CleanupDebrisLevelKey,number>={light:0,typical:35,wooded:75};
const DISPOSAL:Record<CleanupDisposalKey,number>={haul_away:65,bag_leave_property:20,mulch_wooded_area:0,quote_both:35};
const VISITS:Record<CleanupVisitCountKey,number>={one:0,two:90,unlimited:180};
const DRIVEWAY:Record<SnowDrivewaySizeKey,number>={one_car:0,two_car:15,three_car:30,four_plus:55,custom:80};
const SNOW_AREA:Record<SnowAreaKey,number>={under_500:0,"500_1000":15,"1000_1500":30,"1500_plus":55};
const SIDEWALK:Record<SnowSidewalkKey,number>={no:0,front_walk:15,sidewalk_steps:30,all_paved:45};
const SALT:Record<SnowSaltKey,number>={no:0,yes:20,quote_both:10};

function lawn(base:number):ServicePricingRule{return{base,sizeMultipliers:{...SIZE},difficultyFee:15,grassHeightFees:{...HEIGHT},grassHandlingFees:{...HANDLING}}}
function cleanup(base:number):ServicePricingRule{return{base,sizeMultipliers:{...SIZE},difficultyFee:15,cleanupLeafFees:{...LEAF},cleanupDebrisFees:{...DEBRIS},cleanupDisposalFees:{...DISPOSAL},cleanupVisitFees:{...VISITS}}}
function snow(base:number):ServicePricingRule{return{base,sizeMultipliers:{...SIZE},difficultyFee:15,snowDrivewayFees:{...DRIVEWAY},snowAreaFees:{...SNOW_AREA},snowSidewalkFees:{...SIDEWALK},snowSaltFees:{...SALT}}}
function simple(base:number):ServicePricingRule{return{base,sizeMultipliers:{...SIZE},difficultyFee:0}}

export const defaultPricingConfig:PricingConfig={
  services:{weekly_lawn:lawn(45),biweekly_lawn:lawn(55),one_time_lawn:lawn(70),spring_cleanup:cleanup(185),fall_cleanup:cleanup(210),snow_removal:snow(55),extra_service:simple(0),year_care:simple(0)},
  memberships:{routine:149,seasonal:189,year_care:249}
};

// Compatibility exports for older admin/storage surfaces.
export const basePrices:Record<ServiceKey,number>={weekly_lawn:45,biweekly_lawn:55,one_time_lawn:70,spring_cleanup:185,fall_cleanup:210,snow_removal:55,extra_service:0,year_care:0};
export const memberships=[{name:"Routine",price:149,description:"Routine maintenance."},{name:"Seasonal",price:189,description:"Seasonal planning."},{name:"Year Care",price:249,description:"Year-round priority care."}];
export const sizeMultiplier:Record<QuoteSizeKey,number>={...SIZE};

function valid(value:unknown,fallback:number){const n=Number(value);return Number.isFinite(n)&&n>=0?n:fallback}
function numbers<T extends string>(defaults:Record<T,number>,incoming:unknown):Record<T,number>{const source=(incoming&&typeof incoming==="object"?incoming:{}) as Record<string,unknown>;return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,valid(source[key],Number(value))])) as Record<T,number>}

export function normalizePricingConfig(input?:unknown):PricingConfig{
  const source=(input&&typeof input==="object"?input:{}) as any;
  const services={} as Record<ServiceKey,ServicePricingRule>;
  (Object.keys(defaultPricingConfig.services) as ServiceKey[]).forEach(key=>{
    const d=defaultPricingConfig.services[key];const s=source.services?.[key]||{};
    services[key]={base:valid(s.base,d.base),difficultyFee:valid(s.difficultyFee,d.difficultyFee),sizeMultipliers:numbers(d.sizeMultipliers,s.sizeMultipliers),
      ...(d.grassHeightFees?{grassHeightFees:numbers(d.grassHeightFees,s.grassHeightFees)}:{}),
      ...(d.grassHandlingFees?{grassHandlingFees:numbers(d.grassHandlingFees,s.grassHandlingFees)}:{}),
      ...(d.cleanupLeafFees?{cleanupLeafFees:numbers(d.cleanupLeafFees,s.cleanupLeafFees)}:{}),
      ...(d.cleanupDebrisFees?{cleanupDebrisFees:numbers(d.cleanupDebrisFees,s.cleanupDebrisFees)}:{}),
      ...(d.cleanupDisposalFees?{cleanupDisposalFees:numbers(d.cleanupDisposalFees,s.cleanupDisposalFees)}:{}),
      ...(d.cleanupVisitFees?{cleanupVisitFees:numbers(d.cleanupVisitFees,s.cleanupVisitFees)}:{}),
      ...(d.snowDrivewayFees?{snowDrivewayFees:numbers(d.snowDrivewayFees,s.snowDrivewayFees)}:{}),
      ...(d.snowAreaFees?{snowAreaFees:numbers(d.snowAreaFees,s.snowAreaFees)}:{}),
      ...(d.snowSidewalkFees?{snowSidewalkFees:numbers(d.snowSidewalkFees,s.snowSidewalkFees)}:{}),
      ...(d.snowSaltFees?{snowSaltFees:numbers(d.snowSaltFees,s.snowSaltFees)}:{})};
  });
  return{services,memberships:{routine:valid(source.memberships?.routine,149),seasonal:valid(source.memberships?.seasonal,189),year_care:valid(source.memberships?.year_care,249)}};
}

export function getRuntimePricingConfig():PricingConfig{
  const runtime=typeof globalThis!=="undefined"?(globalThis as any).__4EVER_PRICING_CONFIG__:null;
  return runtime?normalizePricingConfig(runtime):defaultPricingConfig;
}

export function calculateQuote(input:{service:ServiceKey;size:QuoteSizeKey;difficulty?:DifficultyKey;grassHeight?:GrassHeightKey;grassHandling?:GrassHandlingKey;cleanupLeafLevel?:CleanupLeafLevelKey;cleanupDebrisLevel?:CleanupDebrisLevelKey;cleanupDisposal?:CleanupDisposalKey;cleanupVisitCount?:CleanupVisitCountKey;snowDrivewaySize?:SnowDrivewaySizeKey;snowArea?:SnowAreaKey;snowSidewalk?:SnowSidewalkKey;snowSalt?:SnowSaltKey;snowBilling?:SnowBillingKey;backyard?:boolean;gated?:boolean;annual?:boolean},config:PricingConfig=getRuntimePricingConfig()){
  const rule=config.services[input.service]||defaultPricingConfig.services[input.service];
  let subtotal=rule.base*(rule.sizeMultipliers[input.size]??1);
  subtotal+=input.difficulty==="yes"?rule.difficultyFee:0;
  if(input.service==="weekly_lawn"||input.service==="biweekly_lawn"||input.service==="one_time_lawn"){
    subtotal+=input.grassHeight?rule.grassHeightFees?.[input.grassHeight]||0:0;
    subtotal+=input.grassHandling?rule.grassHandlingFees?.[input.grassHandling]||0:0;
  }
  if(input.service==="spring_cleanup"||input.service==="fall_cleanup"){
    subtotal+=input.cleanupLeafLevel?rule.cleanupLeafFees?.[input.cleanupLeafLevel]||0:0;
    subtotal+=input.cleanupDebrisLevel?rule.cleanupDebrisFees?.[input.cleanupDebrisLevel]||0:0;
    subtotal+=input.cleanupDisposal?rule.cleanupDisposalFees?.[input.cleanupDisposal]||0:0;
    subtotal+=input.cleanupVisitCount?rule.cleanupVisitFees?.[input.cleanupVisitCount]||0:0;
  }
  if(input.service==="snow_removal"){
    subtotal+=input.snowDrivewaySize?rule.snowDrivewayFees?.[input.snowDrivewaySize]||0:0;
    subtotal+=input.snowArea?rule.snowAreaFees?.[input.snowArea]||0:0;
    subtotal+=input.snowSidewalk?rule.snowSidewalkFees?.[input.snowSidewalk]||0:0;
    subtotal+=input.snowSalt?rule.snowSaltFees?.[input.snowSalt]||0:0;
  }
  const tax=subtotal*HST_RATE;return{subtotal:money(subtotal),tax:money(tax),total:money(subtotal+tax)};
}
function money(v:number){return Math.round(v*100)/100}
