export type PrepaidPlanType = "monthly" | "seasonal";

export type BillingCycleDraft = {
  cycleType: PrepaidPlanType;
  periodStartsOn: string;
  periodEndsOn: string;
  chargeDueOn: string;
  serviceAvailableOn: string;
  idempotencyKey: string;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function safeDay(year: number, month: number, day: number): Date {
  return utcDate(year, month, Math.min(day, lastDayOfMonth(year, month)));
}

/**
 * Creates one prepaid monthly coverage cycle.
 * Example: charge on the 1st, service available on the 5th, coverage until
 * the day before the next cycle begins.
 */
export function monthlyPrepaidCycle(input: {
  agreementId: string;
  year: number;
  month: number;
  billingDay?: number;
  serviceStartDay?: number;
}): BillingCycleDraft {
  const billingDay = input.billingDay ?? 1;
  const serviceStartDay = input.serviceStartDay ?? billingDay;
  const chargeDue = safeDay(input.year, input.month, billingDay);
  const periodStart = safeDay(input.year, input.month, serviceStartDay);
  const nextPeriodStart = safeDay(
    input.month === 11 ? input.year + 1 : input.year,
    (input.month + 1) % 12,
    serviceStartDay,
  );
  const periodEnd = new Date(nextPeriodStart.getTime() - 24 * 60 * 60 * 1000);

  return {
    cycleType: "monthly",
    periodStartsOn: isoDate(periodStart),
    periodEndsOn: isoDate(periodEnd),
    chargeDueOn: isoDate(chargeDue),
    serviceAvailableOn: isoDate(periodStart),
    idempotencyKey: `agreement:${input.agreementId}:monthly:${isoDate(periodStart)}`,
  };
}

/** Seasonal plans are prepaid for the contract coverage window. */
export function seasonalPrepaidCycle(input: {
  agreementId: string;
  contractStartsOn: string;
  contractEndsOn: string;
  chargeDueOn: string;
}): BillingCycleDraft {
  return {
    cycleType: "seasonal",
    periodStartsOn: input.contractStartsOn,
    periodEndsOn: input.contractEndsOn,
    chargeDueOn: input.chargeDueOn,
    serviceAvailableOn: input.contractStartsOn,
    idempotencyKey: `agreement:${input.agreementId}:season:${input.contractStartsOn}:${input.contractEndsOn}`,
  };
}

export function canActivatePrepaidCoverage(input: {
  cycleState: string;
  paidAt?: Date | null;
}): boolean {
  return input.cycleState === "paid" && Boolean(input.paidAt);
}
