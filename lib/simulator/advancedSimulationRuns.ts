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
  if (!value || typeof value !== "object") return null;
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
  const timestamp = now();
  const existing = await loadAdvancedSimulationRun(service, scope);

  if (existing?.status === "ready") {
    throw new Error(`Simulation namespace "${scope.namespace}" already exists.`);
  }
  if (existing?.status === "creating" || existing?.status === "resetting") {
    throw new Error(`Simulation namespace "${scope.namespace}" is currently ${existing.status}.`);
  }

  const row = {
    company_id: scope.companyId,
    namespace: scope.namespace,
    version: scope.version,
    scenario: options.scenario,
    run_id: options.runId,
    status: "creating" as const,
    config: options.config,
    counts: {},
    created_by: options.actorId,
    updated_at: timestamp,
    reset_at: null,
    last_error: null,
  };

  const result = await service
    .from("operational_simulation_runs")
    .upsert(row, { onConflict: "company_id,namespace" })
    .select("id,company_id,namespace,version,scenario,run_id,status,config,counts,created_by,created_at,updated_at,reset_at,last_error")
    .single();

  if (result.error || !result.data) {
    throw new Error(`operational_simulation_runs: ${result.error?.message || "run could not be started"}`);
  }
  return result.data as AdvancedSimulationRunRecord;
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
): Promise<{ alreadyRemoved: boolean; run: AdvancedSimulationRunRecord | null }> {
  const existing = await loadAdvancedSimulationRun(service, scope);
  if (!existing || existing.status === "removed") {
    return { alreadyRemoved: true, run: existing };
  }
  if (existing.status === "creating") {
    throw new Error(`Simulation namespace "${scope.namespace}" is still being created.`);
  }
  if (existing.status === "resetting") {
    return { alreadyRemoved: false, run: existing };
  }

  const result = await service
    .from("operational_simulation_runs")
    .update({ status: "resetting", updated_at: now(), last_error: null })
    .eq("company_id", scope.companyId)
    .eq("namespace", scope.namespace)
    .in("status", ["ready", "failed"])
    .select("id,company_id,namespace,version,scenario,run_id,status,config,counts,created_by,created_at,updated_at,reset_at,last_error")
    .maybeSingle();

  if (result.error) throw new Error(`operational_simulation_runs: ${result.error.message}`);
  if (!result.data) {
    const current = await loadAdvancedSimulationRun(service, scope);
    if (!current || current.status === "removed") return { alreadyRemoved: true, run: current };
    if (current.status === "resetting") return { alreadyRemoved: false, run: current };
    throw new Error(`Simulation namespace "${scope.namespace}" could not enter reset state.`);
  }
  return { alreadyRemoved: false, run: result.data as AdvancedSimulationRunRecord };
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
