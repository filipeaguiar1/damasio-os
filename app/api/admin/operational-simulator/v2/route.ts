import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateOperationalSimulation, type OperationalSimulationInput } from "@/lib/simulator/operationalSimulator";
import {
  ADVANCED_SIMULATION_SCENARIOS,
  advancedScenarioInput,
  createAdvancedSimulationScope,
  normalizeAdvancedSimulationNamespace,
  normalizeAdvancedSimulationScenario,
} from "@/lib/simulator/advancedSimulation";
import {
  ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
  advancedSimulationDataStatus,
  createAdvancedSimulationData,
  removeAdvancedSimulationData,
} from "@/lib/simulator/advancedSimulationData";
import { withSafeAdvancedSimulationPhotos } from "@/lib/simulator/safeAdvancedSimulationPhotos";
import { reconcileAdvancedSimulationAtScale } from "@/lib/simulator/advancedScaleReconciliation";
import {
  beginAdvancedSimulationReset,
  beginAdvancedSimulationRun,
  listAdvancedSimulationRuns,
  loadAdvancedSimulationRun,
  markAdvancedSimulationFailed,
  markAdvancedSimulationReady,
  markAdvancedSimulationRemoved,
} from "@/lib/simulator/advancedSimulationRuns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Advanced operational simulator is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
}

async function requireAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in as the company Admin.");

  const service = serviceClient();
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) throw new Error("Your Admin session expired. Sign in again.");

  const profile = await service.from("profiles")
    .select("id,role,active,full_name,company_id,organization_id")
    .eq("id", auth.data.user.id)
    .single();
  if (profile.error || !profile.data?.active || profile.data.role !== "admin") {
    throw new Error("Only an active company Admin can run the advanced operational simulation.");
  }

  const companyId = profile.data.company_id || profile.data.organization_id;
  if (!companyId) throw new Error("Your Admin profile is not linked to a company.");
  return {
    service,
    companyId: String(companyId),
    actorId: String(auth.data.user.id),
  };
}

function scenarioPreviews() {
  return Object.values(ADVANCED_SIMULATION_SCENARIOS).map(scenario => {
    const input = advancedScenarioInput(scenario.key);
    return {
      ...scenario,
      financial: calculateOperationalSimulation(input),
    };
  });
}

function isTransientCleanupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /statement timeout|canceling statement due to statement timeout|deadlock detected|could not serialize access|serialization failure/i.test(message);
}

async function removeAdvancedSimulationDataWithTimeoutRetry(
  service: any,
  scope: ReturnType<typeof createAdvancedSimulationScope>,
) {
  let lastError: unknown = null;
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await removeAdvancedSimulationData(service, scope);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isTransientCleanupError(error) || attempt === maxAttempts) {
        throw error;
      }
      console.warn("advanced-operational-simulator-reset-retry", {
        namespace: scope.namespace,
        attempt,
        reason: /deadlock/i.test(message) ? "deadlock" : "database-contention",
        message,
      });
      await new Promise(resolve => setTimeout(resolve, attempt * 600));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || "Advanced simulation reset failed."));
}

export async function GET(request: NextRequest) {
  try {
    const { service, companyId } = await requireAdmin(request);
    const namespace = normalizeAdvancedSimulationNamespace(request.nextUrl.searchParams.get("namespace") || undefined);
    const scope = createAdvancedSimulationScope(companyId, namespace);
    const [status, run, runs] = await Promise.all([
      advancedSimulationDataStatus(service, scope),
      loadAdvancedSimulationRun(service, scope),
      listAdvancedSimulationRuns(service, companyId),
    ]);

    return NextResponse.json({
      version: 2,
      namespace: scope.namespace,
      status,
      run,
      runs,
      scenarios: scenarioPreviews(),
      source: "canonical-advanced-operational-simulation",
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Advanced simulation status failed.",
    }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { service, companyId, actorId } = await requireAdmin(request);
    const body = await request.json() as {
      action?: "create" | "reset" | "remove" | "reconcile";
      namespace?: string;
      scenario?: string;
      assumptions?: Partial<OperationalSimulationInput>;
    };
    const action = body.action || "create";
    const scope = createAdvancedSimulationScope(companyId, body.namespace);

    if (action === "reset" || action === "remove") {
      const transition = await beginAdvancedSimulationReset(service, scope);
      const before = await advancedSimulationDataStatus(service, scope);
      if (transition.alreadyRemoved && !before.exists) {
        const residual = await removeAdvancedSimulationDataWithTimeoutRetry(service, scope);
        const afterResidual = await advancedSimulationDataStatus(service, scope);
        if (afterResidual.exists) throw new Error("Advanced simulator residual reset was incomplete.");
        await markAdvancedSimulationRemoved(service, scope, residual);
        return NextResponse.json({
          removed: true,
          alreadyRemoved: true,
          namespace: scope.namespace,
          ...residual,
          status: afterResidual,
          message: `Simulation namespace "${scope.namespace}" was already reset; residual QA artifacts were swept again.`,
        });
      }
      if (!transition.acquired && !transition.alreadyRemoved) {
        return NextResponse.json({
          removed: false,
          resetting: true,
          namespace: scope.namespace,
          status: before,
          message: `Simulation namespace "${scope.namespace}" is already being reset by another request.`,
        }, { status: 409 });
      }

      try {
        const removed = await removeAdvancedSimulationDataWithTimeoutRetry(service, scope);
        const remaining = await advancedSimulationDataStatus(service, scope);
        if (remaining.exists) {
          throw new Error(`Advanced simulation reset did not converge: ${remaining.customerCount} active simulation customers remain.`);
        }
        await markAdvancedSimulationRemoved(service, scope, removed);
        return NextResponse.json({
          removed: true,
          alreadyRemoved: false,
          namespace: scope.namespace,
          ...removed,
          status: remaining,
          message: `Simulation namespace "${scope.namespace}" was reset without touching other namespaces.`,
        });
      } catch (error) {
        await markAdvancedSimulationFailed(service, scope, error);
        throw error;
      }
    }

    const requestedRun = await loadAdvancedSimulationRun(service, scope);
    const scenarioKey = normalizeAdvancedSimulationScenario(body.scenario || requestedRun?.scenario || "baseline");
    const input = advancedScenarioInput(scenarioKey, body.assumptions || {});

    if (action === "reconcile") {
      const reconciliation = await reconcileAdvancedSimulationAtScale(service, scope, scenarioKey, input);
      return NextResponse.json({
        namespace: scope.namespace,
        scenario: scenarioKey,
        reconciliation,
      }, { status: reconciliation.passed ? 200 : 409 });
    }

    if (action !== "create") throw new Error(`Unknown advanced simulator action: ${String(action)}`);

    const current = await advancedSimulationDataStatus(service, scope);
    if (current.exists) {
      throw new Error(`Simulation namespace "${scope.namespace}" already contains active canonical data. Reset it before creating another run.`);
    }

    const runId = Date.now().toString(36);
    await beginAdvancedSimulationRun(service, scope, {
      scenario: scenarioKey,
      runId,
      actorId,
      config: {
        scenario: scenarioKey,
        namespace: scope.namespace,
        input,
        kmPerCompletedVisit: ADVANCED_SIMULATION_KM_PER_COMPLETED_VISIT,
      },
    });

    try {
      const simulationService = withSafeAdvancedSimulationPhotos(service);
      const created = await createAdvancedSimulationData(simulationService, {
        scope,
        scenarioKey,
        input,
        actorId,
        runId,
      });
      const reconciliation = await reconcileAdvancedSimulationAtScale(service, scope, scenarioKey, input);
      if (!reconciliation.passed) {
        throw new Error(`Advanced simulation reconciliation failed for namespace "${scope.namespace}".`);
      }

      await markAdvancedSimulationReady(service, scope, {
        ...created.operational,
        reconciliation,
      });

      const scenario = ADVANCED_SIMULATION_SCENARIOS[scenarioKey];
      return NextResponse.json({
        created: true,
        version: 2,
        namespace: scope.namespace,
        scenario: scenarioKey,
        input,
        ...created,
        reconciliation,
        message: `${scenario.customerCount} customers, ${scenario.employeeCount} employees and ${scenario.expectedServiceRecords} canonical service records created in namespace "${scope.namespace}".`,
      }, { status: 201 });
    } catch (error) {
      let cleanupMessage = "Automatic cleanup completed.";
      try {
        await removeAdvancedSimulationDataWithTimeoutRetry(service, scope);
      } catch (cleanupError) {
        cleanupMessage = `Automatic cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
      const failure = new Error(`${error instanceof Error ? error.message : String(error)} ${cleanupMessage}`);
      await markAdvancedSimulationFailed(service, scope, failure);
      throw failure;
    }
  } catch (error) {
    console.error("admin-operational-simulator-v2", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Advanced operational simulation failed.",
    }, { status: 400 });
  }
}
