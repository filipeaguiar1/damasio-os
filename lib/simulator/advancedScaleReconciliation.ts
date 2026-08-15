import type { OperationalSimulationInput } from "@/lib/simulator/operationalSimulator";
import {
  expectedAdvancedSimulationCounts,
  type AdvancedSimulationScenarioKey,
  type AdvancedSimulationScope,
} from "@/lib/simulator/advancedSimulation";
import {
  ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
  type AdvancedSimulationDataStatus,
  type AdvancedSimulationReconciliation,
} from "@/lib/simulator/advancedSimulationData";

const PAGE_SIZE = 1000;
const FILTER_ID_BATCH_SIZE = 50;
type ServiceClient = any;
type QueryError = { message?: string } | null;
type QueryResult<T> = { data: T[]; error: QueryError };

function companyFilter(companyId: string) {
  return `company_id.eq.${companyId},organization_id.eq.${companyId}`;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

async function fetchAllRows<T = any>(
  queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: QueryError }>,
): Promise<QueryResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await queryPage(from, from + PAGE_SIZE - 1);
    if (result.error) return { data: rows, error: result.error };
    const page = result.data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { data: rows, error: null };
  }
}

async function fetchAllRowsByIds<T = any>(
  ids: string[],
  queryBatchPage: (
    batchIds: string[],
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: QueryError }>,
): Promise<QueryResult<T>> {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += FILTER_ID_BATCH_SIZE) {
    const batchIds = ids.slice(offset, offset + FILTER_ID_BATCH_SIZE);
    const batch = await fetchAllRows<T>((from, to) => queryBatchPage(batchIds, from, to));
    if (batch.error) return { data: rows, error: batch.error };
    rows.push(...batch.data);
  }
  return { data: rows, error: null };
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

export async function advancedSimulationDataStatusAtScale(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
): Promise<AdvancedSimulationDataStatus> {
  const customers = await fetchAllRows<any>((from, to) => service
    .from("customers")
    .select("id")
    .or(companyFilter(scope.companyId))
    .like("email", scope.emailLikePattern)
    .is("archived_at", null)
    .order("id", { ascending: true })
    .range(from, to));
  if (customers.error) throw new Error(`Scale status customers: ${customers.error.message || "pagination failed"}`);
  const customerIds = customers.data.map(row => String(row.id));

  const workers = await fetchAllRows<any>((from, to) => service
    .from("profiles")
    .select("id,full_name,email")
    .eq("role", "employee")
    .eq("active", true)
    .or(companyFilter(scope.companyId))
    .like("email", scope.emailLikePattern)
    .order("id", { ascending: true })
    .range(from, to));
  if (workers.error) throw new Error(`Scale status profiles: ${workers.error.message || "pagination failed"}`);

  if (!customerIds.length) {
    return {
      exists: false,
      customerCount: 0,
      workerCount: workers.data.length,
      workers: workers.data,
      completedVisits: 0,
      scheduledVisits: 0,
      photos: 0,
      paidInvoices: 0,
      collected: 0,
      protectedPayments: 0,
      protectedPaymentAmount: 0,
      routeCount: 0,
      completedDurationSeconds: 0,
    };
  }

  const properties = await fetchAllRowsByIds<any>(customerIds, (batchIds, from, to) => service
    .from("properties")
    .select("id")
    .in("customer_id", batchIds)
    .order("id", { ascending: true })
    .range(from, to));
  if (properties.error) throw new Error(`Scale status properties: ${properties.error.message || "pagination failed"}`);
  const propertyIds = properties.data.map(row => String(row.id));

  const visits = await fetchAllRowsByIds<any>(customerIds, (batchIds, from, to) => service
    .from("visits")
    .select("id,status,duration_seconds,route_id")
    .in("customer_id", batchIds)
    .or(companyFilter(scope.companyId))
    .order("id", { ascending: true })
    .range(from, to));
  if (visits.error) throw new Error(`Scale status visits: ${visits.error.message || "pagination failed"}`);

  const photos = propertyIds.length
    ? await fetchAllRowsByIds<any>(propertyIds, (batchIds, from, to) => service
        .from("photos")
        .select("id")
        .in("property_id", batchIds)
        .order("id", { ascending: true })
        .range(from, to))
    : { data: [] as any[], error: null };
  if (photos.error) throw new Error(`Scale status photos: ${photos.error.message || "pagination failed"}`);

  const invoices = await fetchAllRowsByIds<any>(customerIds, (batchIds, from, to) => service
    .from("invoices")
    .select("id,status,subtotal,total")
    .in("customer_id", batchIds)
    .order("id", { ascending: true })
    .range(from, to));
  if (invoices.error) throw new Error(`Scale status invoices: ${invoices.error.message || "pagination failed"}`);

  const payments = await fetchAllRowsByIds<any>(customerIds, (batchIds, from, to) => service
    .from("payments")
    .select("id,status,amount")
    .in("customer_id", batchIds)
    .order("id", { ascending: true })
    .range(from, to));
  if (payments.error && !/permission denied|does not exist|schema cache/i.test(payments.error.message || "")) {
    throw new Error(`Scale status payments: ${payments.error.message || "pagination failed"}`);
  }

  const visitRows = visits.data;
  const invoiceRows = invoices.data;
  const paymentRows = payments.error ? [] : payments.data;
  const completedRows = visitRows.filter((row: any) => row.status === "completed");
  const routeIds = new Set(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean));

  return {
    exists: true,
    customerCount: customerIds.length,
    workerCount: workers.data.length,
    workers: workers.data,
    completedVisits: completedRows.length,
    scheduledVisits: visitRows.filter((row: any) => row.status === "scheduled").length,
    photos: photos.data.length,
    paidInvoices: invoiceRows.filter((row: any) => row.status === "paid").length,
    collected: money(invoiceRows.filter((row: any) => row.status === "paid").reduce((sum: number, row: any) => sum + Number(row.total || 0), 0)),
    protectedPayments: paymentRows.length,
    protectedPaymentAmount: money(paymentRows.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0)),
    routeCount: routeIds.size,
    completedDurationSeconds: completedRows.reduce((sum: number, row: any) => sum + Number(row.duration_seconds || 0), 0),
  };
}

export async function reconcileAdvancedSimulationAtScale(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  scenarioKey: AdvancedSimulationScenarioKey,
  input: OperationalSimulationInput,
): Promise<AdvancedSimulationReconciliation> {
  const status = await advancedSimulationDataStatusAtScale(service, scope);
  const expected = expectedAdvancedSimulationCounts(scenarioKey);
  const invoiceExpected = expectedInvoiceTotals(input);
  const paymentRule = "Paid Invoices model simulator settlement; protected payments remain zero unless a provider-confirmed event exists.";

  if (!status.exists) {
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
        expectedCount: invoiceExpected.invoiceCount,
        actualPaidCount: 0,
        expectedSubtotal: 0,
        actualCollected: 0,
        expectedCollected: invoiceExpected.collected,
        passed: false,
      },
      payments: {
        protectedLedgerCount: 0,
        protectedLedgerAmount: 0,
        modeledSettlementCount: 0,
        modeledSettlementAmount: 0,
        rule: paymentRule,
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

  const productiveHours = status.completedDurationSeconds / 3600;
  const loadedPayroll = productiveHours * input.hourlyWage * (1 + input.payrollBurdenRate);
  const modeledKm = status.completedVisits * ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT;

  const visitsPassed = status.completedVisits === expected.completedVisits
    && status.scheduledVisits === expected.scheduledVisits
    && status.customerCount === expected.customers
    && status.workerCount === expected.employees;
  const invoicePassed = status.paidInvoices === invoiceExpected.invoiceCount
    && Math.abs(status.collected - invoiceExpected.collected) < 0.02;
  const paymentsPassed = status.protectedPayments === 0 && status.protectedPaymentAmount === 0 && invoicePassed;
  const payrollPassed = visitsPassed && productiveHours > 0 && loadedPayroll > 0;
  const kmPassed = visitsPassed && modeledKm > 0;
  const evidencePassed = status.photos === expected.completedVisits;

  return {
    passed: visitsPassed && invoicePassed && paymentsPassed && payrollPassed && kmPassed && evidencePassed,
    scenario: scenarioKey,
    namespace: scope.namespace,
    expected,
    visits: {
      expectedCompleted: expected.completedVisits,
      actualCompleted: status.completedVisits,
      expectedScheduled: expected.scheduledVisits,
      actualScheduled: status.scheduledVisits,
      passed: visitsPassed,
    },
    invoices: {
      expectedCount: invoiceExpected.invoiceCount,
      actualPaidCount: status.paidInvoices,
      expectedSubtotal: 0,
      actualCollected: status.collected,
      expectedCollected: invoiceExpected.collected,
      passed: invoicePassed,
    },
    payments: {
      protectedLedgerCount: status.protectedPayments,
      protectedLedgerAmount: status.protectedPaymentAmount,
      modeledSettlementCount: status.paidInvoices,
      modeledSettlementAmount: status.collected,
      rule: paymentRule,
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
      actualPhotos: status.photos,
      passed: evidencePassed,
    },
  };
}
