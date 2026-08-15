import {
  normalizeOperationalSimulationInput,
  type OperationalSimulationInput,
} from "@/lib/simulator/operationalSimulator";

export const ADVANCED_SIMULATION_VERSION = 2 as const;
export const DEFAULT_ADVANCED_SIMULATION_NAMESPACE = "default";
export const MAX_ADVANCED_SIMULATION_NAMESPACE_LENGTH = 32;

export type AdvancedSimulationScenarioKey = "baseline" | "large_12_month" | "giant_20x50_12_month";

export type AdvancedSimulationScenario = {
  key: AdvancedSimulationScenarioKey;
  label: string;
  horizonMonths: number;
  horizonWeeks: number;
  customerCount: number;
  employeeCount: number;
  completedWeeks: number;
  liveVisitsPerEmployee: number;
  workDaysPerWeek: number;
  dailyCompanyCapacity: number;
  maxHomesPerEmployee: number;
  expectedCompletedVisits: number;
  expectedLiveVisits: number;
  expectedServiceRecords: number;
};

export type AdvancedSimulationScope = {
  version: typeof ADVANCED_SIMULATION_VERSION;
  companyId: string;
  companyToken: string;
  namespace: string;
  marker: string;
  source: string;
  emailPrefix: string;
  emailLikePattern: string;
  storagePrefix: string;
  runKey: string;
};

export const ADVANCED_SIMULATION_SCENARIOS: Record<AdvancedSimulationScenarioKey, AdvancedSimulationScenario> = {
  baseline: {
    key: "baseline",
    label: "Baseline · 60 customers / 2 employees / 8 weeks",
    horizonMonths: 2,
    horizonWeeks: 8,
    customerCount: 60,
    employeeCount: 2,
    completedWeeks: 8,
    liveVisitsPerEmployee: 4,
    workDaysPerWeek: 4,
    dailyCompanyCapacity: 15,
    maxHomesPerEmployee: 30,
    expectedCompletedVisits: 480,
    expectedLiveVisits: 8,
    expectedServiceRecords: 488,
  },
  large_12_month: {
    key: "large_12_month",
    label: "Large · 100 customers / 10 employees / 12-month horizon",
    horizonMonths: 12,
    horizonWeeks: 52,
    customerCount: 100,
    employeeCount: 10,
    completedWeeks: 46,
    liveVisitsPerEmployee: 2,
    workDaysPerWeek: 5,
    dailyCompanyCapacity: 25,
    maxHomesPerEmployee: 20,
    expectedCompletedVisits: 4600,
    expectedLiveVisits: 20,
    expectedServiceRecords: 4620,
  },
  giant_20x50_12_month: {
    key: "giant_20x50_12_month",
    label: "Giant · 1,000 customers / 20 employees / 50 houses weekly",
    horizonMonths: 12,
    horizonWeeks: 52,
    customerCount: 1000,
    employeeCount: 20,
    completedWeeks: 52,
    liveVisitsPerEmployee: 50,
    workDaysPerWeek: 5,
    dailyCompanyCapacity: 200,
    maxHomesPerEmployee: 50,
    expectedCompletedVisits: 52000,
    expectedLiveVisits: 1000,
    expectedServiceRecords: 53000,
  },
};

function requireCompanyId(companyId: string) {
  const value = String(companyId || "").trim();
  if (!value) throw new Error("Advanced simulation requires a company id.");
  return value;
}

export function normalizeAdvancedSimulationNamespace(value: unknown) {
  const namespace = String(value ?? DEFAULT_ADVANCED_SIMULATION_NAMESPACE).trim().toLowerCase();
  if (!namespace) return DEFAULT_ADVANCED_SIMULATION_NAMESPACE;
  if (namespace.length > MAX_ADVANCED_SIMULATION_NAMESPACE_LENGTH) {
    throw new Error(`Simulation namespace must be ${MAX_ADVANCED_SIMULATION_NAMESPACE_LENGTH} characters or fewer.`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(namespace)) {
    throw new Error("Simulation namespace may contain only lowercase letters, numbers and internal hyphens.");
  }
  return namespace;
}

export function normalizeAdvancedSimulationScenario(value: unknown): AdvancedSimulationScenarioKey {
  const key = String(value || "baseline") as AdvancedSimulationScenarioKey;
  if (!(key in ADVANCED_SIMULATION_SCENARIOS)) {
    throw new Error(`Unknown advanced simulation scenario: ${String(value || "")}`);
  }
  return key;
}

export function createAdvancedSimulationScope(companyIdInput: string, namespaceInput?: unknown): AdvancedSimulationScope {
  const companyId = requireCompanyId(companyIdInput);
  const namespace = normalizeAdvancedSimulationNamespace(namespaceInput);
  const companyToken = companyId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8) || "company";
  const emailPrefix = `ops-sim-v2-${companyToken}-${namespace}-`;

  return {
    version: ADVANCED_SIMULATION_VERSION,
    companyId,
    companyToken,
    namespace,
    marker: `[OPERATIONAL_SIMULATION_V2:${namespace}]`,
    source: `operational_simulator_v2:${namespace}`,
    emailPrefix,
    emailLikePattern: `${emailPrefix}%@4everseasons.test`,
    storagePrefix: `${companyId}/operational-simulation/${namespace}`,
    runKey: `${companyId}:${namespace}`,
  };
}

export function advancedScenarioInput(
  scenarioKeyInput: unknown,
  overrides: Partial<OperationalSimulationInput> = {},
): OperationalSimulationInput {
  const scenario = ADVANCED_SIMULATION_SCENARIOS[normalizeAdvancedSimulationScenario(scenarioKeyInput)];
  return normalizeOperationalSimulationInput({
    ...overrides,
    customerCount: scenario.customerCount,
    employeeCount: scenario.employeeCount,
    weeks: scenario.completedWeeks,
    workDaysPerWeek: scenario.workDaysPerWeek,
    dailyCompanyCapacity: scenario.dailyCompanyCapacity,
    maxHomesPerEmployee: scenario.maxHomesPerEmployee,
  });
}

export function expectedAdvancedSimulationCounts(scenarioKeyInput: unknown) {
  const scenario = ADVANCED_SIMULATION_SCENARIOS[normalizeAdvancedSimulationScenario(scenarioKeyInput)];
  return {
    completedVisits: scenario.expectedCompletedVisits,
    scheduledVisits: scenario.expectedLiveVisits,
    serviceRecords: scenario.expectedServiceRecords,
    customers: scenario.customerCount,
    employees: scenario.employeeCount,
    horizonMonths: scenario.horizonMonths,
    horizonWeeks: scenario.horizonWeeks,
    activeServiceWeeks: scenario.completedWeeks,
  };
}

export function advancedSimulationActiveWeekOffsets(scenarioKeyInput: unknown) {
  const scenario = ADVANCED_SIMULATION_SCENARIOS[normalizeAdvancedSimulationScenario(scenarioKeyInput)];
  const active = Math.max(1, scenario.completedWeeks);
  const horizon = Math.max(active, scenario.horizonWeeks);
  if (active === horizon) return Array.from({ length: active }, (_, index) => index);
  if (active === 1) return [horizon - 1];

  const offsets: number[] = [];
  for (let index = 0; index < active; index += 1) {
    offsets.push(Math.round(index * (horizon - 1) / (active - 1)));
  }
  return [...new Set(offsets)];
}

export function simulationWorkerName(index: number) {
  const number = Math.max(0, Math.trunc(index)) + 1;
  return `Simulation Worker ${String(number).padStart(2, "0")}`;
}

export function simulationCustomerNumber(index: number, totalCustomers: number) {
  const width = Math.max(2, String(Math.max(1, totalCustomers)).length);
  return String(Math.max(0, Math.trunc(index)) + 1).padStart(width, "0");
}

export function simulationWorkerIndex(customerIndex: number, employeeCount: number) {
  const count = Math.max(1, Math.trunc(employeeCount));
  return Math.max(0, Math.trunc(customerIndex)) % count;
}

export function simulationDailyGroups<T>(rows: T[], workDaysPerWeek: number) {
  const days = Math.max(1, Math.trunc(workDaysPerWeek));
  const groups: T[][] = Array.from({ length: days }, () => []);
  rows.forEach((row, index) => groups[index % days].push(row));
  return groups;
}
