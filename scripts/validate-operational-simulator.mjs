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
assert.equal(result.weatherRescheduledVisits, 24);
assert.equal(result.lateVisits, 38);
assert.equal(result.serviceIssueVisits, 14);
assert.equal(result.returnVisits, 7);
assert.equal(result.exceptionLaborHours, 20.75);
assert.equal(result.exceptionCost, 731.15);
assert.equal(result.revenueAtRisk, 560);
assert.equal(result.adjustedOperatingProfit, 5075.91);
assert.equal(result.adjustedOperatingMarginRate, 0.2644);

console.log(JSON.stringify({
  valid: true,
  visits: result.visits,
  invoices: result.invoices,
  operatingProfit: result.operatingProfit,
  weatherRescheduledVisits: result.weatherRescheduledVisits,
  lateVisits: result.lateVisits,
  serviceIssueVisits: result.serviceIssueVisits,
  returnVisits: result.returnVisits,
  exceptionCost: result.exceptionCost,
  adjustedOperatingProfit: result.adjustedOperatingProfit,
}, null, 2));
