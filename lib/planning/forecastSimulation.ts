export type ForecastServiceType = "lawn_care" | "sprinkler" | "snow_removal";

export type ForecastFrequency = "weekly" | "biweekly" | "monthly" | "seasonal" | "one_time";

export interface CanonicalPlanningReference {
  customerId?: string;
  propertyId?: string;
  quoteId?: string;
  jobId?: string;
  scheduleId?: string;
  dispatchId?: string;
  routeId?: string;
  visitId?: string;
}

export interface ForecastHouse {
  simulationId: string;
  label: string;
  serviceType: ForecastServiceType;
  frequency: ForecastFrequency;
  priceCad: number;
  serviceMinutes: number;
  routeMinutes: number;
  canonical?: CanonicalPlanningReference;
}

export interface ForecastCostInputs {
  laborHourlyCad: number;
  operatingCostPerHouseCad: number;
  vehiclePaymentMonthlyCad: number;
  vehicleInsuranceMonthlyCad: number;
  otherMonthlyOperatingCostsCad?: number;
}

export interface ForecastScenarioInput {
  id: string;
  label: string;
  houses: ForecastHouse[];
  crews: number;
  employeesPerCrew: number;
  workDaysPerWeek: number;
  productiveHoursPerCrewDay: number;
  costs: ForecastCostInputs;
  removable: true;
  productionWrites: false;
}

export interface ForecastScenarioResult {
  id: string;
  label: string;
  houses: number;
  crews: number;
  weeklyVisits: number;
  monthlyVisits: number;
  requiredCrewHoursWeekly: number;
  availableCrewHoursWeekly: number;
  capacityUtilizationPercent: number;
  routeHoursWeekly: number;
  serviceHoursWeekly: number;
  monthlyRevenueCad: number;
  monthlyLaborCad: number;
  monthlyOperatingCostsCad: number;
  monthlyVehiclePaymentCad: number;
  monthlyVehicleInsuranceCad: number;
  monthlyTotalCostsCad: number;
  monthlyProfitCad: number;
  profitable: boolean;
  capacityStatus: "available" | "near_capacity" | "over_capacity";
}

const WEEKS_PER_MONTH = 52 / 12;

const visitsPerWeek: Record<ForecastFrequency, number> = {
  weekly: 1,
  biweekly: 0.5,
  monthly: 12 / 52,
  seasonal: 1 / 13,
  one_time: 1 / 52,
};

export const BASELINE_SERVICE_PRICES_CAD: Record<ForecastServiceType, number> = {
  lawn_care: 40,
  sprinkler: 200,
  snow_removal: 229,
};

export function simulateForecastScenario(input: ForecastScenarioInput): ForecastScenarioResult {
  if (input.crews < 1 || input.employeesPerCrew < 1) throw new Error("A simulation requires at least one crew and one employee per crew.");
  if (input.workDaysPerWeek <= 0 || input.productiveHoursPerCrewDay <= 0) throw new Error("Capacity inputs must be greater than zero.");

  let weeklyVisits = 0;
  let weeklyServiceMinutes = 0;
  let weeklyRouteMinutes = 0;
  let monthlyRevenueCad = 0;
  let monthlyVariableOperatingCad = 0;

  for (const house of input.houses) {
    const frequency = visitsPerWeek[house.frequency];
    const monthlyVisits = frequency * WEEKS_PER_MONTH;
    weeklyVisits += frequency;
    weeklyServiceMinutes += house.serviceMinutes * frequency;
    weeklyRouteMinutes += house.routeMinutes * frequency;
    monthlyRevenueCad += house.priceCad * monthlyVisits;
    monthlyVariableOperatingCad += input.costs.operatingCostPerHouseCad * monthlyVisits;
  }

  const serviceHoursWeekly = weeklyServiceMinutes / 60;
  const routeHoursWeekly = weeklyRouteMinutes / 60;
  const requiredCrewHoursWeekly = serviceHoursWeekly + routeHoursWeekly;
  const availableCrewHoursWeekly = input.crews * input.workDaysPerWeek * input.productiveHoursPerCrewDay;
  const capacityUtilizationPercent = availableCrewHoursWeekly > 0 ? requiredCrewHoursWeekly / availableCrewHoursWeekly * 100 : 0;
  const monthlyLaborCad = requiredCrewHoursWeekly * WEEKS_PER_MONTH * input.employeesPerCrew * input.costs.laborHourlyCad;
  const monthlyOperatingCostsCad = monthlyVariableOperatingCad + (input.costs.otherMonthlyOperatingCostsCad ?? 0);
  const monthlyTotalCostsCad = monthlyLaborCad + monthlyOperatingCostsCad + input.costs.vehiclePaymentMonthlyCad + input.costs.vehicleInsuranceMonthlyCad;
  const monthlyProfitCad = monthlyRevenueCad - monthlyTotalCostsCad;

  return {
    id: input.id,
    label: input.label,
    houses: input.houses.length,
    crews: input.crews,
    weeklyVisits: round(weeklyVisits),
    monthlyVisits: round(weeklyVisits * WEEKS_PER_MONTH),
    requiredCrewHoursWeekly: round(requiredCrewHoursWeekly),
    availableCrewHoursWeekly: round(availableCrewHoursWeekly),
    capacityUtilizationPercent: round(capacityUtilizationPercent),
    routeHoursWeekly: round(routeHoursWeekly),
    serviceHoursWeekly: round(serviceHoursWeekly),
    monthlyRevenueCad: money(monthlyRevenueCad),
    monthlyLaborCad: money(monthlyLaborCad),
    monthlyOperatingCostsCad: money(monthlyOperatingCostsCad),
    monthlyVehiclePaymentCad: money(input.costs.vehiclePaymentMonthlyCad),
    monthlyVehicleInsuranceCad: money(input.costs.vehicleInsuranceMonthlyCad),
    monthlyTotalCostsCad: money(monthlyTotalCostsCad),
    monthlyProfitCad: money(monthlyProfitCad),
    profitable: monthlyProfitCad >= 0,
    capacityStatus: capacityUtilizationPercent > 100 ? "over_capacity" : capacityUtilizationPercent >= 85 ? "near_capacity" : "available",
  };
}

export function compareForecastScenarios(inputs: ForecastScenarioInput[]): ForecastScenarioResult[] {
  return inputs.map(simulateForecastScenario).sort((a, b) => b.monthlyProfitCad - a.monthlyProfitCad);
}

export function createBaselineHouseMix(houseCount: 25 | 30): ForecastHouse[] {
  return Array.from({ length: houseCount }, (_, index) => {
    const number = index + 1;
    if (number % 10 === 0) {
      return {
        simulationId: `sim-sprinkler-${number}`,
        label: `Planning property ${number}`,
        serviceType: "sprinkler",
        frequency: "monthly",
        priceCad: BASELINE_SERVICE_PRICES_CAD.sprinkler,
        serviceMinutes: 120,
        routeMinutes: 15,
      };
    }
    if (number % 6 === 0) {
      return {
        simulationId: `sim-snow-${number}`,
        label: `Planning property ${number}`,
        serviceType: "snow_removal",
        frequency: "seasonal",
        priceCad: BASELINE_SERVICE_PRICES_CAD.snow_removal,
        serviceMinutes: 35,
        routeMinutes: 12,
      };
    }
    return {
      simulationId: `sim-lawn-${number}`,
      label: `Planning property ${number}`,
      serviceType: "lawn_care",
      frequency: number % 4 === 0 ? "biweekly" : "weekly",
      priceCad: BASELINE_SERVICE_PRICES_CAD.lawn_care,
      serviceMinutes: 35,
      routeMinutes: 12,
    };
  });
}

export const BASELINE_FORECAST_SCENARIOS: ForecastScenarioInput[] = [25, 30].map((houseCount) => ({
  id: `planning-${houseCount}-houses`,
  label: `${houseCount}-house planning baseline`,
  houses: createBaselineHouseMix(houseCount as 25 | 30),
  crews: houseCount === 25 ? 1 : 2,
  employeesPerCrew: 1,
  workDaysPerWeek: 5,
  productiveHoursPerCrewDay: 7,
  costs: {
    laborHourlyCad: 22,
    operatingCostPerHouseCad: 6,
    vehiclePaymentMonthlyCad: 600,
    vehicleInsuranceMonthlyCad: 400,
    otherMonthlyOperatingCostsCad: 250,
  },
  removable: true,
  productionWrites: false,
}));

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}
