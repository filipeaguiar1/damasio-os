from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 occurrence, found {count}")
    return text.replace(old, new, 1)


data_path = Path("lib/simulator/advancedSimulationData.ts")
data = data_path.read_text()

worker_error = '  if (workerProfiles.error) throw new Error(workerProfiles.error.message);\n'
data = replace_once(
    data,
    worker_error,
    worker_error
    + '  const simulationEmployees = await service.from("employees").select("id,profile_id,crew_id")\n'
    + '    .or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern).limit(5000);\n'
    + '  if (simulationEmployees.error) throw new Error(simulationEmployees.error.message);\n'
    + '  const simulationEmployeeRows = simulationEmployees.data || [];\n',
    "simulation employee discovery",
)

customer_profile_line = '    ...(customerResult.data || []).map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),\n'
data = replace_once(
    data,
    customer_profile_line,
    customer_profile_line
    + '    ...simulationEmployeeRows.map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),\n',
    "simulation employee profile ids",
)
data = replace_once(
    data,
    '  if (!customerIds.length && !profileIds.length) {\n',
    '  if (!customerIds.length && !profileIds.length && !simulationEmployeeRows.length) {\n',
    "residual early return",
)

data = replace_once(
    data,
    '  const routeIds: string[] = [...new Set<string>(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];\n',
    '  const visitRouteIds: string[] = [...new Set<string>(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];\n',
    "visit route ids",
)

employee_block = (
    '  const employeeRows = profileIds.length ? await collectInBatches(service, "employees", "id,crew_id", "profile_id", profileIds) : [];\n'
    '  const employeeIds = employeeRows.map((row: any) => String(row.id));\n'
    '  const crewIds: string[] = [...new Set<string>(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];\n'
)
employee_replacement = (
    '  const profileEmployeeRows = profileIds.length ? await collectInBatches(service, "employees", "id,profile_id,crew_id", "profile_id", profileIds) : [];\n'
    '  const employeeRows = [...new Map(\n'
    '    [...simulationEmployeeRows, ...profileEmployeeRows].map((row: any) => [String(row.id), row]),\n'
    '  ).values()];\n'
    '  const employeeIds = employeeRows.map((row: any) => String(row.id));\n'
    '  const crewIds: string[] = [...new Set<string>(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];\n'
    '  const crewRouteRows = crewIds.length ? await collectInBatches(service, "routes", "id", "crew_id", crewIds) : [];\n'
    '  const routeIds: string[] = [...new Set<string>([\n'
    '    ...visitRouteIds,\n'
    '    ...crewRouteRows.map((row: any) => row.id ? String(row.id) : ""),\n'
    '  ].filter(Boolean))];\n'
)
data = replace_once(data, employee_block, employee_replacement, "route discovery through simulation crews")

route_delete_block = '''  let routesRemoved = 0;
  if (visitsDeleted && routeIds.length) {
    const deletedRoutes = await removeByIds("routes", "routes", "id", routeIds, true);
    if (deletedRoutes) routesRemoved = routeIds.length;
  }
'''
route_delete_replacement = '''  let routesRemoved = 0;
  if (visitsDeleted && crewIds.length) {
    const cleanupRoutes = await service.rpc("cleanup_operational_simulation_routes", {
      p_company_id: scope.companyId,
      p_namespace: scope.namespace,
      p_crew_ids: crewIds,
    });
    if (cleanupRoutes.error) {
      throw new Error(`routes cleanup: ${cleanupRoutes.error.message || "protected QA Route cleanup failed"}`);
    }
    routesRemoved = Number(cleanupRoutes.data?.routeCount || 0);
  }
'''
data = replace_once(data, route_delete_block, route_delete_replacement, "protected Route cleanup RPC")
data_path.write_text(data)

api_path = Path("app/api/admin/operational-simulator/v2/route.ts")
api = api_path.read_text()
pattern = re.compile(
    r'      if \(transition\.alreadyRemoved && !before\.exists\) \{\n.*?\n      \}\n      if \(!transition\.acquired && !transition\.alreadyRemoved\) \{',
    re.S,
)
replacement = '''      if (transition.alreadyRemoved && !before.exists) {
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
      if (!transition.acquired && !transition.alreadyRemoved) {'''
api, substitutions = pattern.subn(replacement, api, count=1)
if substitutions != 1:
    raise SystemExit(f"idempotent residual sweep: expected 1 substitution, found {substitutions}")
api_path.write_text(api)

test_path = Path("tests/advanced-operational-simulator-large.spec.ts")
test = test_path.read_text()
test = replace_once(
    test,
    'const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";\n',
    'const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";\nconst SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";\n',
    "service role env",
)
test = replace_once(
    test,
    '  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();\n',
    '  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();\n  expect(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY is required").toBeTruthy();\n',
    "service role requirement",
)
test = replace_once(
    test,
    '''  const cleanup = async () => {
    const response = await postSimulator(request, token, { action: "reset", namespace });
    if (!response.ok()) console.warn(`Scale cleanup: ${response.status()} ${await response.text()}`);
  };

  await cleanup();
  try {''',
    '''  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cleanup = async () => {
    const response = await postSimulator(request, token, { action: "reset", namespace });
    if (!response.ok()) {
      console.warn(`Scale cleanup: ${response.status()} ${await response.text()}`);
      return null;
    }
    return response.json();
  };

  await cleanup();
  let finalCleanup: any = null;
  try {''',
    "cleanup result",
)
test = replace_once(
    test,
    '''  } finally {
    await cleanup();
  }

  const resetAgain = await postSimulator(request, token, { action: "reset", namespace });
  expect(resetAgain.ok(), await resetAgain.text()).toBe(true);
  expect((await resetAgain.json()).alreadyRemoved).toBe(true);''',
    '''  } finally {
    finalCleanup = await cleanup();
  }

  expect(finalCleanup?.routesRemoved).toBeGreaterThan(0);
  const residualEmployees = await service.from("employees").select("crew_id").like("email", `%${namespace}%`);
  expect(residualEmployees.error?.message || "").toBe("");
  const crewIds = [...new Set((residualEmployees.data || []).map((row: any) => String(row.crew_id || "")).filter(Boolean))];
  const residualRoutes = crewIds.length
    ? await service.from("routes").select("id", { count: "exact", head: true }).in("crew_id", crewIds)
    : { count: 0, error: null };
  expect(residualRoutes.error?.message || "").toBe("");
  expect(residualRoutes.count || 0).toBe(0);

  const resetAgain = await postSimulator(request, token, { action: "reset", namespace });
  expect(resetAgain.ok(), await resetAgain.text()).toBe(true);
  const resetAgainBody = await resetAgain.json();
  expect(resetAgainBody.alreadyRemoved).toBe(true);
  expect(resetAgainBody.routesRemoved || 0).toBe(0);''',
    "zero route residue assertion",
)
test_path.write_text(test)

print("Simulation cleanup patch applied successfully.")
