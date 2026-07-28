import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");

const implementationContracts = {
  advisorApi: read("app/api/admin/route-advisor/route.ts"),
  employeeApi: read("app/api/mobile/employee/route/route.ts"),
  assignmentMigration: read("supabase/migrations/202607280001_route_assignment_modes.sql"),
  capacityMigration: read("supabase/migrations/202607280006_employee_route_capacity_compat.sql"),
  identityMigration: read("supabase/migrations/202607280007_core_company_identity_contract.sql"),
};

assert.match(implementationContracts.advisorApi, /publish_canonical_route_daily/);
assert.match(implementationContracts.employeeApi, /profile_id/);
assert.match(implementationContracts.assignmentMigration, /move_canonical_visits/);
assert.match(implementationContracts.capacityMigration, /employees[\s\S]*daily_route_capacity/);
assert.match(implementationContracts.identityMigration, /sync_company_identifier/);
assert.match(implementationContracts.identityMigration, /company_canonical_integrity_report/);

let sequence = 0;
const id = prefix => `${prefix}-${String(++sequence).padStart(3, "0")}`;

const database = {
  companies: [],
  customers: [],
  properties: [],
  quotes: [],
  jobs: [],
  crews: [],
  employees: [],
  routes: [],
  visits: [],
};

function createCompany(name) {
  const company = { id: id("company"), name };
  database.companies.push(company);
  return company;
}

function createEmployee(company, name, capacity = 16) {
  assert.ok(company?.id);
  assert.ok(capacity >= 1 && capacity <= 60);
  const crew = {
    id: id("crew"),
    companyId: company.id,
    organizationId: company.id,
  };
  const employee = {
    id: id("employee"),
    profileId: id("profile"),
    companyId: company.id,
    organizationId: company.id,
    crewId: crew.id,
    name,
    capacity,
    active: true,
  };
  database.crews.push(crew);
  database.employees.push(employee);
  return employee;
}

function createCustomerChain(company, number) {
  const customer = {
    id: id("customer"),
    companyId: company.id,
    organizationId: company.id,
    number,
  };
  const property = {
    id: id("property"),
    companyId: company.id,
    organizationId: company.id,
    customerId: customer.id,
  };
  const quote = {
    id: id("quote"),
    companyId: company.id,
    organizationId: company.id,
    customerId: customer.id,
    propertyId: property.id,
    status: "approved",
  };
  const job = {
    id: id("job"),
    companyId: company.id,
    organizationId: company.id,
    customerId: customer.id,
    propertyId: property.id,
    quoteId: quote.id,
    permanentCrewId: null,
    active: true,
  };
  database.customers.push(customer);
  database.properties.push(property);
  database.quotes.push(quote);
  database.jobs.push(job);
  return { customer, property, quote, job };
}

function assertSameCompany(...entities) {
  const values = new Set(entities.map(entity => entity.companyId));
  assert.equal(values.size, 1, "Cross-company operational link was attempted");
  for (const entity of entities) {
    assert.equal(entity.companyId, entity.organizationId, "Tenant identifiers diverged");
  }
}

function assignPermanent(job, employee) {
  assertSameCompany(job, employee);
  assert.ok(job.active && employee.active);
  job.permanentCrewId = employee.crewId;
}

function routeFor(employee, routeDate) {
  let route = database.routes.find(item =>
    item.companyId === employee.companyId
    && item.crewId === employee.crewId
    && item.routeDate === routeDate);
  if (!route) {
    route = {
      id: id("route"),
      companyId: employee.companyId,
      organizationId: employee.companyId,
      crewId: employee.crewId,
      routeDate,
      status: "published",
    };
    database.routes.push(route);
  }
  return route;
}

function publishDaily(job, employee, routeDate) {
  assertSameCompany(job, employee);
  assert.ok(job.customerId && job.propertyId && job.quoteId);
  const duplicate = database.visits.find(visit =>
    visit.jobId === job.id
    && visit.scheduledDate === routeDate
    && visit.status !== "cancelled");
  assert.equal(duplicate, undefined, "Duplicate active Visit for Job/day");

  const route = routeFor(employee, routeDate);
  const currentCount = database.visits.filter(visit =>
    visit.companyId === employee.companyId
    && visit.assignedEmployeeId === employee.id
    && visit.scheduledDate === routeDate
    && visit.status !== "cancelled").length;
  assert.ok(currentCount < employee.capacity, "Employee daily capacity exceeded");

  const visit = {
    id: id("visit"),
    companyId: job.companyId,
    organizationId: job.companyId,
    customerId: job.customerId,
    propertyId: job.propertyId,
    jobId: job.id,
    routeId: route.id,
    crewId: employee.crewId,
    assignedEmployeeId: employee.id,
    scheduledDate: routeDate,
    routeOrder: currentCount + 1,
    status: "scheduled",
    startedAt: null,
    finishedAt: null,
  };
  database.visits.push(visit);
  return visit;
}

function temporaryMove(visit, destination) {
  assertSameCompany(visit, destination);
  assert.equal(visit.status, "scheduled");
  visit.routeId = routeFor(destination, visit.scheduledDate).id;
  visit.crewId = destination.crewId;
  visit.assignedEmployeeId = destination.id;
}

function permanentMove(job, destination, fromDate) {
  assertSameCompany(job, destination);
  job.permanentCrewId = destination.crewId;
  for (const visit of database.visits) {
    if (visit.jobId !== job.id || visit.status !== "scheduled" || visit.scheduledDate < fromDate) continue;
    visit.routeId = routeFor(destination, visit.scheduledDate).id;
    visit.crewId = destination.crewId;
    visit.assignedEmployeeId = destination.id;
  }
}

function startVisit(visit, employee) {
  assertSameCompany(visit, employee);
  assert.equal(visit.assignedEmployeeId, employee.id, "Wrong Employee attempted to start Visit");
  assert.equal(visit.status, "scheduled", "Only Scheduled Visit can start");
  visit.status = "in_progress";
  visit.startedAt = "2026-07-28T13:00:00.000Z";
}

function completeVisit(visit, employee) {
  assertSameCompany(visit, employee);
  assert.equal(visit.assignedEmployeeId, employee.id, "Wrong Employee attempted to complete Visit");
  assert.equal(visit.status, "in_progress", "Visit must start before completion");
  assert.ok(visit.startedAt, "Completed Visit is missing started_at");
  visit.status = "completed";
  visit.finishedAt = "2026-07-28T13:45:00.000Z";
}

function employeeRoute(employee, routeDate) {
  return database.visits
    .filter(visit =>
      visit.companyId === employee.companyId
      && visit.assignedEmployeeId === employee.id
      && visit.crewId === employee.crewId
      && visit.scheduledDate === routeDate
      && Boolean(visit.routeId)
      && visit.status !== "cancelled")
    .sort((left, right) => left.routeOrder - right.routeOrder);
}

const companyA = createCompany("4Ever Seasons A");
const companyB = createCompany("Other Company");
const pedro = createEmployee(companyA, "Pedro", 16);
const mauricio = createEmployee(companyA, "Mauricio", 16);
const outsider = createEmployee(companyB, "Outsider", 16);
const chain = createCustomerChain(companyA, "A-0001");

assertSameCompany(chain.customer, chain.property, chain.quote, chain.job);
assignPermanent(chain.job, pedro);
assert.equal(chain.job.permanentCrewId, pedro.crewId);

const firstVisit = publishDaily(chain.job, pedro, "2026-07-28");
assert.equal(employeeRoute(pedro, "2026-07-28").length, 1);
assert.equal(employeeRoute(mauricio, "2026-07-28").length, 0);
assert.equal(chain.job.permanentCrewId, pedro.crewId, "Daily publication changed permanent Job ownership");

assert.throws(() => publishDaily(chain.job, pedro, "2026-07-28"), /Duplicate active Visit/);
assert.throws(() => publishDaily(chain.job, outsider, "2026-07-29"), /Cross-company/);
assert.throws(() => completeVisit(firstVisit, pedro), /must start before completion/);

temporaryMove(firstVisit, mauricio);
assert.equal(employeeRoute(pedro, "2026-07-28").length, 0);
assert.equal(employeeRoute(mauricio, "2026-07-28").length, 1);
assert.equal(chain.job.permanentCrewId, pedro.crewId, "Temporary Move changed permanent Job ownership");

startVisit(firstVisit, mauricio);
completeVisit(firstVisit, mauricio);
const completedExecutor = firstVisit.assignedEmployeeId;

const nextVisit = publishDaily(chain.job, pedro, "2026-07-29");
assert.equal(nextVisit.assignedEmployeeId, pedro.id, "Next occurrence did not return to permanent Employee");

permanentMove(chain.job, mauricio, "2026-07-29");
assert.equal(chain.job.permanentCrewId, mauricio.crewId);
assert.equal(nextVisit.assignedEmployeeId, mauricio.id, "Future Scheduled Visit did not follow permanent move");
assert.equal(firstVisit.assignedEmployeeId, completedExecutor, "Permanent Move rewrote completed execution history");

const bulkChains = Array.from({ length: 25 }, (_, index) =>
  createCustomerChain(companyA, `BULK-${String(index + 1).padStart(2, "0")}`));

for (const bulk of bulkChains.slice(0, 16)) {
  assignPermanent(bulk.job, pedro);
  publishDaily(bulk.job, pedro, "2026-07-30");
}
assert.equal(employeeRoute(pedro, "2026-07-30").length, 16);

assignPermanent(bulkChains[16].job, pedro);
assert.throws(
  () => publishDaily(bulkChains[16].job, pedro, "2026-07-30"),
  /capacity exceeded/,
);
publishDaily(bulkChains[16].job, mauricio, "2026-07-30");

for (const bulk of bulkChains.slice(17)) {
  assignPermanent(bulk.job, mauricio);
  publishDaily(bulk.job, mauricio, "2026-07-30");
}
assert.equal(employeeRoute(mauricio, "2026-07-30").length, 9);

const otherChain = createCustomerChain(companyB, "B-0001");
assert.notEqual(chain.customer.id, otherChain.customer.id);
assert.notEqual(chain.customer.companyId, otherChain.customer.companyId);
assert.equal(employeeRoute(outsider, "2026-07-28").length, 0, "Company isolation leaked another company's route");

console.log("Canonical operational simulations passed.");
console.log("Simulated 25 Customer → Property → Quote → Job chains and dated Employee routes.");
console.log("Verified tenant isolation, duplicate blocking, 16-stop capacity, publication, service Start/Done, temporary move, permanent move and Employee visibility.");
