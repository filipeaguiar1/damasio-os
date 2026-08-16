export type ServiceKey = "weekly_lawn"|"biweekly_lawn"|"one_time_lawn"|"spring_cleanup"|"fall_cleanup"|"snow_removal"|"extra_service";

// V50.1 Production Stabilization
// One canonical quote size type for all quote calculators/forms.
// medium and large are kept as safe compatibility aliases so older UI/state code
// can still build without changing the current layout.
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

export const HST_RATE = 0.13;
export const serviceLabels: Record<ServiceKey,string>={weekly_lawn:"Weekly Lawn Care",biweekly_lawn:"Biweekly Lawn Care",one_time_lawn:"One-Time Lawn Cut",spring_cleanup:"Spring Cleanup",fall_cleanup:"Fall Cleanup",snow_removal:"Snow Removal",extra_service:"Extra Service Request"};
export const basePrices: Record<ServiceKey,number>={weekly_lawn:45,biweekly_lawn:55,one_time_lawn:70,spring_cleanup:185,fall_cleanup:210,snow_removal:55,extra_service:0};
export const memberships=[{name:"Essential",price:149,description:"Routine maintenance."},{name:"Premium",price:189,description:"Priority scheduling."},{name:"Elite",price:249,description:"Year-round priority care."}];

export const sizeMultiplier: Record<QuoteSizeKey,number>={
  xs:.85,
  small:1,
  medium:1,
  large:1.45,
  legacy:1.45,
  xlarge:2.1,
  oversize:2.1
};

const grassHeightFees: Record<GrassHeightKey, number> = { "2in": 0, "3in": 0, "4in": 10, "5in": 20 };
const grassHandlingFees: Record<GrassHandlingKey, number> = { mulched: 0, bag_green_bin: 8, bag_leave_property: 12, removed: 25, no_preference: 0 };
const cleanupLeafFees: Record<CleanupLeafLevelKey, number> = { light: 0, moderate: 45, heavy: 95, not_sure: 35 };
const cleanupDebrisFees: Record<CleanupDebrisLevelKey, number> = { light: 0, typical: 35, wooded: 75 };
const cleanupDisposalFees: Record<CleanupDisposalKey, number> = { haul_away: 65, bag_leave_property: 20, mulch_wooded_area: 0, quote_both: 35 };
const cleanupVisitFees: Record<CleanupVisitCountKey, number> = { one: 0, two: 90, unlimited: 180 };
const snowDrivewayFees: Record<SnowDrivewaySizeKey, number> = { one_car: 0, two_car: 15, three_car: 30, four_plus: 55, custom: 80 };
const snowAreaFees: Record<SnowAreaKey, number> = { under_500: 0, "500_1000": 15, "1000_1500": 30, "1500_plus": 55 };
const snowSidewalkFees: Record<SnowSidewalkKey, number> = { no: 0, front_walk: 15, sidewalk_steps: 30, all_paved: 45 };
const snowSaltFees: Record<SnowSaltKey, number> = { no: 0, yes: 20, quote_both: 10 };

export function calculateQuote(input:{
  service:ServiceKey;
  size:QuoteSizeKey;
  difficulty?:DifficultyKey;
  grassHeight?:GrassHeightKey;
  grassHandling?:GrassHandlingKey;
  cleanupLeafLevel?:CleanupLeafLevelKey;
  cleanupDebrisLevel?:CleanupDebrisLevelKey;
  cleanupDisposal?:CleanupDisposalKey;
  cleanupVisitCount?:CleanupVisitCountKey;
  snowDrivewaySize?:SnowDrivewaySizeKey;
  snowArea?:SnowAreaKey;
  snowSidewalk?:SnowSidewalkKey;
  snowSalt?:SnowSaltKey;
  snowBilling?:SnowBillingKey;
  backyard?:boolean;
  gated?:boolean;
  annual?:boolean;
}){
  let subtotal=basePrices[input.service]*sizeMultiplier[input.size];
  subtotal+=input.difficulty==="yes"?15:0;
  if(input.service==="weekly_lawn"||input.service==="biweekly_lawn"||input.service==="one_time_lawn"){
    subtotal+=input.grassHeight?grassHeightFees[input.grassHeight]:0;
    subtotal+=input.grassHandling?grassHandlingFees[input.grassHandling]:0;
  }
  if(input.service==="spring_cleanup"||input.service==="fall_cleanup"){
    subtotal+=input.cleanupLeafLevel?cleanupLeafFees[input.cleanupLeafLevel]:0;
    subtotal+=input.cleanupDebrisLevel?cleanupDebrisFees[input.cleanupDebrisLevel]:0;
    subtotal+=input.cleanupDisposal?cleanupDisposalFees[input.cleanupDisposal]:0;
    subtotal+=input.cleanupVisitCount?cleanupVisitFees[input.cleanupVisitCount]:0;
  }
  if(input.service==="snow_removal"){
    subtotal+=input.snowDrivewaySize?snowDrivewayFees[input.snowDrivewaySize]:0;
    subtotal+=input.snowArea?snowAreaFees[input.snowArea]:0;
    subtotal+=input.snowSidewalk?snowSidewalkFees[input.snowSidewalk]:0;
    subtotal+=input.snowSalt?snowSaltFees[input.snowSalt]:0;
  }
  const tax=subtotal*HST_RATE;
  return{subtotal:money(subtotal),tax:money(tax),total:money(subtotal+tax)}
}

function money(v:number){return Math.round(v*100)/100}
