import fs from "node:fs";

function replaceOnce(text, oldValue, newValue, label) {
  if (!text.includes(oldValue)) throw new Error(`missing anchor: ${label}`);
  return text.replace(oldValue, newValue);
}

const dataPath = "lib/simulator/advancedSimulationData.ts";
let data = fs.readFileSync(dataPath, "utf8");

data = replaceOnce(
  data,
  '  if (workerProfiles.error) throw new Error(workerProfiles.error.message);\n',
  `  if (workerProfiles.error) throw new Error(workerProfiles.error.message);\n\n  const simulationEmployees = await service.from("employees").select("id,profile_id,crew_id")\n    .or(companyFilter(scope.companyId)).like("email", scope.emailLikePattern).limit(5000);\n  if (simulationEmployees.error) throw new Error(simulationEmployees.error.message);\n  const simulationEmployeeRows = simulationEmployees.data || [];\n`,
  "simulation employee discovery",
);

data = replaceOnce(
  data,
  `  const profileIds: string[] = [...new Set<string>([\n    ...(workerProfiles.data || []).map((row: any) => String(row.id)),\n    ...(customerResult.data || []).map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),\n  ])];`,
  `  const profileIds: string[] = [...new Set<string>([\n    ...(workerProfiles.data || []).map((row: any) => String(row.id)),\n    ...(customerResult.data || []).map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),\n    ...simulationEmployeeRows.map((row: any) => row.profile_id ? String(row.profile_id) : "").filter(Boolean),\n  ])];`,
  "residual employee profile IDs",
);

data = replaceOnce(
  data,
  "  if (!customerIds.length && !profileIds.length) {",
  "  if (!customerIds.length && !profileIds.length && !simulationEmployeeRows.length) {",
  "residual early return",
);

data = replaceOnce(
  data,
  `  const routeIds: string[] = [...new Set<string>(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];\n  const employeeRows = profileIds.length ? await collectInBatches(service, "employees", "id,crew_id", "profile_id", profileIds) : [];\n  const employeeIds = employeeRows.map((row: any) => String(row.id));\n  const crewIds: string[] = [...new Set<string>(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];`,
  `  const visitRouteIds: string[] = [...new Set<string>(visitRows.map((row: any) => row.route_id ? String(row.route_id) : "").filter(Boolean))];\n  const profileEmployeeRows = profileIds.length ? await collectInBatches(service, "employees", "id,profile_id,crew_id", "profile_id", profileIds) : [];\n  const employeeRows = [...new Map(\n    [...simulationEmployeeRows, ...profileEmployeeRows].map((row: any) => [String(row.id), row]),\n  ).values()];\n  const employeeIds = employeeRows.map((row: any) => String(row.id));\n  const crewIds: string[] = [...new Set<string>(employeeRows.map((row: any) => row.crew_id ? String(row.crew_id) : "").filter(Boolean))];\n  const crewRouteRows = crewIds.length ? await collectInBatches(service, "routes", "id", "crew_id", crewIds) : [];\n  const routeIds: string[] = [...new Set<string>([\n    ...visitRouteIds,\n    ...crewRouteRows.map((row: any) => row.id ? String(row.id) : ""),\n  ].filter(Boolean))];`,
  "Route discovery through simulation Crews",
);
fs.writeFileSync(dataPath, data);

const apiPath = "app/api/admin/operational-simulator/v2/route.ts";
let api = fs.readFileSync(apiPath, "utf8");
api = replaceOnce(
  api,
  `      if (transition.alreadyRemoved && !before.exists) {\n        return NextResponse.json({\n          removed: true,\n          alreadyRemoved: true,\n          namespace: scope.namespace,\n          status: before,\n          message: \`Simulation namespace "\${scope.namespace}" is already reset.\`,\n        });\n      }`,
  `      if (transition.alreadyRemoved && !before.exists) {\n        const residual = await removeAdvancedSimulationDataWithTimeoutRetry(service, scope);\n        const afterResidual = await advancedSimulationDataStatus(service, scope);\n        if (afterResidual.exists) throw new Error("Advanced simulator residual reset was incomplete.");\n        await markAdvancedSimulationRemoved(service, scope, residual);\n        return NextResponse.json({\n          removed: true,\n          alreadyRemoved: true,\n          namespace: scope.namespace,\n          ...residual,\n          status: afterResidual,\n          message: \`Simulation namespace "\${scope.namespace}" was already reset; residual QA artifacts were swept again.\`,\n        });\n      }`,
  "idempotent residual sweep",
);
fs.writeFileSync(apiPath, api);

const testPath = "tests/advanced-operational-simulator-large.spec.ts";
let test = fs.readFileSync(testPath, "utf8");
test = replaceOnce(
  test,
  'const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";\n',
  'const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";\nconst SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";\n',
  "service role env",
);
test = replaceOnce(
  test,
  '  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();\n',
  '  expect(SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required").toBeTruthy();\n  expect(SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY is required").toBeTruthy();\n',
  "service role requirement",
);
test = replaceOnce(
  test,
  `  const cleanup = async () => {\n    const response = await postSimulator(request, token, { action: "reset", namespace });\n    if (!response.ok()) console.warn(\`Scale cleanup: \${response.status()} \${await response.text()}\`);\n  };\n\n  await cleanup();\n  try {`,
  `  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {\n    auth: { persistSession: false, autoRefreshToken: false },\n  });\n  const cleanup = async () => {\n    const response = await postSimulator(request, token, { action: "reset", namespace });\n    if (!response.ok()) {\n      console.warn(\`Scale cleanup: \${response.status()} \${await response.text()}\`);\n      return null;\n    }\n    return response.json();\n  };\n\n  await cleanup();\n  let finalCleanup = null;\n  try {`,
  "cleanup response",
);
test = replaceOnce(
  test,
  `  } finally {\n    await cleanup();\n  }\n\n  const resetAgain = await postSimulator(request, token, { action: "reset", namespace });\n  expect(resetAgain.ok(), await resetAgain.text()).toBe(true);\n  expect((await resetAgain.json()).alreadyRemoved).toBe(true);`,
  `  } finally {\n    finalCleanup = await cleanup();\n  }\n\n  expect(finalCleanup?.routesRemoved).toBeGreaterThan(0);\n  const residualEmployees = await service.from("employees").select("crew_id").like("email", \`%\${namespace}%\`);\n  expect(residualEmployees.error?.message || "").toBe("");\n  const crewIds = [...new Set((residualEmployees.data || []).map((row) => String(row.crew_id || "")).filter(Boolean))];\n  const residualRoutes = crewIds.length\n    ? await service.from("routes").select("id", { count: "exact", head: true }).in("crew_id", crewIds)\n    : { count: 0, error: null };\n  expect(residualRoutes.error?.message || "").toBe("");\n  expect(residualRoutes.count || 0).toBe(0);\n\n  const resetAgain = await postSimulator(request, token, { action: "reset", namespace });\n  expect(resetAgain.ok(), await resetAgain.text()).toBe(true);\n  const resetAgainBody = await resetAgain.json();\n  expect(resetAgainBody.alreadyRemoved).toBe(true);\n  expect(resetAgainBody.routesRemoved || 0).toBe(0);`,
  "zero Route residue assertion",
);
fs.writeFileSync(testPath, test);

console.log("Advanced simulation Route cleanup patch applied.");
