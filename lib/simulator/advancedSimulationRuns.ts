import type {
  AdvancedSimulationScenarioKey,
  AdvancedSimulationScope,
} from "@/lib/simulator/advancedSimulation";

export type AdvancedSimulationRunStatus = "creating" | "ready" | "resetting" | "failed" | "removed";

export type AdvancedSimulationRunRecord = {
  id: string;
  company_id: string;
  namespace: string;
  version: number;
  scenario: AdvancedSimulationScenarioKey;
  run_id: string | null;
  status: AdvancedSimulationRunStatus;
  config: Record<string, unknown>;
  counts: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  reset_at: string | null;
  last_error: string | null;
};

type ServiceClient = any;

function now() {
  return new Date().toISOString();
}

function asRunRecord(value: unknown): AdvancedSimulationRunRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as AdvancedSimulationRunRecord;
}

export async function loadAdvancedSimulationRun(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
): Promise<AdvancedSimulationRunRecord | null> {
  const result = await service
    .from("operational_simulation_runs")
    .select("id,company_id,namespace,version,scenario,run_id,status,config,counts,created_by,created_at,updated_at,reset_at,last_error")
    .eq("company_id", scope.companyId)
    .eq("namespace", scope.namespace)
    .maybeSingle();

  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);
  return asRunRecord(result.data);
}

export async function listAdvancedSimulationRuns(
  service: ServiceClient,
  companyId: string,
): Promise<AdvancedSimulationRunRecord[]> {
  const result = await service
    .from("operational_simulation_runs")
    .select("id,company_id,namespace,version,scenario,run_id,status,config,counts,created_by,created_at,updated_at,reset_at,last_error")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });

  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);
  return (result.data || []) as AdvancedSimulationRunRecord[];
}

export async function beginAdvancedSimulationRun(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  options: {
    scenario: AdvancedSimulationScenarioKey;
    runId: string;
    actorId: string;
    config: Record<string, unknown>;
  },
): Promise<AdvancedSimulationRunRecord> {
  const result = await service.rpc("begin_operational_simulation_run", {
    p_company_id: scope.companyId,
    p_namespace: scope.namespace,
    p_scenario: options.scenario,
    p_run_id: options.runId,
    p_created_by: options.actorId,
    p_config: options.config,
  });

  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);
  const run = asRunRecord(result.data);
  if (!run) throw new Error(`Simulation namespace "${scope.namespace}" could not be acquired.`);
  return run;
}

export async function markAdvancedSimulationReady(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  counts: Record<string, unknown>,
) {
  const result = await service
    .from("operational_simulation_runs")
    .update({
      status: "ready",
      counts,
      updated_at: now(),
      last_error: null,
    })
    .eq("company_id", scope.companyId)
    .eq("namespace", scope.namespace)
    .eq("status", "creating")
    .select("id,company_id,namespace,version,scenario,run_id,status,config,counts,created_by,created_at,updated_at,reset_at,last_error")
    .maybeSingle();

  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);
  if (!result.data) throw new Error(`Simulation namespace "${scope.namespace}" did not transition from creating to ready.`);
  return result.data as AdvancedSimulationRunRecord;
}

export async function markAdvancedSimulationFailed(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error || "Advanced simulation failed.");
  const result = await service
    .from("operational_simulation_runs")
    .update({
      status: "failed",
      updated_at: now(),
      last_error: message.slice(0, 4000),
    })
    .eq("company_id", scope.companyId)
    .eq("namespace", scope.namespace);

  if (result.error) {
    console.error(`operational_simulation_runs failure state: ${result.error.message}`);
  }
}

export async function beginAdvancedSimulationReset(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
): Promise<{ acquired: boolean; alreadyRemoved: boolean; run: AdvancedSimulationRunRecord | null }> {
  const result = await service.rpc("begin_operational_simulation_reset", {
    p_company_id: scope.companyId,
    p_namespace: scope.namespace,
  });
  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);

  const payload = result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? result.data as Record<string, unknown>
    : {};
  return {
    acquired: payload.acquired === true,
    alreadyRemoved: payload.alreadyRemoved === true,
    run: asRunRecord(payload.run),
  };
}

export async function markAdvancedSimulationRemoved(
  service: ServiceClient,
  scope: AdvancedSimulationScope,
  counts: Record<string, unknown> = {},
) {
  const timestamp = now();
  const result = await service
    .from("operational_simulation_runs")
    .update({
      status: "removed",
      counts,
      reset_at: timestamp,
      updated_at: timestamp,
      last_error: null,
    })
    .eq("company_id", scope.companyId)
    .eq("namespace", scope.namespace)
    .select("id,company_id,namespace,version,scenario,run_id,status,config,counts,created_by,created_at,updated_at,reset_at,last_error")
    .maybeSingle();

  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);
  return asRunRecord(result.data);
}
