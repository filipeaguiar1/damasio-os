export type OperationalSimulationInput = {
  customerCount: number;
  employeeCount: number;
  weeks: number;
  weeklyPrice: number;
  hourlyWage: number;
  payrollBurdenRate: number;
  workDaysPerWeek: number;
  dailyCompanyCapacity: number;
  maxHomesPerEmployee: number;
  travelMinutesPerVisit: number;
  clippingPickupShare: number;
  clippingPickupMinutes: number;
  fuelCostPerVisit: number;
  equipmentCostPerVisit: number;
  vehiclePaymentMonthly: number;
  vehicleInsuranceMonthly: number;
  businessInsuranceMonthly: number;
  phoneSoftwareMonthly: number;
  marketingMonthly: number;
  paymentRate: number;
  paymentFixedFee: number;
  smallShare: number;
  mediumShare: number;
  largeShare: number;
  smallMinutes: number;
  mediumMinutes: number;
  largeMinutes: number;
  weatherRescheduleShare: number;
  lateVisitShare: number;
  serviceIssueShare: number;
  returnVisitShare: number;
  weatherAdminMinutes: number;
  lateMinutes: number;
  returnVisitMinutes: number;
  customerCreditPerIssue: number;
};

export type OperationalSimulationResult = {
  input: OperationalSimulationInput;
  visits: number;
  invoices: number;
  averageServiceMinutes: number;
  averageTotalMinutes: number;
  productiveHours: number;
  weeklyCrewHours: number;
  housesPerEmployeePerWeek: number;
  requiredHousesPerDay: number;
  availableHouses: number;
  capacityUtilizationRate: number;
  employeeCapacityUtilizationRate: number;
  capacityStatus: "within_capacity" | "at_capacity" | "over_capacity";
  subtotalRevenue: number;
  hst: number;
  customerTotal: number;
  effectiveHourlyCost: number;
  laborCost: number;
  routeDirectCost: number;
  fixedCost: number;
  paymentCost: number;
  totalCost: number;
  operatingProfit: number;
  operatingMarginRate: number;
  revenuePerProductiveHour: number;
  costPerVisit: number;
  profitPerVisit: number;
  breakEvenVisits: number;
  breakEvenCustomers: number;
  weatherRescheduledVisits: number;
  lateVisits: number;
  serviceIssueVisits: number;
  returnVisits: number;
  exceptionLaborHours: number;
  exceptionLaborCost: number;
  exceptionDirectCost: number;
  customerCredits: number;
  exceptionCost: number;
  revenueAtRisk: number;
  adjustedOperatingProfit: number;
  adjustedOperatingMarginRate: number;
};

export const defaultOperationalSimulationInput: OperationalSimulationInput = {
  customerCount: 60,
  employeeCount: 2,
  weeks: 8,
  weeklyPrice: 40,
  hourlyWage: 23,
  payrollBurdenRate: 0.18,
  workDaysPerWeek: 4,
  dailyCompanyCapacity: 15,
  maxHomesPerEmployee: 30,
  travelMinutesPerVisit: 5,
  clippingPickupShare: 0.25,
  clippingPickupMinutes: 8,
  fuelCostPerVisit: 2.75,
  equipmentCostPerVisit: 1.25,
  vehiclePaymentMonthly: 600,
  vehicleInsuranceMonthly: 400,
  businessInsuranceMonthly: 200,
  phoneSoftwareMonthly: 150,
  marketingMonthly: 200,
  paymentRate: 0.029,
  paymentFixedFee: 0.30,
  smallShare: 0.35,
  mediumShare: 0.45,
  largeShare: 0.20,
  smallMinutes: 20,
  mediumMinutes: 30,
  largeMinutes: 40,
  weatherRescheduleShare: 0.05,
  lateVisitShare: 0.08,
  serviceIssueShare: 0.03,
  returnVisitShare: 0.50,
  weatherAdminMinutes: 10,
  lateMinutes: 20,
  returnVisitMinutes: 30,
  customerCreditPerIssue: 10,
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function rate(value: number) {
  return Math.round(value * 10000) / 10000;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedRate(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

export function normalizeOperationalSimulationInput(
  partial: Partial<OperationalSimulationInput> = {},
): OperationalSimulationInput {
  const base = defaultOperationalSimulationInput;
  const normalized = {
    customerCount: Math.round(positive(Number(partial.customerCount), base.customerCount)),
    employeeCount: Math.round(positive(Number(partial.employeeCount), base.employeeCount)),
    weeks: Math.round(positive(Number(partial.weeks), base.weeks)),
    weeklyPrice: positive(Number(partial.weeklyPrice), base.weeklyPrice),
    hourlyWage: positive(Number(partial.hourlyWage), base.hourlyWage),
    payrollBurdenRate: boundedRate(Number(partial.payrollBurdenRate), base.payrollBurdenRate),
    workDaysPerWeek: Math.round(positive(Number(partial.workDaysPerWeek), base.workDaysPerWeek)),
    dailyCompanyCapacity: positive(Number(partial.dailyCompanyCapacity), base.dailyCompanyCapacity),
    maxHomesPerEmployee: positive(Number(partial.maxHomesPerEmployee), base.maxHomesPerEmployee),
    travelMinutesPerVisit: Math.max(0, Number(partial.travelMinutesPerVisit ?? base.travelMinutesPerVisit)),
    clippingPickupShare: boundedRate(Number(partial.clippingPickupShare), base.clippingPickupShare),
    clippingPickupMinutes: Math.max(0, Number(partial.clippingPickupMinutes ?? base.clippingPickupMinutes)),
    fuelCostPerVisit: Math.max(0, Number(partial.fuelCostPerVisit ?? base.fuelCostPerVisit)),
    equipmentCostPerVisit: Math.max(0, Number(partial.equipmentCostPerVisit ?? base.equipmentCostPerVisit)),
    vehiclePaymentMonthly: Math.max(0, Number(partial.vehiclePaymentMonthly ?? base.vehiclePaymentMonthly)),
    vehicleInsuranceMonthly: Math.max(0, Number(partial.vehicleInsuranceMonthly ?? base.vehicleInsuranceMonthly)),
    businessInsuranceMonthly: Math.max(0, Number(partial.businessInsuranceMonthly ?? base.businessInsuranceMonthly)),
    phoneSoftwareMonthly: Math.max(0, Number(partial.phoneSoftwareMonthly ?? base.phoneSoftwareMonthly)),
    marketingMonthly: Math.max(0, Number(partial.marketingMonthly ?? base.marketingMonthly)),
    paymentRate: boundedRate(Number(partial.paymentRate), base.paymentRate),
    paymentFixedFee: Math.max(0, Number(partial.paymentFixedFee ?? base.paymentFixedFee)),
    smallShare: boundedRate(Number(partial.smallShare), base.smallShare),
    mediumShare: boundedRate(Number(partial.mediumShare), base.mediumShare),
    largeShare: boundedRate(Number(partial.largeShare), base.largeShare),
    smallMinutes: positive(Number(partial.smallMinutes), base.smallMinutes),
    mediumMinutes: positive(Number(partial.mediumMinutes), base.mediumMinutes),
    largeMinutes: positive(Number(partial.largeMinutes), base.largeMinutes),
    weatherRescheduleShare: boundedRate(Number(partial.weatherRescheduleShare), base.weatherRescheduleShare),
    lateVisitShare: boundedRate(Number(partial.lateVisitShare), base.lateVisitShare),
    serviceIssueShare: boundedRate(Number(partial.serviceIssueShare), base.serviceIssueShare),
    returnVisitShare: boundedRate(Number(partial.returnVisitShare), base.returnVisitShare),
    weatherAdminMinutes: Math.max(0, Number(partial.weatherAdminMinutes ?? base.weatherAdminMinutes)),
    lateMinutes: Math.max(0, Number(partial.lateMinutes ?? base.lateMinutes)),
    returnVisitMinutes: Math.max(0, Number(partial.returnVisitMinutes ?? base.returnVisitMinutes)),
    customerCreditPerIssue: Math.max(0, Number(partial.customerCreditPerIssue ?? base.customerCreditPerIssue)),
  } satisfies OperationalSimulationInput;

  const shareTotal = normalized.smallShare + normalized.mediumShare + normalized.largeShare;
  if (shareTotal <= 0) {
    normalized.smallShare = base.smallShare;
    normalized.mediumShare = base.mediumShare;
    normalized.largeShare = base.largeShare;
  } else if (Math.abs(shareTotal - 1) > 0.0001) {
    normalized.smallShare /= shareTotal;
    normalized.mediumShare /= shareTotal;
    normalized.largeShare /= shareTotal;
  }

  return normalized;
}

export function calculateOperationalSimulation(
  partial: Partial<OperationalSimulationInput> = {},
): OperationalSimulationResult {
  const input = normalizeOperationalSimulationInput(partial);
  const averageServiceMinutes = input.smallShare * input.smallMinutes
    + input.mediumShare * input.mediumMinutes
    + input.largeShare * input.largeMinutes;
  const averageTotalMinutes = averageServiceMinutes
    + input.travelMinutesPerVisit
    + input.clippingPickupShare * input.clippingPickupMinutes;

  const visits = input.customerCount * input.weeks;
  const invoices = input.customerCount * Math.max(1, Math.ceil(input.weeks / 4));
  const productiveHours = visits * averageTotalMinutes / 60;
  const weeklyCrewHours = productiveHours / input.weeks;
  const housesPerEmployeePerWeek = input.customerCount / input.employeeCount;
  const requiredHousesPerDay = input.customerCount / input.workDaysPerWeek;
  const availableHouses = input.dailyCompanyCapacity * input.workDaysPerWeek;
  const capacityUtilizationRate = input.customerCount / availableHouses;
  const employeeCapacityUtilizationRate = housesPerEmployeePerWeek / input.maxHomesPerEmployee;
  const maxUtilization = Math.max(capacityUtilizationRate, employeeCapacityUtilizationRate);
  const capacityStatus = maxUtilization > 1.0001
    ? "over_capacity"
    : maxUtilization >= 0.95
      ? "at_capacity"
      : "within_capacity";

  const subtotalRevenue = visits * input.weeklyPrice;
  const hst = subtotalRevenue * 0.13;
  const customerTotal = subtotalRevenue + hst;
  const effectiveHourlyCost = input.hourlyWage * (1 + input.payrollBurdenRate);
  const laborCost = productiveHours * effectiveHourlyCost;
  const routeDirectCost = visits * (input.fuelCostPerVisit + input.equipmentCostPerVisit);
  const months = input.weeks / 4;
  const fixedCost = months * (
    input.vehiclePaymentMonthly
    + input.vehicleInsuranceMonthly
    + input.businessInsuranceMonthly
    + input.phoneSoftwareMonthly
    + input.marketingMonthly
  );
  const averageInvoiceTotal = customerTotal / invoices;
  const paymentCost = invoices * (averageInvoiceTotal * input.paymentRate + input.paymentFixedFee);
  const totalCost = laborCost + routeDirectCost + fixedCost + paymentCost;
  const operatingProfit = subtotalRevenue - totalCost;
  const operatingMarginRate = subtotalRevenue ? operatingProfit / subtotalRevenue : 0;
  const revenuePerProductiveHour = productiveHours ? subtotalRevenue / productiveHours : 0;
  const costPerVisit = visits ? totalCost / visits : 0;
  const profitPerVisit = input.weeklyPrice - costPerVisit;
  const variableCostPerVisit = averageTotalMinutes / 60 * effectiveHourlyCost
    + input.fuelCostPerVisit
    + input.equipmentCostPerVisit
    + input.weeklyPrice * 1.13 * input.paymentRate
    + input.paymentFixedFee / Math.max(1, input.weeks / 4);
  const contributionPerVisit = Math.max(0.01, input.weeklyPrice - variableCostPerVisit);
  const breakEvenVisits = Math.ceil(fixedCost / contributionPerVisit);
  const breakEvenCustomers = Math.ceil(breakEvenVisits / input.weeks);

  const weatherRescheduledVisits = Math.round(visits * input.weatherRescheduleShare);
  const lateVisits = Math.round(visits * input.lateVisitShare);
  const serviceIssueVisits = Math.round(visits * input.serviceIssueShare);
  const returnVisits = Math.round(serviceIssueVisits * input.returnVisitShare);
  const exceptionLaborHours = weatherRescheduledVisits * input.weatherAdminMinutes / 60
    + lateVisits * input.lateMinutes / 60
    + returnVisits * (input.returnVisitMinutes + input.travelMinutesPerVisit) / 60;
  const exceptionLaborCost = exceptionLaborHours * effectiveHourlyCost;
  const exceptionDirectCost = returnVisits * (input.fuelCostPerVisit + input.equipmentCostPerVisit);
  const customerCredits = serviceIssueVisits * input.customerCreditPerIssue;
  const exceptionCost = exceptionLaborCost + exceptionDirectCost + customerCredits;
  const revenueAtRisk = serviceIssueVisits * input.weeklyPrice;
  const adjustedOperatingProfit = operatingProfit - exceptionCost;
  const adjustedOperatingMarginRate = subtotalRevenue ? adjustedOperatingProfit / subtotalRevenue : 0;

  return {
    input,
    visits,
    invoices,
    averageServiceMinutes: rate(averageServiceMinutes),
    averageTotalMinutes: rate(averageTotalMinutes),
    productiveHours: rate(productiveHours),
    weeklyCrewHours: rate(weeklyCrewHours),
    housesPerEmployeePerWeek: rate(housesPerEmployeePerWeek),
    requiredHousesPerDay: rate(requiredHousesPerDay),
    availableHouses: rate(availableHouses),
    capacityUtilizationRate: rate(capacityUtilizationRate),
    employeeCapacityUtilizationRate: rate(employeeCapacityUtilizationRate),
    capacityStatus,
    subtotalRevenue: money(subtotalRevenue),
    hst: money(hst),
    customerTotal: money(customerTotal),
    effectiveHourlyCost: money(effectiveHourlyCost),
    laborCost: money(laborCost),
    routeDirectCost: money(routeDirectCost),
    fixedCost: money(fixedCost),
    paymentCost: money(paymentCost),
    totalCost: money(totalCost),
    operatingProfit: money(operatingProfit),
    operatingMarginRate: rate(operatingMarginRate),
    revenuePerProductiveHour: money(revenuePerProductiveHour),
    costPerVisit: money(costPerVisit),
    profitPerVisit: money(profitPerVisit),
    breakEvenVisits,
    breakEvenCustomers,
    weatherRescheduledVisits,
    lateVisits,
    serviceIssueVisits,
    returnVisits,
    exceptionLaborHours: rate(exceptionLaborHours),
    exceptionLaborCost: money(exceptionLaborCost),
    exceptionDirectCost: money(exceptionDirectCost),
    customerCredits: money(customerCredits),
    exceptionCost: money(exceptionCost),
    revenueAtRisk: money(revenueAtRisk),
    adjustedOperatingProfit: money(adjustedOperatingProfit),
    adjustedOperatingMarginRate: rate(adjustedOperatingMarginRate),
  };
}

export function visitServiceMinutes(index: number) {
  const cycle = index % 20;
  if (cycle < 7) return 20;
  if (cycle < 16) return 30;
  return 40;
}

export function visitCollectsClippings(index: number) {
  return index % 4 === 0;
}
