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

export function calculateQuote(input:{service:ServiceKey;size:QuoteSizeKey;difficulty?:DifficultyKey;grassHeight?:GrassHeightKey;grassHandling?:GrassHandlingKey;backyard?:boolean;gated?:boolean;annual?:boolean}){
  let subtotal=basePrices[input.service]*sizeMultiplier[input.size];
  subtotal+=input.difficulty==="yes"?15:0;
  subtotal+=input.grassHeight?grassHeightFees[input.grassHeight]:0;
  subtotal+=input.grassHandling?grassHandlingFees[input.grassHandling]:0;
  const tax=subtotal*HST_RATE;
  return{subtotal:money(subtotal),tax:money(tax),total:money(subtotal+tax)}
}

function money(v:number){return Math.round(v*100)/100}
