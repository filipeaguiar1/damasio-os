import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/simulator/operationalSimulator.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { calculateOperationalSimulation } = module.exports;
const result = calculateOperationalSimulation();

assert.equal(result.visits, 480);
assert.equal(result.invoices, 120);
assert.equal(result.housesPerEmployeePerWeek, 30);
assert.equal(result.requiredHousesPerDay, 15);
assert.equal(result.capacityStatus, "at_capacity");
assert.equal(result.subtotalRevenue, 19200);
assert.equal(result.hst, 2496);
assert.equal(result.customerTotal, 21696);
assert.equal(result.averageTotalMinutes, 35.5);
assert.equal(result.operatingProfit, 5807.06);
assert.equal(result.costPerVisit, 27.9);
assert.equal(result.profitPerVisit, 12.1);
assert.equal(result.breakEvenCustomers, 21);

console.log(JSON.stringify({
  valid: true,
  visits: result.visits,
  invoices: result.invoices,
  housesPerEmployeePerWeek: result.housesPerEmployeePerWeek,
  requiredHousesPerDay: result.requiredHousesPerDay,
  operatingProfit: result.operatingProfit,
  operatingMarginRate: result.operatingMarginRate,
}, null, 2));
