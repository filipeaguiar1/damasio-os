import type { OperationalSimulationInput } from "@/lib/simulator/operationalSimulator";
import {
  expectedAdvancedSimulationCounts,
  type AdvancedSimulationScenarioKey,
  type AdvancedSimulationScope,
} from "@/lib/simulator/advancedSimulation";
import {
  ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
  type AdvancedSimulationReconciliation,
} from "@/lib/simulator/advancedSimulationData";

const PAGE_SIZE = 1000;
type ServiceClient = any;

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

async function fetchAllRows<T = any>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await queryPage(from, from + PAGE_SIZE - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

function expectedInvoiceTotals(input: OperationalSimulationInput) {
  const periods = Math.max(1, Math.ceil(input.weeks / 4));
  let perCustomerCollected = 0;
  for (let period = 0; period < periods; period += 1) {
    const coveredWeeks = Math.min(4, input.weeks - period * 4);
    const subtotal = money(input.weeklyPrice * coveredWeeks);
    perCustomerCollected += money(subtotal + money(subtotal * 0.13));
  }
  return {
    invoiceCount: input.customerCount * periods,
    collected: money(perCustomerCollected * input.customerCount),
  };
}

export async function reconcileAdvancedSimulationAtScale(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  scenarioKey: AdvancedSimulationScenarioKey,
  input: OperationalSimulationInput,
): Promise<AdvancedSimulationReconciliation> {
  const customers = await fetchAllRows<any>((from, to) => service
    .from("customers")
    .select("id")
    .or(companyFilter(scope.companyId))
    .like("email", scope.emailLikePattern)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .range(from, to));
  if (customers.error) throw new Error(customers.error.message || "customers pagination failed");
  const customerIds = customers.data.map(row => String(row.id));

  const workers = await fetchAllRows<any>((from, to) => service
    .from("profiles")
    .select("id")
    .eq("role", "employee")
    .eq("active", true)
    .or(companyFilter(scope.companyId))
    .like("email", scope.emailLikePattern)
    .order("id", { ascending: true })
    .range(from, to));
  if (workers.error) throw new Error(workers.error.message || "profiles pagination failed");

  if (!customerIds.length) {
    const expected = expectedAdvancedSimulationCounts(scenarioKey);
    return {
      passed: false,
      scenario: scenarioKey,
      namespace: scope.namespace,
      expected,
      visits: {
        expectedCompleted: expected.completedVisits,
        actualCompleted: 0,
        expectedScheduled: expected.scheduledVisits,
        actualScheduled: 0,
        passed: false,
      },
      invoices: {
        expectedCount: expectedInvoiceTotals(input).invoiceCount,
        actualPaidCount: 0,
        expectedSubtotal: 0,
        actualCollected: 0,
        expectedCollected: expectedInvoiceTotals(input).collected,
        passed: false,
      },
      payments: {
        protectedLedgerCount: 0,
        protectedLedgerAmount: 0,
        modeledSettlementCount: 0,
        modeledSettlementAmount: 0,
        rule: "Simulation settlement is modeled by paid canonical Invoices; provider-confirmed payments are never forged.",
        passed: false,
      },
      payroll: {
        productiveHours: 0,
        hourlyWage: input.hourlyWage,
        burdenRate: input.payrollBurdenRate,
        modeledLoadedCost: 0,
        source: "completed Visit duration_seconds",
        passed: false,
      },
      km: {
        kmPerCompletedVisit: ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
        modeledKm: 0,
        source: "canonical completed Visit count × explicit simulation km assumption",
        passed: false,
      },
      evidence: {
        expectedPhotos: expected.completedVisits,
        actualPhotos: 0,
        passed: false,
      },
    };
  }

  const properties = await fetchAllRows<any>((from, to) => service
    .from("properties")
    .select("id")
    .in("customer_id", customerIds)
    .order("id", { ascending: true })
    .range(from, to));
  if (properties.error) throw new Error(properties.error.message || "properties pagination failed");
  const propertyIds = properties.data.map(row => String(row.id));

  const visits = await fetchAllRows<any>((from, to) => service
    .from("visits")
    .select("id,status,duration_seconds,route_id")
    .in("customer_id", customerIds)
    .or(companyFilter(scope.companyId))
    .order("id", { ascending: true })
    .range(from, to));
  if (visits.error) throw new Error(visits.error.message || "visits pagination failed");

  const photos = propertyIds.length
    ? await fetchAllRows<any>((from, to) => service
        .from("photos")
        .select("id")
        .in("property_id", propertyIds)
        .order("id", { ascending: true })
        .range(from, to))
    : { data: [] as any[], error: null };
  if (photos.error) throw new Error(photos.error.message || "photos pagination failed");

  const invoices = await fetchAllRows<any>((from, to) => service
    .from("invoices")
    .select("id,status,subtotal,total")
    .in("customer_id", customerIds)
    .order("id", { ascending: true })
    .range(from, to));
  if (invoices.error) throw new Error(invoices.error.message || "invoices pagination failed");

  const payments = await fetchAllRows<any>((from, to) => service
    .from("payments")
    .select("id,status,amount")
    .in("customer_id", customerIds)
    .order("id", { ascending: true })
    .range(from, to));
  if (payments.error && !/permission denied|does not exist|schema cache/i.test(payments.error.message || "")) {
    throw new Error(payments.error.message || "payments pagination failed");
  }
  const paymentRows = payments.error ? [] : payments.data;

  const expected = expectedAdvancedSimulationCounts(scenarioKey);
  const invoiceExpected = expectedInvoiceTotals(input);
  const completedRows = visits.data.filter(row => row.status === "completed");
  const scheduledRows = visits.data.filter(row => row.status === "scheduled");
  const paidInvoiceRows = invoices.data.filter(row => row.status === "paid");
  const completedDurationSeconds = completedRows.reduce(
    (sum, row) => sum + Number(row.duration_seconds || 0),
    0,
  );
  const collected = money(paidInvoiceRows.reduce((sum, row) => sum + Number(row.total || 0), 0));
  const protectedPaymentAmount = money(paymentRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
  const productiveHours = completedDurationSeconds / 3600;
  const loadedPayroll = productiveHours * input.hourlyWage * (1 + input.payrollBurdenRate);
  const modeledKm = completedRows.length * ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT;

  const visitsPassed = completedRows.length === expected.completedVisits
    && scheduledRows.length === expected.scheduledVisits
    && customerIds.length === expected.customers
    && workers.data.length === expected.employees;
  const invoicePassed = paidInvoiceRows.length === invoiceExpected.invoiceCount
    && Math.abs(collected - invoiceExpected.collected) < 0.02;
  const paymentsPassed = paymentRows.length === 0 && protectedPaymentAmount === 0 && invoicePassed;
  const payrollPassed = visitsPassed && productiveHours > 0 && loadedPayroll > 0;
  const kmPassed = visitsPassed && modeledKm > 0;
  const evidencePassed = photos.data.length === expected.completedVisits;

  return {
    passed: visitsPassed && invoicePassed && paymentsPassed && payrollPassed && kmPassed && evidencePassed,
    scenario: scenarioKey,
    namespace: scope.namespace,
    expected,
    visits: {
      expectedCompleted: expected.completedVisits,
      actualCompleted: completedRows.length,
      expectedScheduled: expected.scheduledVisits,
      actualScheduled: scheduledRows.length,
      passed: visitsPassed,
    },
    invoices: {
      expectedCount: invoiceExpected.invoiceCount,
      actualPaidCount: paidInvoiceRows.length,
      expectedSubtotal: 0,
      actualCollected: collected,
      expectedCollected: invoiceExpected.collected,
      passed: invoicePassed,
    },
    payments: {
      protectedLedgerCount: paymentRows.length,
      protectedLedgerAmount: protectedPaymentAmount,
      modeledSettlementCount: paidInvoiceRows.length,
      modeledSettlementAmount: collected,
      rule: "Simulation settlement is modeled by paid canonical Invoices; provider-confirmed payments are never forged.",
      passed: paymentsPassed,
    },
    payroll: {
      productiveHours,
      hourlyWage: input.hourlyWage,
      burdenRate: input.payrollBurdenRate,
      modeledLoadedCost: money(loadedPayroll),
      source: "completed Visit duration_seconds",
      passed: payrollPassed,
    },
    km: {
      kmPerCompletedVisit: ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
      modeledKm: money(modeledKm),
      source: "canonical completed Visit count × explicit simulation km assumption",
      passed: kmPassed,
    },
    evidence: {
      expectedPhotos: expected.completedVisits,
      actualPhotos: photos.data.length,
      passed: evidencePassed,
    },
  };
}
