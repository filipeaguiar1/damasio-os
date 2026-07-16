import { createId } from "@/lib/id";
import { createWorkflowEvent, getWorkflowSnapshot, stageFromOperationalState, type WorkflowEvent, type WorkflowStage } from "@/lib/workflow/workflowEngine";
function allowDemoSeed(){if(typeof window==="undefined")return false;try{const session=JSON.parse(localStorage.getItem("damasio_os_session")||"null") as {email?:string}|null;return Boolean(session?.email?.endsWith("@damasioos.demo"))}catch{return false}}
export type LeadStatus = "new" | "quoted" | "booked" | "lost" | "completed";
export type PaymentMethod = "credit_card" | "etransfer" | "cash_visit" | "cheque_visit" | "other";
export type PaymentStatus = "not_selected" | "pending" | "processing" | "paid" | "manual" | "failed" | "refunded";
export type TipMethod = "etransfer" | "card";
export type ExpenseCategory =
  | "fuel"
  | "equipment"
  | "maintenance"
  | "materials"
  | "insurance"
  | "marketing"
  | "other";
export type LawnSize = "xs" | "small" | "medium" | "large" | "legacy" | "oversize";
export type GrassHandling =
  "mulched" | "bag_green_bin" | "bag_leave_property" | "no_preference";
export type GrassHeight = "2in" | "3in" | "4in" | "5in";
export type CustomerPropertyDetails = {
  lawnSize: LawnSize;
  grassHeight: GrassHeight;
  grassHandling: GrassHandling;
  backyard: boolean;
  gated: boolean;
  adminNotes?: string;
  propertyAlerts?: string;
  accessNotes?: string;
};
export type EstimateStatus =
  "draft" | "sent" | "approved" | "declined" | "expired";
export type EstimateItemType =
  "labor" | "material" | "equipment" | "service" | "custom";
export type EstimateItem = {
  id: string;
  type: EstimateItemType;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
};
export type Estimate = {
  id: string;
  number: string;
  createdAt: string;
  validUntil: string;
  customer: string;
  phone: string;
  email: string;
  address: string;
  title: string;
  description: string;
  status: EstimateStatus;
  items: EstimateItem[];
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  approvedAt?: string;
  requestId?: string;
};
export type CustomerPaymentProfile = {
  primaryMethod:"stripe"|"account_balance";
  balance:number;
  automaticPayments:boolean;
  updatedAt:string;
};
export type Feedback = {
  rating: number;
  comment: string;
  tipAmount: number;
  tipMethod: TipMethod;
  recommend: "yes" | "maybe" | "no";
  createdAt: string;
};
export type ServiceFrequency = "weekly" | "biweekly" | "monthly" | "seasonal" | "adaptive" | "one_time";
export type Lead = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  service: string;
  status: LeadStatus;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  paymentNote?: string;
  paymentRecordedAt?: string;
  paymentReference?: string;
  scheduledDate?: string;
  scheduledWindow?: string;
  assignedCrew?: string;
  serviceDay?: string;
  serviceFrequency?: ServiceFrequency;
  nextVisitDate?: string;
  feedback?: Feedback;
  photos?: string[];
  sourceEstimateId?: string;
  propertyDetails?: CustomerPropertyDetails;
  propertyPhoto?: string;
  propertyPhotoUpdatedAt?: string;
  latitude?: number;
  longitude?: number;
  routeOrder?: number;
  canonicalVisitId?: string;
  canonicalJobId?: string;
  visitStartedAt?: string;
  visitFinishedAt?: string;
  visitDurationSeconds?: number;
};
export type Expense = {
  id: string;
  createdAt: string;
  date: string;
  vendor: string;
  category: ExpenseCategory;
  amount: number;
  notes?: string;
};
export type Invoice = {
  id: string;
  number: string;
  createdAt: string;
  leadId?: string;
  estimateId?: string;
  requestId?: string;
  customer: string;
  service: string;
  subtotal: number;
  tax: number;
  total: number;
  status: "draft" | "sent" | "waiting_payment" | "processing" | "paid" | "overdue" | "rejected";
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  paymentRecordedAt?: string;
  paymentNotes?: string;
};
export type DailyChecklist = {
  id: string;
  date: string;
  employee: string;
  crew: string;
  confirmedAt: string;
  items: string[];
};
export type Notification = {
  id: string;
  createdAt: string;
  title: string;
  message: string;
  type:
    | "lead"
    | "schedule"
    | "payment"
    | "review"
    | "weather"
    | "system"
    | "estimate";
  read: boolean;
};
export type Recurrence = {
  id: string;
  customer: string;
  service: string;
  address: string;
  frequency: ServiceFrequency;
  nextDate: string;
  active: boolean;
};
export type ServiceSession = {
  id: string;
  leadId: string;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  status: "not_started" | "running" | "finished" | "paused" | "skipped";
  completionComment?: string;
  skippedAt?: string;
  skipComment?: string;
  skipPhotos?: string[];
  employee: string;
  crew: string;
};
export type EmployeeTask = {
  id: string;
  createdAt: string;
  leadId: string;
  customer: string;
  address: string;
  title: string;
  description: string;
  status: "open" | "assigned" | "in_progress" | "completed" | "resolved";
  priority: "low" | "normal" | "urgent";
  assignedTo: string;
  scheduledDate?: string;
  assignedAt?: string;
  resolvedAt?: string;
  completedBy?: string;
  workDone?: string;
  workStartedAt?: string;
  workFinishedAt?: string;
  durationSeconds?: number;
  completionPhotos?: string[];
  completionSummary?: string;
  source?: "customer" | "admin" | "employee";
};
export type EmployeeProfile = {
  name: string;
  email: string;
  phone?: string;
  defaultAddress?: string;
  photoLabel: string;
  photoUrl?: string;
  crew?: string;
};
export type EmployeePermissions = {
  viewRoute: boolean;
  startJob: boolean;
  finishJob: boolean;
  uploadPhotos: boolean;
  receiveNotifications: boolean;
  viewPropertyNotes: boolean;
  viewCustomerPhone: boolean;
  editCustomerInfo: boolean;
  createEstimates: boolean;
  assignRoutes: boolean;
  accessAdmin: boolean;
  viewFinancialReports: boolean;
};
export type ActivityLog = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  target: string;
  details: string;
};

export type ServiceRequestStatus =
  "pending" | "quoted" | "accepted" | "scheduled" | "rejected" | "completed";
export type ServiceRequest = {
  id: string;
  createdAt: string;
  customerName: string;
  phone: string;
  email: string;
  address: string;
  service: "Spring Cleanup" | "Fall Cleanup" | "Custom Request";
  message?: string;
  status: ServiceRequestStatus;
  estimateId?: string;
  paymentPreference?: "card" | "etransfer";
  adminNotes?: string;
  assignedCrew?: string;
  serviceDay?: string;
  scheduledDate?: string;
  scheduledLabel?: string;
  jobId?: string;
};

const STORAGE_VERSION = "50.0.1";
const K = {
  leads: "damasio_os_leads",
  expenses: "damasio_os_expenses",
  invoices: "damasio_os_invoices",
  check: "damasio_os_daily_checklists",
  noti: "damasio_os_notifications",
  rec: "damasio_os_recurrences",
  est: "damasio_os_estimates",
  sess: "damasio_os_service_sessions",
  tasks: "damasio_os_employee_tasks",
  profile: "damasio_os_employee_profile",
  perm: "damasio_os_employee_permissions",
  logs: "damasio_os_activity_log",
  workflow: "damasio_os_workflow_events",
  req: "damasio_os_service_requests",
  customerPayment: "damasio_os_customer_payment_profile",
};
function ensureStorageVersion() {
  if (typeof window === "undefined") return;
  const key = "damasio_os_storage_version";
  const current = window.localStorage.getItem(key);
  if (current === STORAGE_VERSION) return;
  window.localStorage.removeItem(K.sess);
  // V50.0.1: mobile/timer migration. Old browser sessions cannot be reused after ZIP updates.
  // This prevents old local timers from reopening or finishing a house by themselves.
  window.localStorage.setItem(key, STORAGE_VERSION);
}
function read<T>(k: string, f: T): T {
  if (typeof window === "undefined") return f;
  ensureStorageVersion();
  try { return JSON.parse(window.localStorage.getItem(k) || JSON.stringify(f)); } catch { return f; }
}
function write<T>(k: string, v: T) {
  if (typeof window === "undefined") return;
  ensureStorageVersion();
  window.localStorage.setItem(k, JSON.stringify(v));
}
function money(v: number) {
  return Math.round(v * 100) / 100;
}

export function formatLongDate(dateKey: string) {
  if (!dateKey) return "Date not set";
  return new Date(dateKey + "T12:00:00").toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function getServiceRequests(): ServiceRequest[] {
  return read<ServiceRequest[]>(K.req, []);
}
export function saveServiceRequest(
  input: Omit<ServiceRequest, "id" | "createdAt" | "status">,
) {
  const req: ServiceRequest = {
    id: createId(),
    createdAt: new Date().toISOString(),
    status: "pending",
    ...input,
  };
  write(K.req, [req, ...getServiceRequests()]);
  addNotification(
    "lead",
    "New service request",
    `${req.customerName} requested ${req.service}.`,
  );
  addActivityLog(
    "Customer",
    "Submitted request",
    req.service,
    `${req.customerName} - ${req.address}`,
  );
  return req;
}
export function updateServiceRequest(
  id: string,
  patch: Partial<ServiceRequest>,
) {
  write(
    K.req,
    getServiceRequests().map((r) => (r.id === id ? { ...r, ...patch } : r)),
  );
  addActivityLog(
    "Admin",
    "Updated request",
    id,
    `Request status/details changed.`,
  );
}
export function seedDemoRequests() {
  if(!allowDemoSeed())return;
  if (getServiceRequests().length > 0) return;
  write(K.req, [
    {
      id: "REQ-1",
      createdAt: new Date().toISOString(),
      customerName: "Customer Demo",
      phone: "905-555-0101",
      email: "customer@email.com",
      address: "123 King St, Hamilton",
      service: "Spring Cleanup",
      message: "Please quote spring cleanup for front and backyard.",
      status: "pending",
    },
  ]);
}

export function getActivityLogs(): ActivityLog[] {
  return read<ActivityLog[]>(K.logs, []);
}
export function addActivityLog(
  actor: string,
  action: string,
  target: string,
  details: string,
) {
  const log = {
    id: createId(),
    createdAt: new Date().toISOString(),
    actor,
    action,
    target,
    details,
  };
  write(K.logs, [log, ...getActivityLogs()]);
}
export function getWorkflowEvents(): WorkflowEvent[] {
  return read<WorkflowEvent[]>(K.workflow, []);
}

export function addWorkflowEvent(input: {
  entityType: WorkflowEvent["entityType"];
  entityId: string;
  fromStage?: WorkflowStage;
  toStage: WorkflowStage;
  actor: string;
  note: string;
}) {
  const event = createWorkflowEvent(input);
  write(K.workflow, [event, ...getWorkflowEvents()]);
  return event;
}

export function getLeadWorkflowSnapshot(lead: Lead) {
  const openTasks = getEmployeeTasks().some((task) => task.leadId === lead.id && task.status !== "resolved");
  const stage = stageFromOperationalState({
    leadStatus: lead.status,
    hasFeedback: Boolean(lead.feedback),
    hasOpenTask: openTasks,
    assignedCrew: lead.assignedCrew,
    scheduledDate: lead.scheduledDate,
    nextVisitDate: lead.nextVisitDate,
  });
  return getWorkflowSnapshot(stage);
}

export function getUnifiedVisitHistory(leadId?: string) {
  const leads = getLeads();
  const sessions = getSessions();
  const tasks = getEmployeeTasks();
  const workflows = getWorkflowEvents();
  return sessions
    .filter((session) => !leadId || session.leadId === leadId)
    .map((session) => {
      const lead = leads.find((item) => item.id === session.leadId);
      return {
        id: session.id,
        leadId: session.leadId,
        customer: lead?.name || "Unknown customer",
        address: lead?.address || "Address missing",
        service: lead?.service || "Service",
        employee: session.employee,
        crew: session.crew,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        durationSeconds: session.durationSeconds || 0,
        comment: session.completionComment || "",
        photos: lead?.photos || [],
        feedback: lead?.feedback,
        tasks: tasks.filter((task) => task.leadId === session.leadId),
        workflow: workflows.filter((event) => event.entityId === session.leadId),
      };
    });
}

export function getOperationsIntelligence() {
  const leads = getLeads();
  const tasks = getEmployeeTasks();
  const sessions = getSessions();
  const openTasks = tasks.filter((task) => task.status !== "resolved");
  const activeSessions = sessions.filter((session) => session.status === "running");
  const completedSessions = sessions.filter((session) => session.status === "finished");
  const workflowStages = leads.reduce<Record<string, number>>((acc, lead) => {
    const stage = getLeadWorkflowSnapshot(lead).stage;
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
  return {
    activeJobs: activeSessions.length,
    completedJobs: completedSessions.length,
    openTasks: openTasks.length,
    feedbacks: leads.filter((lead) => Boolean(lead.feedback)).length,
    workflowStages,
  };
}

export function getEmployeePermissions(): EmployeePermissions {
  return read<EmployeePermissions>(K.perm, {
    viewRoute: true,
    startJob: true,
    finishJob: true,
    uploadPhotos: true,
    receiveNotifications: true,
    viewPropertyNotes: true,
    viewCustomerPhone: false,
    editCustomerInfo: false,
    createEstimates: false,
    assignRoutes: false,
    accessAdmin: false,
    viewFinancialReports: false,
  });
}
export function saveEmployeePermissions(p: EmployeePermissions) {
  write(K.perm, p);
  addActivityLog(
    "Admin",
    "Updated permissions",
    "Employee",
    "Employee permissions changed.",
  );
}

export function calculateEstimateTotals(items: EstimateItem[]) {
  const subtotal = money(
    items.reduce((s, i) => s + (+i.quantity || 0) * (+i.unitPrice || 0), 0),
  );
  const tax = money(subtotal * 0.13);
  return { subtotal, tax, total: money(subtotal + tax) };
}
function estimateNumber() {
  return `EST-${new Date().getFullYear()}-${(getEstimates().length + 1).toString().padStart(4, "0")}`;
}
export function getEstimates(): Estimate[] {
  return read<Estimate[]>(K.est, []);
}
export function saveEstimate(
  input: Omit<
    Estimate,
    "id" | "number" | "createdAt" | "subtotal" | "tax" | "total"
  >,
) {
  const totals = calculateEstimateTotals(input.items);
  const e = {
    id: createId(),
    number: estimateNumber(),
    createdAt: new Date().toISOString(),
    ...input,
    ...totals,
  };
  write(K.est, [e, ...getEstimates()]);
  addNotification(
    "estimate",
    "Estimate created",
    `${e.number} created for ${e.customer}.`,
  );
  return e;
}

export function createEstimateFromRequest(requestId: string, total = 299) {
  const r = getServiceRequests().find((x) => x.id === requestId);
  if (!r) return null;
  const subtotal = money(total / 1.13);
  const e = saveEstimate({
    validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14)
      .toISOString()
      .slice(0, 10),
    customer: r.customerName,
    phone: r.phone,
    email: r.email,
    address: r.address,
    title: r.service,
    description: r.message || `Quote requested for ${r.service}.`,
    status: "sent",
    requestId: r.id,
    items: [
      {
        id: createId(),
        type: "service",
        description: r.service,
        quantity: 1,
        unit: "service",
        unitPrice: subtotal,
      },
    ],
  });
  updateServiceRequest(r.id, { status: "quoted", estimateId: e.id });
  addNotification(
    "estimate",
    "Quote sent",
    `${e.number} sent to ${r.customerName}.`,
  );
  return e;
}
export function updateEstimateStatus(id: string, status: EstimateStatus) {
  const estimate = getEstimates().find((e) => e.id === id);
  write(
    K.est,
    getEstimates().map((e) =>
      e.id === id
        ? {
            ...e,
            status,
            approvedAt:
              status === "approved" ? new Date().toISOString() : e.approvedAt,
          }
        : e,
    ),
  );
  if (estimate?.requestId) {
    updateServiceRequest(estimate.requestId, {
      status:
        status === "approved"
          ? "accepted"
          : status === "declined"
            ? "rejected"
            : "quoted",
      estimateId: id,
    });
  }
}

export function reviseEstimateTotal(id:string,total:number){
  const estimate=getEstimates().find(item=>item.id===id);if(!estimate)return null;
  const safeTotal=Math.max(0,Math.round(total*100)/100);const subtotal=money(safeTotal/1.13);const tax=money(safeTotal-subtotal);
  const items:EstimateItem[]=[{id:estimate.items[0]?.id||createId(),type:"service",description:estimate.items[0]?.description||estimate.title,quantity:1,unit:"service",unitPrice:subtotal}];
  const next={...estimate,items,subtotal,tax,total:safeTotal};write(K.est,getEstimates().map(item=>item.id===id?next:item));
  addActivityLog("Master","Revised quote",estimate.number,`Quote total changed to $${safeTotal.toFixed(2)}.`);return next;
}

export function findEstimateByNumber(number:string){const normalized=number.trim().toUpperCase();return getEstimates().find(item=>item.number.toUpperCase()===normalized)||null}

export function getCustomerPaymentProfile():CustomerPaymentProfile{return read<CustomerPaymentProfile>(K.customerPayment,{primaryMethod:"stripe",balance:0,automaticPayments:false,updatedAt:new Date(0).toISOString()})}
export function saveCustomerPaymentProfile(patch:Partial<CustomerPaymentProfile>){const next={...getCustomerPaymentProfile(),...patch,updatedAt:new Date().toISOString()};write(K.customerPayment,next);return next}

export function canFinalizeEstimate(id: string, nextStatus: "approved" | "declined") {
  const e = getEstimates().find((x) => x.id === id);
  if (!e) return { ok: false, reason: "Estimate not found." };
  if (e.status === "approved") return { ok: false, reason: "This estimate is already approved and cannot be declined." };
  if (e.status === "declined") return { ok: false, reason: "This estimate is already declined and cannot be approved." };
  if (nextStatus === "approved" || nextStatus === "declined") return { ok: true, reason: "" };
  return { ok: false, reason: "Invalid action." };
}

export function finalizeEstimate(id: string, status: "approved" | "declined") {
  const check = canFinalizeEstimate(id, status);
  if (!check.ok) return { ok: false, message: check.reason };
  updateEstimateStatus(id, status);
  const estimate = getEstimates().find((e) => e.id === id);
  if (status === "approved" && estimate) {
    createInvoiceFromEstimate(estimate.id);
  }
  addNotification(
    "estimate",
    status === "approved" ? "Quote approved" : "Quote declined",
    estimate ? `${estimate.number} was ${status}.` : `Quote was ${status}.`,
  );
  return { ok: true, message: status === "approved" ? "Quote approved. Invoice created and payment is required before scheduling." : "Quote declined and closed." };
}

export function assignRequestToCrew(
  requestId: string,
  crew: string,
  serviceDay: string,
  scheduledDate: string,
) {
  const r = getServiceRequests().find((x) => x.id === requestId);
  if (!r) return null;
  const estimate = r.estimateId ? getEstimates().find((e) => e.id === r.estimateId) : null;
  const existing = r.jobId ? getLeads().find((l) => l.id === r.jobId) : null;
  if (existing) {
    updateLead(existing.id, {
      assignedCrew: crew,
      serviceDay,
      scheduledDate,
      nextVisitDate: scheduledDate,
      serviceFrequency: "seasonal",
      status: "booked",
    });
    updateServiceRequest(requestId, { assignedCrew: crew, serviceDay, scheduledDate, scheduledLabel: formatLongDate(scheduledDate), jobId: existing.id, status: "scheduled" });
    broadcastOperationsChange(`${r.service} moved to ${crew} on ${formatLongDate(scheduledDate)}.`);
    return existing;
  }
  const subtotal = estimate?.subtotal ?? 0;
  const tax = estimate?.tax ?? 0;
  const total = estimate?.total ?? 0;
  const lead: Lead = {
    id: createId(),
    createdAt: new Date().toISOString(),
    name: r.customerName,
    phone: r.phone,
    email: r.email,
    address: r.address,
    service: r.service,
    status: "booked",
    subtotal,
    tax,
    total,
    notes: r.message,
    paymentMethod: r.paymentPreference === "card" ? undefined : "etransfer",
    paymentStatus: estimate?.status === "approved" ? "pending" : "not_selected",
    scheduledDate,
    assignedCrew: crew,
    serviceDay,
    serviceFrequency: "seasonal",
    nextVisitDate: scheduledDate,
    photos: [],
    sourceEstimateId: estimate?.id,
    propertyDetails: {
      lawnSize: "small",
      grassHeight: "3in",
      grassHandling: "no_preference",
      backyard: true,
      gated: false,
    },
  };
  saveLead(lead);
  updateServiceRequest(requestId, { assignedCrew: crew, serviceDay, scheduledDate, scheduledLabel: formatLongDate(scheduledDate), jobId: lead.id, status: "scheduled" });
  addNotification("schedule", "Request assigned", `${r.service} assigned to ${crew} for ${formatLongDate(scheduledDate)}.`);
  broadcastOperationsChange(`${r.service} assigned to ${crew} for ${formatLongDate(scheduledDate)}.`);
  return lead;
}

export function convertEstimateToJob(id: string) {
  const e = getEstimates().find((x) => x.id === id);
  if (!e) return null;
  const lead: Lead = {
    id: createId(),
    createdAt: new Date().toISOString(),
    name: e.customer,
    phone: e.phone,
    email: e.email,
    address: e.address,
    service: e.title,
    status: "booked",
    subtotal: e.subtotal,
    tax: e.tax,
    total: e.total,
    notes: e.description,
    paymentStatus: "not_selected",
    photos: [],
    sourceEstimateId: e.id,
    propertyDetails: {
      lawnSize: "small",
      grassHeight: "3in",
      grassHandling: "no_preference",
      backyard: true,
      gated: false,
    },
  };
  saveLead(lead);
  updateEstimateStatus(id, "approved");
  return lead;
}
export function deleteEstimate(id: string) {
  write(
    K.est,
    getEstimates().filter((e) => e.id !== id),
  );
}
export function seedDemoEstimates() {
  if(!allowDemoSeed())return;
  if (getEstimates().length > 0) return;
  saveEstimate({
    validUntil: "2026-07-30",
    customer: "Robert Green",
    phone: "905-555-5555",
    email: "robert@email.com",
    address: "55 Queen St, Hamilton",
    title: "Mulch Installation",
    description: "Supply and install black mulch.",
    status: "sent",
    items: [
      {
        id: "1",
        type: "material",
        description: "Black mulch",
        quantity: 4,
        unit: "yard",
        unitPrice: 68,
      },
      {
        id: "2",
        type: "labor",
        description: "Labor",
        quantity: 5,
        unit: "hour",
        unitPrice: 55,
      },
    ],
  });
}

export function getLeads(): Lead[] {
  return read<Lead[]>(K.leads, []);
}
export function setLeads(leads: Lead[]) {
  write(K.leads, leads);
}
export function saveLead(lead: Lead) {
  setLeads([lead, ...getLeads()]);
}
export function getLead(id: string) {
  return getLeads().find((l) => l.id === id) || null;
}
export function updateLead(id: string, patch: Partial<Lead>) {
  setLeads(getLeads().map((l) => {
    if (l.id !== id) return l;
    const addressChanged = typeof patch.address === "string" && patch.address.trim().toLowerCase() !== l.address.trim().toLowerCase();
    return {
      ...l,
      ...patch,
      ...(addressChanged && patch.latitude === undefined && patch.longitude === undefined
        ? { latitude: undefined, longitude: undefined }
        : {}),
    };
  }));
  addActivityLog(
    "Admin",
    "Updated lead",
    id,
    "Lead/customer information changed.",
  );
}
export function updatePropertyDetails(
  id: string,
  details: CustomerPropertyDetails,
) {
  setLeads(
    getLeads().map((l) =>
      l.id === id ? { ...l, propertyDetails: details } : l,
    ),
  );
  addActivityLog(
    "Admin",
    "Updated property",
    id,
    "Lot size, grass height, handling or notes changed.",
  );
}
export function createManualCustomer(input: {
  name: string;
  phone: string;
  email: string;
  address: string;
  service: string;
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
  scheduledDate?: string;
  scheduledWindow?: string;
  assignedCrew?: string;
  propertyDetails?: CustomerPropertyDetails;
}) {
  const lead: Lead = {
    id: createId(),
    createdAt: new Date().toISOString(),
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    service: input.service,
    status: input.scheduledDate ? "booked" : "new",
    subtotal: input.subtotal,
    tax: input.tax,
    total: input.total,
    notes: input.notes,
    scheduledDate: input.scheduledDate,
    scheduledWindow: input.scheduledWindow,
    assignedCrew: input.assignedCrew,
    paymentStatus: "not_selected",
    photos: [],
    propertyDetails: input.propertyDetails || {
      lawnSize: "small",
      grassHeight: "3in",
      grassHandling: "no_preference",
      backyard: true,
      gated: false,
    },
  };
  saveLead(lead);
  addActivityLog("Admin", "Created customer/property", lead.name, `${lead.address} added to the unified operations list.`);
  addNotification("lead", "Customer created", `${lead.name} is now available for Dispatch.`);
  broadcastOperationsChange(`${lead.name} added to Customers, Properties and Dispatch.`);
  return lead;
}
export function updateLeadStatus(id: string, status: LeadStatus) {
  setLeads(getLeads().map((l) => (l.id === id ? { ...l, status } : l)));
}
export function isLeadAvailableForRoute(lead: Lead) {
  return !lead.scheduledDate && !lead.assignedCrew && lead.status !== "booked" && lead.status !== "completed";
}

export function scheduleLead(
  id: string,
  scheduledDate: string,
  scheduledWindow: string,
  assignedCrew: string,
) {
  const lead = getLead(id);
  if (!lead || !isLeadAvailableForRoute(lead)) return false;
  const serviceDay = scheduledDate ? dayNameFromDate(scheduledDate) : undefined;
  setLeads(
    getLeads().map((l) =>
      l.id === id
        ? {
            ...l,
            scheduledDate,
            scheduledWindow,
            assignedCrew,
            serviceDay,
            nextVisitDate: scheduledDate || l.nextVisitDate,
            status: "booked" as LeadStatus,
          }
        : l,
    ),
  );
  addNotification("schedule", "Service scheduled", `A service was scheduled for ${scheduledDate}.`);
  addWorkflowEvent({ entityType: "visit", entityId: id, fromStage: "approved", toStage: "scheduled", actor: "Admin", note: `Scheduled for ${scheduledDate} with ${assignedCrew}.` });
  broadcastOperationsChange(`Scheduled ${id} for ${assignedCrew}.`);
  return true;
}

export function scheduleRouteBatch(
  ids: string[],
  scheduledDate: string,
  scheduledWindow: string,
  assignedCrew: string,
) {
  if (!ids.length || !scheduledDate || !assignedCrew) return 0;
  const serviceDay = dayNameFromDate(scheduledDate);
  const idSet = new Set(ids);
  const leads = getLeads();
  const allowedIds = new Set(leads.filter((l) => idSet.has(l.id) && isLeadAvailableForRoute(l)).map((l) => l.id));
  if (!allowedIds.size) return 0;
  setLeads(
    leads.map((l) =>
      allowedIds.has(l.id)
        ? {
            ...l,
            scheduledDate,
            scheduledWindow,
            assignedCrew,
            serviceDay,
            nextVisitDate: scheduledDate,
            status: "booked" as LeadStatus,
          }
        : l,
    ),
  );
  Array.from(allowedIds).forEach((id) =>
    addWorkflowEvent({ entityType: "visit", entityId: id, fromStage: "approved", toStage: "scheduled", actor: "Admin", note: `Batch route scheduled for ${scheduledDate} with ${assignedCrew}.` }),
  );
  addActivityLog("Admin", "Created route", assignedCrew, `${allowedIds.size} house(s) scheduled for ${serviceDay}, ${scheduledDate}.`);
  addNotification("schedule", "Route created", `${allowedIds.size} service(s) assigned to ${assignedCrew} on ${scheduledDate}.`);
  broadcastOperationsChange(`${allowedIds.size} homes assigned to ${assignedCrew}.`);
  return allowedIds.size;
}

export function createAdminTask(input: {
  leadId: string;
  title: string;
  description: string;
  priority: EmployeeTask["priority"];
  assignedTo: string;
  scheduledDate?: string;
}) {
  const lead = getLead(input.leadId);
  if (!lead) return null;
  const task = saveEmployeeTask({
    leadId: lead.id,
    customer: lead.name,
    address: lead.address,
    title: input.title || `Return visit - ${lead.service}`,
    description: input.description || "Admin created return visit.",
    status: input.assignedTo === "Admin" || input.assignedTo === "Unassigned" ? "open" : "assigned",
    priority: input.priority,
    assignedTo: input.assignedTo,
    scheduledDate: input.scheduledDate,
    assignedAt: input.assignedTo === "Admin" || input.assignedTo === "Unassigned" ? undefined : new Date().toISOString(),
    source: "admin",
  });
  if (input.scheduledDate && DAMASIO_CREWS.includes(input.assignedTo)) {
    scheduleLead(lead.id, input.scheduledDate, "Return Visit", input.assignedTo);
  }
  addActivityLog("Admin", "Created task", lead.name, task.description);
  addNotification("system", "Task created", `${task.title} for ${lead.name}.`);
  addWorkflowEvent({ entityType: "task", entityId: lead.id, fromStage: "completed", toStage: "task", actor: "Admin", note: task.description });
  broadcastOperationsChange(`Task created for ${lead.name}.`);
  return task;
}
export function updateLeadPayment(
  id: string,
  paymentMethod: PaymentMethod,
  paymentStatus: PaymentStatus,
  paymentNote?: string,
  paymentReference?: string,
) {
  setLeads(
    getLeads().map((l) =>
      l.id === id
        ? {
            ...l,
            paymentMethod,
            paymentStatus,
            paymentNote,
            paymentReference,
            paymentRecordedAt: new Date().toISOString(),
          }
        : l,
    ),
  );
  addActivityLog("Admin", "Recorded payment", id, `${paymentStatus} via ${paymentMethod}. ${paymentNote || ""}`);
}
export function saveFeedback(id: string, feedback: Feedback) {
  setLeads(
    getLeads().map((l) => {
      if (l.id !== id) return l;
      const previousTip = l.feedback?.tipAmount || 0;
      const additionalTip = feedback.tipAmount || 0;
      return {
        ...l,
        feedback: {
          ...feedback,
          tipAmount: previousTip + additionalTip,
          tipMethod: feedback.tipMethod || l.feedback?.tipMethod || "etransfer",
        },
        status: "completed" as LeadStatus,
      };
    }),
  );
  addActivityLog("Customer", "Submitted feedback", id, "Customer submitted or updated a service review.");
  addWorkflowEvent({ entityType: "visit", entityId: id, fromStage: "completed", toStage: "feedback", actor: "Customer", note: "Customer submitted feedback." });
}
export function resetFeedbackReview(id: string) {
  setLeads(
    getLeads().map((l) =>
      l.id === id && l.feedback
        ? { ...l, feedback: { ...l.feedback, rating: 0, comment: "", recommend: "maybe", createdAt: new Date().toISOString() } }
        : l,
    ),
  );
  addActivityLog("Customer", "Reset review", id, "Rating and comment were reset. Tip total was preserved.");
}
export function saveServicePhotos(id: string, photos: string[]) {
  setLeads(
    getLeads().map((l) =>
      l.id === id ? { ...l, photos: photos.slice(0, 5) } : l,
    ),
  );
  addActivityLog(
    "Employee",
    "Uploaded photos",
    id,
    `${Math.min(photos.length, 5)} photos`,
  );
}
export function clearLeads() {
  if (typeof window !== "undefined") window.localStorage.removeItem(K.leads);
}

export function setPropertyPhoto(leadId: string, photo: string) {
  setLeads(
    getLeads().map((l) =>
      l.id === leadId
        ? { ...l, propertyPhoto: photo, propertyPhotoUpdatedAt: new Date().toISOString() }
        : l,
    ),
  );
  addActivityLog("Property", "Updated property photo", leadId, "Official property photo changed.");
}
export function createCustomerTaskFromService(leadId: string, description: string) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const task = saveEmployeeTask({
    leadId,
    customer: lead.name,
    address: lead.address,
    title: `Customer reported a problem - ${lead.service}`,
    description,
    status: "open",
    priority: "urgent",
    assignedTo: "Admin",
    source: "customer",
  });
  addNotification("review", "Customer reported a task", `${lead.name} reported a problem for ${lead.service}.`);
  addActivityLog("Customer", "Reported task", lead.name, description);
  addWorkflowEvent({ entityType: "task", entityId: leadId, fromStage: "feedback", toStage: "task", actor: "Customer", note: description });
  broadcastOperationsChange(`${lead.name} reported a service task.`);
  return task;
}
function taskCompletionSnapshot(task: EmployeeTask | undefined, workDone: string, completedBy: string) {
  const lead = task ? getLead(task.leadId) : null;
  const session = task ? getSessionForLead(task.leadId) : null;
  // V42.8: resolving a return task must NEVER finish the house timer.
  // Done is only allowed through the Employee Finish button.
  const now = new Date().toISOString();
  const photos = lead?.photos?.slice(0, 5) || [];
  const durationSeconds = session?.durationSeconds || (session?.startedAt ? Math.max(0, Math.round((new Date(now).getTime() - new Date(session.startedAt).getTime()) / 1000)) : undefined);
  return {
    resolvedAt: now,
    workDone,
    completedBy,
    workStartedAt: session?.startedAt,
    workFinishedAt: session?.finishedAt,
    durationSeconds,
    completionPhotos: photos,
    completionSummary: `${completedBy} completed the return visit${durationSeconds ? ` in ${Math.round(durationSeconds / 60)} min` : ""}. ${photos.length} photo(s) attached.`,
  };
}

export function resolveEmployeeTask(id: string, workDone = "Return visit completed. Employee marked the customer issue as resolved.", completedBy = "Employee") {
  const before = getEmployeeTasks().find((t) => t.id === id);
  const snapshot = taskCompletionSnapshot(before, workDone, completedBy);
  write(
    K.tasks,
    getEmployeeTasks().map((t) =>
      t.id === id
        ? { ...t, status: "resolved", ...snapshot }
        : t,
    ),
  );
  const task = before || getEmployeeTasks().find((t) => t.id === id);
  if (task) {
    addActivityLog(completedBy, "Resolved task", task.customer, workDone || task.description);
    addWorkflowEvent({ entityType: "task", entityId: task.leadId, fromStage: "task", toStage: "completed", actor: completedBy, note: workDone || task.description });
    addNotification("system", "Task resolved", `${task.title} was resolved for ${task.customer}.`);
    broadcastOperationsChange(`Task resolved for ${task.customer}.`);
  }
}
export function getTaskHistory() {
  return getEmployeeTasks().filter((t) => t.status === "resolved");
}

export function getEmployeeTasks(): EmployeeTask[] {
  const tasks = read<EmployeeTask[]>(K.tasks, []);
  return tasks.map((task) =>
    task.status === "open" && task.assignedTo && task.assignedTo !== "Admin" && task.assignedTo !== "Unassigned"
      ? { ...task, status: "assigned" }
      : task,
  );
}
export function getOpenEmployeeTasks(): EmployeeTask[] {
  return getEmployeeTasks().filter((t) => t.status !== "resolved");
}
export function saveEmployeeTask(
  input: Omit<EmployeeTask, "id" | "createdAt">,
) {
  const t = {
    id: createId(),
    createdAt: new Date().toISOString(),
    ...input,
  };
  write(K.tasks, [t, ...getEmployeeTasks()]);
  return t;
}

export function assignEmployeeTask(id: string, assignedTo: string, scheduledDate: string) {
  const task = getEmployeeTasks().find((t) => t.id === id);
  if (!task) return false;
  if (task.status !== "open" || (task.assignedTo && task.assignedTo !== "Admin" && task.assignedTo !== "Unassigned")) {
    addNotification("review", "Assignment blocked", `${task.title} is already assigned. Use Unassign before selecting another employee.`);
    return false;
  }
  write(
    K.tasks,
    getEmployeeTasks().map((t) =>
      t.id === id
        ? {
            ...t,
            assignedTo,
            scheduledDate,
            assignedAt: new Date().toISOString(),
            status: "assigned",
          }
        : t,
    ),
  );
  if (scheduledDate && DAMASIO_CREWS.includes(assignedTo)) {
    scheduleLead(task.leadId, scheduledDate, "Return Visit", assignedTo);
  }
  addActivityLog("Admin", "Assigned return task", task.customer, `${task.title} assigned to ${assignedTo} for ${scheduledDate}.`);
  addNotification("system", "Return task assigned", `${task.title} assigned to ${assignedTo}.`);
  broadcastOperationsChange(`Return task assigned to ${assignedTo} for ${task.customer}.`);
  return true;
}

export function unassignEmployeeTask(id: string, reason = "Removed from Employee by Admin") {
  const task = getEmployeeTasks().find((t) => t.id === id);
  if (!task) return false;
  if (task.status !== "assigned") {
    addNotification("review", "Unassign blocked", `${task.title} can only be unassigned while it is Assigned.`);
    return false;
  }
  write(
    K.tasks,
    getEmployeeTasks().map((t) =>
      t.id === id
        ? {
            ...t,
            assignedTo: "Admin",
            status: "open",
            scheduledDate: undefined,
            assignedAt: undefined,
          }
        : t,
    ),
  );
  addActivityLog("Admin", "Unassigned return task", task.customer, reason);
  addNotification("review", "Task returned to Admin queue", `${task.title} for ${task.customer} is open again.`);
  broadcastOperationsChange(`Admin unassigned return task from ${task.assignedTo || "employee"} for ${task.customer}.`);
  return true;
}


export function returnEmployeeTaskToAdmin(id: string, reason = "Returned by Employee") {
  const task = getEmployeeTasks().find((t) => t.id === id);
  write(
    K.tasks,
    getEmployeeTasks().map((t) =>
      t.id === id
        ? {
            ...t,
            assignedTo: "Admin",
            status: "open",
            scheduledDate: undefined,
            assignedAt: undefined,
          }
        : t,
    ),
  );
  if (task) {
    addActivityLog("Employee", "Returned task to Admin", task.customer, reason);
    addNotification("review", "Task returned to Admin", `${task.title} for ${task.customer} needs reassignment.`);
    broadcastOperationsChange(`Task returned to Admin for ${task.customer}.`);
  }
}

export function updateEmployeeTaskStatus(
  id: string,
  status: EmployeeTask["status"],
  workDone = "Return visit completed. Employee marked the customer issue as resolved.",
  completedBy = "Employee",
) {
  const before = getEmployeeTasks().find((t) => t.id === id);
  write(
    K.tasks,
    getEmployeeTasks().map((t) =>
      t.id === id
        ? {
            ...t,
            status,
            ...(status === "completed" || status === "resolved" ? taskCompletionSnapshot(before, workDone, completedBy) : { workStartedAt: t.workStartedAt || new Date().toISOString() }),
          }
        : t,
    ),
  );
  if (before) {
    addActivityLog(
      "Employee",
      status === "resolved" ? "Resolved task" : status === "completed" ? "Completed return task" : "Started return task",
      before.customer,
      status === "resolved" || status === "completed" ? workDone : before.description,
    );
    broadcastOperationsChange(
      status === "resolved" ? `Task resolved for ${before.customer}.` : status === "completed" ? `Return visit completed for ${before.customer}. Waiting for Admin Resolve.` : `Return visit started for ${before.customer}.`,
    );
  }
}
export function seedEmployeeTasks() {
  if(!allowDemoSeed())return;
  if (getEmployeeTasks().length > 0) return;
  const leads = getLeads();
  const a = leads[0],
    b = leads[1] || a;
  write(K.tasks, [
    {
      id: "TASK-1",
      createdAt: new Date().toISOString(),
      leadId: a?.id || "1",
      customer: a?.name || "John Smith",
      address: a?.address || "123 King St",
      title: "Return visit required",
      description: "Customer said side strip near fence was missed.",
      status: "open",
      priority: "urgent",
      assignedTo: "Admin",
    },
    {
      id: "TASK-2",
      createdAt: new Date().toISOString(),
      leadId: b?.id || "2",
      customer: b?.name || "Maria Costa",
      address: b?.address || "45 Lakeshore",
      title: "Blow driveway again",
      description: "Customer reported clippings left on driveway.",
      status: "open",
      priority: "normal",
      assignedTo: "Admin",
    },
  ]);
}
export function getEmployeeProfile(): EmployeeProfile {
  return read<EmployeeProfile>(K.profile, {
    name: "Filipe",
    email: "filipe@damasioseasons.ca",
    phone: "",
    defaultAddress: "",
    photoLabel: "F",
    photoUrl: "",
    crew: "Crew A",
  });
}
export function saveEmployeeProfile(p: EmployeeProfile) {
  write(K.profile, p);
}
export function logoutEmployee() {
  addActivityLog(
    "Employee",
    "Logged out",
    "Field App",
    "Employee selected log out.",
  );
}

export function getSessions(): ServiceSession[] {
  return read<ServiceSession[]>(K.sess, []);
}
export function getSessionForLead(leadId: string): ServiceSession | null {
  return getSessions().find((s) => s.leadId === leadId) || null;
}
export function startServiceSession(
  leadId: string,
  employee = "Filipe",
  crew = "Crew A",
) {
  const existing = getSessionForLead(leadId);
  if (existing?.status === "running") return existing;
  if (existing?.status === "finished") return existing;
  const session = {
    id: existing?.id || createId(),
    leadId,
    startedAt: new Date().toISOString(),
    status: "running" as const,
    employee,
    crew,
  };
  write(K.sess, [session, ...getSessions().filter((s) => s.leadId !== leadId)]);
  addActivityLog(employee, "Started job", leadId, "Timer started manually from the Service Screen.");
  addWorkflowEvent({ entityType: "visit", entityId: leadId, fromStage: "assigned", toStage: "in_progress", actor: employee, note: "Employee started the house." });
  broadcastOperationsChange(`${leadId} service started.`);
  return session;
}
export function finishServiceSession(leadId: string, completionComment = "") {
  const now = new Date();
  let finished: ServiceSession | null = null;
  const current = getSessionForLead(leadId);
  if (!current || current.status !== "running" || !current.startedAt) {
    addActivityLog("System", "Blocked auto finish", leadId, "Finish ignored because no active manual timer was running.");
    return null;
  }
  write(
    K.sess,
    getSessions().map((s) => {
      if (s.leadId !== leadId) return s;
      const start = s.startedAt ? new Date(s.startedAt) : now;
      finished = {
        ...s,
        finishedAt: now.toISOString(),
        durationSeconds: Math.max(
          0,
          Math.round((now.getTime() - start.getTime()) / 1000),
        ),
        status: "finished",
        completionComment: completionComment.trim() || undefined,
      };
      return finished;
    }),
  );
  const lead = getLead(leadId);
  updateLeadStatus(leadId, "completed");
  if (lead?.serviceFrequency && lead.serviceFrequency !== "one_time" && lead.serviceFrequency !== "adaptive" && (lead.nextVisitDate || lead.scheduledDate)) {
    const next = recurringNextDate(lead.nextVisitDate || lead.scheduledDate || "", lead.serviceFrequency);
    updateLead(leadId, { nextVisitDate: next });
    addNotification("schedule", "Next cut updated", `${lead.service} next cut is ${formatLongDate(next)}.`);
  } else if (lead?.serviceFrequency === "adaptive" || lead?.serviceFrequency === "one_time") {
    addNotification("schedule", "Next visit pending", `${lead.service} has no automatic next visit. Admin will schedule it if needed.`);
  }
  addActivityLog(
    "Employee",
    "Finished job",
    leadId,
    `Duration: ${finished ? (finished as ServiceSession).durationSeconds || 0 : 0} seconds.${completionComment.trim() ? ` Comment: ${completionComment.trim()}` : ""}`,
  );
  addWorkflowEvent({ entityType: "visit", entityId: leadId, fromStage: "in_progress", toStage: "completed", actor: "Employee", note: completionComment.trim() || "Employee completed the house." });
  return finished;
}

export function saveServiceComment(leadId: string, comment: string) {
  const clean = comment.trim();
  if (!clean) return null;
  const existing = getSessionForLead(leadId);
  const session: ServiceSession = existing || {
    id: createId(),
    leadId,
    status: "not_started",
    employee: "Employee",
    crew: "Crew A",
  };
  const updated = { ...session, completionComment: clean };
  write(K.sess, [updated, ...getSessions().filter((s) => s.leadId !== leadId)]);
  addActivityLog(updated.employee || "Employee", "Saved comment", leadId, clean);
  broadcastOperationsChange(`Comment saved for ${leadId}.`);
  return updated;
}

export function skipServiceSession(
  leadId: string,
  comment = "",
  photos: string[] = [],
  employee = "Employee",
  crew = "Crew A",
) {
  const lead = getLead(leadId);
  if (!lead) return null;
  const existing = getSessionForLead(leadId);
  const now = new Date().toISOString();
  const startedAt = existing?.startedAt;
  const durationSeconds = startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))
    : existing?.durationSeconds || 0;
  const skipped: ServiceSession = {
    id: existing?.id || createId(),
    leadId,
    startedAt,
    durationSeconds,
    status: "skipped",
    employee: existing?.employee || employee,
    crew: existing?.crew || crew,
    skippedAt: now,
    skipComment: comment.trim() || undefined,
    skipPhotos: photos.slice(0, 5),
  };
  write(K.sess, [skipped, ...getSessions().filter((s) => s.leadId !== leadId)]);
  const openStatus: LeadStatus = lead.assignedCrew || lead.scheduledDate || lead.nextVisitDate ? "booked" : "quoted";
  updateLeadStatus(leadId, openStatus);
  addActivityLog(
    skipped.employee,
    "Skipped house",
    lead.name,
    `${comment.trim() || "No comment provided."}${photos.length ? ` Photos: ${Math.min(photos.length, 5)}.` : ""}`,
  );
  addNotification(
    "schedule",
    "House skipped — review required",
    `${lead.name} at ${lead.address} was skipped by ${skipped.employee}.${comment.trim() ? ` Comment: ${comment.trim()}` : ""}`,
  );
  addWorkflowEvent({
    entityType: "visit",
    entityId: leadId,
    fromStage: existing?.status === "running" ? "in_progress" : "assigned",
    toStage: "assigned",
    actor: skipped.employee,
    note: `House skipped and requires Admin/Dispatch review.${comment.trim() ? ` ${comment.trim()}` : ""}`,
  });
  broadcastOperationsChange(`${lead.name} skipped and marked for review.`);
  return skipped;
}

export function resetServiceSession(leadId: string) {
  const lead = getLead(leadId);
  write(
    K.sess,
    getSessions().filter((s) => s.leadId !== leadId),
  );
  if (lead) {
    const reopenedStatus: LeadStatus = lead.assignedCrew || lead.scheduledDate || lead.nextVisitDate ? "booked" : "quoted";
    updateLeadStatus(leadId, reopenedStatus);
    addActivityLog("Admin/Employee", "Reset house", lead.name, "Only this house was reset. Timer removed and status returned to Open across the whole system.");
    addNotification("schedule", "House reset", `${lead.name} is Open again. Route, Dispatch, Customer Portal and History use the same property record.`);
    broadcastOperationsChange(`${lead.name} reset to Open.`);
  }
}
export function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${h}:${m}:${s}`;
}
export function formatClock(iso?: string) {
  return iso
    ? new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
}

export function getExpenses(): Expense[] {
  return read<Expense[]>(K.expenses, []);
}
export function saveExpense(e: Expense) {
  write(K.expenses, [e, ...getExpenses()]);
}
export function clearExpenses() {
  if (typeof window !== "undefined") window.localStorage.removeItem(K.expenses);
}
export function getInvoices(): Invoice[] {
  return read<Invoice[]>(K.invoices, []);
}
function invoiceNumber() {
  return `INV-${new Date().getFullYear()}-${(getInvoices().length + 1).toString().padStart(6, "0")}`;
}
export function createInvoiceFromEstimate(estimateId: string) {
  const e = getEstimates().find((x) => x.id === estimateId);
  if (!e) return null;
  const existing = getInvoices().find((i) => i.estimateId === estimateId);
  if (existing) return existing;
  const inv: Invoice = {
    id: createId(),
    number: invoiceNumber(),
    createdAt: new Date().toISOString(),
    estimateId: e.id,
    requestId: e.requestId,
    customer: e.customer,
    service: e.title,
    subtotal: e.subtotal,
    tax: e.tax,
    total: e.total,
    status: "waiting_payment",
  };
  write(K.invoices, [inv, ...getInvoices()]);
  if (e.requestId) updateServiceRequest(e.requestId, { status: "accepted" });
  addActivityLog("System", "Created invoice", inv.number, `Created from ${e.number}.`);
  addNotification("payment", "Invoice waiting payment", `${inv.number} created for ${e.customer}.`);
  return inv;
}
export function createInvoiceFromLead(lead: Lead) {
  const existing = getInvoices().find((i) => i.leadId === lead.id);
  if (existing) return existing;
  const inv: Invoice = {
    id: createId(),
    number: invoiceNumber(),
    createdAt: new Date().toISOString(),
    leadId: lead.id,
    estimateId: lead.sourceEstimateId,
    customer: lead.name,
    service: lead.service,
    subtotal: lead.subtotal,
    tax: lead.tax,
    total: lead.total,
    status: lead.paymentStatus === "paid" ? "paid" : "waiting_payment",
    paymentMethod: lead.paymentMethod,
    paymentReference: lead.paymentReference,
    paymentRecordedAt: lead.paymentRecordedAt,
    paymentNotes: lead.paymentNote,
  };
  write(K.invoices, [inv, ...getInvoices()]);
  return inv;
}
export function getInvoiceForEstimate(estimateId: string) {
  return getInvoices().find((i) => i.estimateId === estimateId) || null;
}
export function getInvoiceForRequest(requestId: string) {
  return getInvoices().find((i) => i.requestId === requestId) || null;
}
export function updateInvoiceStatus(id: string, status: Invoice["status"], patch: Partial<Invoice> = {}) {
  write(
    K.invoices,
    getInvoices().map((i) => (i.id === id ? { ...i, ...patch, status } : i)),
  );
}
export function recordInvoicePayment(id: string, paymentMethod: PaymentMethod, status: Invoice["status"], notes?: string, reference?: string) {
  updateInvoiceStatus(id, status, {
    paymentMethod,
    paymentReference: reference,
    paymentNotes: notes,
    paymentRecordedAt: new Date().toISOString(),
  });
  const inv = getInvoices().find((i) => i.id === id);
  if (inv?.leadId) updateLeadPayment(inv.leadId, paymentMethod, status === "paid" ? "paid" : "processing", notes, reference);
  addActivityLog("Admin", "Recorded invoice payment", inv?.number || id, `${status} via ${paymentMethod}. ${notes || ""}`);
}
export function isEstimatePaid(estimateId?: string) {
  if (!estimateId) return false;
  return getInvoices().some((i) => i.estimateId === estimateId && i.status === "paid");
}
export function clearInvoices() {
  if (typeof window !== "undefined") window.localStorage.removeItem(K.invoices);
}
export function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}
export function getChecklists(): DailyChecklist[] {
  return read<DailyChecklist[]>(K.check, []);
}
export function hasChecklistToday(employee = "Employee") {
  return getChecklists().some(
    (c) => c.date === getTodayKey() && c.employee === employee,
  );
}
export function confirmDailyChecklist(
  employee: string,
  crew: string,
  items: string[],
) {
  const c = {
    id: createId(),
    date: getTodayKey(),
    employee,
    crew,
    items,
    confirmedAt: new Date().toISOString(),
  };
  write(K.check, [c, ...getChecklists()]);
  return c;
}
export function getNotifications(): Notification[] {
  return read<Notification[]>(K.noti, []);
}
export function addNotification(
  type: Notification["type"],
  title: string,
  message: string,
) {
  const n = {
    id: createId(),
    createdAt: new Date().toISOString(),
    title,
    message,
    type,
    read: false,
  };
  write(K.noti, [n, ...getNotifications()]);
}
export function markNotificationsRead() {
  write(
    K.noti,
    getNotifications().map((n) => ({ ...n, read: true })),
  );
}
export function getRecurrences(): Recurrence[] {
  return read<Recurrence[]>(K.rec, []);
}
export function saveRecurrence(input: Omit<Recurrence, "id">) {
  write(K.rec, [{ id: createId(), ...input }, ...getRecurrences()]);
}
export function toggleRecurrence(id: string) {
  write(
    K.rec,
    getRecurrences().map((r) =>
      r.id === id ? { ...r, active: !r.active } : r,
    ),
  );
}

export const DAMASIO_SYNC_EVENT = "damasio-os-sync";
export const DAMASIO_CREWS = [
  "Crew A",
  "Crew B",
  "Crew C",
  "Employee A",
  "Employee B",
  "Employee C",
];
export function getAssignableWorkers() {
  const profile = getEmployeeProfile();
  return Array.from(new Set([profile.name, ...DAMASIO_CREWS, "Admin"].filter(Boolean)));
}
export const DAMASIO_WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export function getRegionFromAddress(address: string) {
  const a = address.toLowerCase();
  if (a.includes("burlington") || a.includes("lakeshore")) return "Burlington";
  if (a.includes("oakville") || a.includes("trafalgar")) return "Oakville";
  if (a.includes("ancaster")) return "Ancaster";
  if (a.includes("stoney creek")) return "Stoney Creek";
  if (
    a.includes("upper") ||
    a.includes("mohawk") ||
    a.includes("fennell") ||
    a.includes("garth")
  )
    return "Hamilton Mountain";
  if (a.includes("hamilton") || a.includes("king") || a.includes("main"))
    return "Hamilton";
  return "Other";
}
export function nextVisitFor(
  dayName: string,
  frequency: ServiceFrequency = "weekly",
  from = new Date(),
) {
  if (frequency === "one_time") return from.toISOString().slice(0, 10);
  const target = DAMASIO_WEEK_DAYS.indexOf(dayName);
  const current = (from.getDay() + 6) % 7;
  let add = (target - current + 7) % 7;
  if (add === 0) add = frequency === "biweekly" ? 14 : 7;
  if (frequency === "monthly" && add < 21) add += 28;
  if (frequency === "adaptive") add = add || 7;
  const d = new Date(from);
  d.setDate(from.getDate() + add);
  return d.toISOString().slice(0, 10);
}
export function dayNameFromDate(dateKey: string) {
  return DAMASIO_WEEK_DAYS[(new Date(dateKey + "T12:00:00").getDay() + 6) % 7] || "Monday";
}
export function recurringNextDate(dateKey: string, frequency: ServiceFrequency = "weekly") {
  if (!dateKey) return "";
  if (frequency === "one_time" || frequency === "adaptive" || frequency === "seasonal") return dateKey;
  const d = new Date(dateKey + "T12:00:00");
  const days = frequency === "biweekly" ? 14 : frequency === "monthly" ? 28 : 7;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
export function getCustomerNextVisit() {
  const leads = getLeads();
  return (
    leads
      .filter((l) => l.status !== "completed" && !!(l.nextVisitDate || l.scheduledDate))
      .sort((a, b) => (a.nextVisitDate || a.scheduledDate || "9999").localeCompare(b.nextVisitDate || b.scheduledDate || "9999"))[0] ||
    leads
      .filter((l) => !!(l.nextVisitDate || l.scheduledDate))
      .sort((a, b) => (a.nextVisitDate || a.scheduledDate || "9999").localeCompare(b.nextVisitDate || b.scheduledDate || "9999"))[0] ||
    null
  );
}
export function getPendingReviewCount() {
  return getLeads().filter((l) => l.status === "completed" && (!l.feedback || !l.feedback.rating)).length;
}
export function broadcastOperationsChange(message: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    "damasio_os_last_sync",
    JSON.stringify({ message, at: new Date().toISOString() }),
  );
  window.dispatchEvent(
    new CustomEvent(DAMASIO_SYNC_EVENT, { detail: { message } }),
  );
}
export function assignHomesToCrew(
  ids: string[],
  crew: string,
  serviceDay: string,
  serviceFrequency: ServiceFrequency = "weekly",
  nextVisitDate?: string,
) {
  const next = nextVisitDate || nextVisitFor(serviceDay, serviceFrequency);
  setLeads(
    getLeads().map((l) =>
      ids.includes(l.id)
        ? {
            ...l,
            assignedCrew: crew,
            serviceDay,
            serviceFrequency,
            nextVisitDate: next,
            scheduledDate: next,
            status: "booked" as LeadStatus,
          }
        : l,
    ),
  );
  addActivityLog(
    "Admin",
    "Assigned homes",
    crew,
    `${ids.length} home(s) assigned to ${crew}.`,
  );
  addNotification(
    "schedule",
    "Route updated",
    `${ids.length} home(s) assigned to ${crew}.`,
  );
  broadcastOperationsChange(`${ids.length} home(s) assigned to ${crew}.`);
}
export function unassignHomes(ids: string[]) {
  setLeads(
    getLeads().map((l) =>
      ids.includes(l.id)
        ? {
            ...l,
            assignedCrew: undefined,
            serviceDay: undefined,
            serviceFrequency: undefined,
            nextVisitDate: undefined,
            scheduledDate: undefined,
            status: "quoted" as LeadStatus,
          }
        : l,
    ),
  );
  addActivityLog(
    "Admin",
    "Returned homes",
    "Unassigned",
    `${ids.length} home(s) returned to the main list.`,
  );
  addNotification(
    "schedule",
    "Route updated",
    `${ids.length} home(s) returned to unassigned.`,
  );
  broadcastOperationsChange(`${ids.length} home(s) returned to unassigned.`);
}
export function moveHomesToCrew(ids: string[], crew: string) {
  setLeads(
    getLeads().map((l) =>
      ids.includes(l.id)
        ? { ...l, assignedCrew: crew, status: "booked" as LeadStatus }
        : l,
    ),
  );
  addActivityLog(
    "Admin",
    "Moved homes",
    crew,
    `${ids.length} home(s) moved to ${crew}.`,
  );
  addNotification(
    "schedule",
    "Route changed",
    `${ids.length} home(s) moved to ${crew}.`,
  );
  broadcastOperationsChange(`${ids.length} home(s) moved to ${crew}.`);
}
export function updateHomeSchedule(
  id: string,
  serviceDay: string,
  serviceFrequency: ServiceFrequency = "weekly",
  nextVisitDate?: string,
) {
  const next = nextVisitDate || nextVisitFor(serviceDay, serviceFrequency);
  updateLead(id, {
    serviceDay,
    serviceFrequency,
    nextVisitDate: next,
    scheduledDate: next,
    status: "booked",
  });
  broadcastOperationsChange("Schedule updated.");
}
export function getTodaysAssignedJobs(crew?: string) {
  const today = DAMASIO_WEEK_DAYS[(new Date().getDay() + 6) % 7];
  return getLeads().filter(
    (l) =>
      l.assignedCrew &&
      (crew ? l.assignedCrew === crew : true) &&
      (l.serviceDay === today ||
        l.scheduledDate === getTodayKey() ||
        l.nextVisitDate === getTodayKey()),
  );
}

export function seedDemoLeads(force = false) {
  if(!allowDemoSeed())return;
  if (force && typeof window !== "undefined") {
    write(K.leads, []);
    write(K.tasks, []);
    write(K.sess, []);
    write(K.noti, []);
    write(K.logs, []);
    write(K.workflow, []);
  }
  const existingLeads = getLeads();
  if (existingLeads.length > 0) {
    const today = getTodayKey();
    const todayName = DAMASIO_WEEK_DAYS[(new Date().getDay() + 6) % 7];
    const demoRouteIds = new Set(Array.from({ length: 10 }, (_, index) => `DEMO-${String(index + 1).padStart(3, "0")}`));
    if (existingLeads.some(lead => demoRouteIds.has(lead.id))) {
      setLeads(existingLeads.map(lead => demoRouteIds.has(lead.id) ? {
        ...lead,
        status: lead.status === "completed" ? lead.status : "booked",
        assignedCrew: lead.assignedCrew || "Crew A",
        scheduledDate: today,
        nextVisitDate: today,
        serviceDay: todayName,
      } : lead));
    }
    return;
  }
  const now = new Date().toISOString();
  const routeDate = getTodayKey();
  const routeDay = DAMASIO_WEEK_DAYS[(new Date().getDay() + 6) % 7];
  const common = {
    scheduledDate: routeDate,
    scheduledWindow: "Flexible",
    assignedCrew: "Crew A",
    serviceDay: routeDay,
    serviceFrequency: "weekly" as ServiceFrequency,
    nextVisitDate: routeDate,
    paymentStatus: "pending" as PaymentStatus,
    paymentMethod: "etransfer" as PaymentMethod,
    photos: [] as string[],
  };
  setLeads([
    {
      id: "DEMO-001",
      createdAt: now,
      name: "Ethan Miller",
      phone: "905-555-0101",
      email: "ethan.miller@example.com",
      address: "123 King St E, Hamilton",
      service: "Fall Cleanup",
      status: "booked",
      subtotal: 120,
      tax: 15.6,
      total: 135.6,
      ...common,
      propertyDetails: { lawnSize: "small", grassHeight: "3in", grassHandling: "mulched", backyard: true, gated: false, adminNotes: "Front and backyard. Customer likes clean edges.", propertyAlerts: "Park on street, do not block driveway.", accessNotes: "Side gate on left." },
    },
    {
      id: "DEMO-002",
      createdAt: now,
      name: "Olivia Brown",
      phone: "905-555-0102",
      email: "olivia.brown@example.com",
      address: "48 Aberdeen Ave, Hamilton",
      service: "Weekly Lawn Care",
      status: "booked",
      subtotal: 72,
      tax: 9.36,
      total: 81.36,
      ...common,
      propertyDetails: { lawnSize: "xs", grassHeight: "2in", grassHandling: "mulched", backyard: true, gated: true, adminNotes: "Small yard, quick stop.", accessNotes: "Gate code 1122." },
    },
    {
      id: "DEMO-003",
      createdAt: now,
      name: "Lucas Wilson",
      phone: "905-555-0103",
      email: "lucas.wilson@example.com",
      address: "92 Locke St S, Hamilton",
      service: "Fall Cleanup",
      status: "booked",
      subtotal: 145,
      tax: 18.85,
      total: 163.85,
      ...common,
      propertyDetails: { lawnSize: "legacy", grassHeight: "4in", grassHandling: "bag_green_bin", backyard: true, gated: false, propertyAlerts: "Watch garden lights near front walkway.", accessNotes: "Green bin by garage." },
    },
    {
      id: "DEMO-004",
      createdAt: now,
      name: "Sophia Taylor",
      phone: "905-555-0104",
      email: "sophia.taylor@example.com",
      address: "17 Bay St S, Hamilton",
      service: "Weekly Lawn Care",
      status: "booked",
      subtotal: 82,
      tax: 10.66,
      total: 92.66,
      ...common,
      propertyDetails: { lawnSize: "small", grassHeight: "3in", grassHandling: "no_preference", backyard: false, gated: false, adminNotes: "Front only this week." },
    },
    {
      id: "DEMO-005",
      createdAt: now,
      name: "Noah Martin",
      phone: "905-555-0105",
      email: "noah.martin@example.com",
      address: "305 Main St W, Hamilton",
      service: "Fall Cleanup",
      status: "booked",
      subtotal: 190,
      tax: 24.7,
      total: 214.7,
      ...common,
      propertyDetails: { lawnSize: "oversize", grassHeight: "5in", grassHandling: "bag_leave_property", backyard: true, gated: true, propertyAlerts: "Large backyard. Bring bags.", accessNotes: "Wide gate behind driveway." },
    },
    {
      id: "DEMO-006",
      createdAt: now,
      name: "Emma Johnson",
      phone: "905-555-0106",
      email: "emma.johnson@example.com",
      address: "64 Dundurn St N, Hamilton",
      service: "Weekly Lawn Care",
      status: "booked",
      subtotal: 76,
      tax: 9.88,
      total: 85.88,
      ...common,
      propertyDetails: { lawnSize: "small", grassHeight: "3in", grassHandling: "mulched", backyard: true, gated: true, accessNotes: "Latch is tight; pull up before opening." },
    },
    {
      id: "DEMO-007",
      createdAt: now,
      name: "Liam Anderson",
      phone: "905-555-0107",
      email: "liam.anderson@example.com",
      address: "21 Sherman Ave S, Hamilton",
      service: "Garden Bed Cleanup",
      status: "booked",
      subtotal: 110,
      tax: 14.3,
      total: 124.3,
      ...common,
      propertyDetails: { lawnSize: "xs", grassHeight: "3in", grassHandling: "bag_green_bin", backyard: false, gated: false, adminNotes: "Focus front garden bed and blow walkway." },
    },
    {
      id: "DEMO-008",
      createdAt: now,
      name: "Ava Thompson",
      phone: "905-555-0108",
      email: "ava.thompson@example.com",
      address: "810 Upper James St, Hamilton",
      service: "Weekly Lawn Care",
      status: "booked",
      subtotal: 95,
      tax: 12.35,
      total: 107.35,
      ...common,
      propertyDetails: { lawnSize: "legacy", grassHeight: "4in", grassHandling: "mulched", backyard: true, gated: false, propertyAlerts: "Dog may be outside; knock first." },
    },
    {
      id: "DEMO-009",
      createdAt: now,
      name: "Mason Clark",
      phone: "905-555-0109",
      email: "mason.clark@example.com",
      address: "56 Gage Ave N, Hamilton",
      service: "Fall Cleanup",
      status: "booked",
      subtotal: 130,
      tax: 16.9,
      total: 146.9,
      ...common,
      propertyDetails: { lawnSize: "small", grassHeight: "3in", grassHandling: "bag_leave_property", backyard: true, gated: true, accessNotes: "Back gate from alley." },
    },
    {
      id: "DEMO-010",
      createdAt: now,
      name: "Isabella Garcia",
      phone: "905-555-0110",
      email: "isabella.garcia@example.com",
      address: "44 Brant St, Burlington",
      service: "Spring Cleanup",
      status: "booked",
      scheduledDate: routeDate,
      scheduledWindow: "Flexible",
      assignedCrew: "Crew A",
      serviceDay: routeDay,
      serviceFrequency: "biweekly",
      nextVisitDate: routeDate,
      subtotal: 160,
      tax: 20.8,
      total: 180.8,
      paymentStatus: "pending",
      paymentMethod: "etransfer",
      photos: [],
      propertyDetails: { lawnSize: "legacy", grassHeight: "4in", grassHandling: "bag_green_bin", backyard: true, gated: false, adminNotes: "Tenth assigned test customer." },
    },
    {
      id: "DEMO-011",
      createdAt: now,
      name: "Benjamin Davis",
      phone: "905-555-0111",
      email: "benjamin.davis@example.com",
      address: "77 Kerr St, Oakville",
      service: "Weekly Lawn Care",
      status: "new",
      subtotal: 88,
      tax: 11.44,
      total: 99.44,
      paymentStatus: "not_selected",
      photos: [],
      propertyDetails: { lawnSize: "small", grassHeight: "3in", grassHandling: "mulched", backyard: true, gated: true, adminNotes: "New fake customer for customer/property testing." },
    },
  ]);
  addActivityLog("System", force ? "Demo reset" : "Demo loaded", "Demo Data", "Fake customers, route houses and test jobs were created.");
}
export function seedDemoExpenses() {
  if(!allowDemoSeed())return;
  if (getExpenses().length > 0) return;
  write(K.expenses, [
    {
      id: "EXP-1",
      createdAt: new Date().toISOString(),
      date: "2026-06-01",
      vendor: "Shell",
      category: "fuel",
      amount: 84.25,
      notes: "Truck fuel",
    },
  ]);
}
export function seedDemoRecurrences() {
  if(!allowDemoSeed())return;
  if (getRecurrences().length > 0) return;
  write(K.rec, [
    {
      id: "REC-1",
      customer: "John Smith",
      service: "Weekly Lawn Care",
      address: "123 King St",
      frequency: "weekly",
      nextDate: "2026-07-06",
      active: true,
    },
  ]);
}

export type VisitStatus = "completed" | "booked" | "upcoming" | "overdue";
export function calculateVisitStatus(lead: Lead): VisitStatus {
  if (lead.status === "completed") return "completed";
  const today = getTodayKey();
  const next = lead.nextVisitDate || lead.scheduledDate;
  if (!next) return "upcoming";
  if (next < today) return "overdue";
  const diff = Math.ceil(
    (new Date(next + "T12:00:00").getTime() -
      new Date(today + "T12:00:00").getTime()) /
      86400000,
  );
  if (lead.assignedCrew) return "booked";
  return diff <= 3 ? "upcoming" : "booked";
}
export function simulateCustomerServiceComplete(id: string) {
  const lead = getLead(id);
  if (!lead) return;
  finishServiceSession(id, "Quick completed from employee route.");
  addNotification(
    "review",
    "Service completed",
    `${lead.service} completed for ${lead.name}. Customer feedback request is ready.`,
  );
  addActivityLog(
    "Employee",
    "Completed service",
    lead.name,
    `Completion recorded at ${new Date().toLocaleTimeString()}.`,
  );
  broadcastOperationsChange(`${lead.name} completed.`);
}
export function generateAiRouteDraft(crew: string, day: string) {
  const homes = getLeads().filter(
    (l) =>
      l.assignedCrew === crew &&
      l.serviceDay === day &&
      l.status !== "completed",
  );
  const sorted = [...homes].sort(
    (a, b) =>
      getRegionFromAddress(a.address).localeCompare(
        getRegionFromAddress(b.address),
      ) || a.address.localeCompare(b.address),
  );
  const key = `damasio_os_ai_route_draft_${crew}_${day}`;
  if (typeof window !== "undefined")
    window.localStorage.setItem(
      key,
      JSON.stringify({
        crew,
        day,
        ids: sorted.map((h) => h.id),
        createdAt: new Date().toISOString(),
        published: false,
      }),
    );
  addActivityLog(
    "AI Assistant",
    "Generated draft route",
    crew,
    `${sorted.length} home(s) sorted by region and address. Awaiting Admin approval.`,
  );
  return sorted;
}

export type EmployeeSmartRouteState = {
  crew: string;
  date: string;
  originalOrder: string[];
  appliedOrder: string[];
  originLabel: string;
  appliedAt: string;
  active: boolean;
};
function employeeSmartRouteKey(crew:string,date:string){return `damasio_os_employee_smart_route_${crew}_${date}`}
export function getEmployeeSmartRouteState(crew:string,date:string):EmployeeSmartRouteState|null{
  if(typeof window==="undefined")return null;
  try{return JSON.parse(window.localStorage.getItem(employeeSmartRouteKey(crew,date))||"null") as EmployeeSmartRouteState|null}catch{return null}
}
export function applyEmployeeSmartRoute(crew:string,date:string,originalOrder:string[],appliedOrder:string[],originLabel:string){
  const uniqueOriginal=[...new Set(originalOrder)];
  const allowed=new Set(uniqueOriginal);
  const safeApplied=[...new Set(appliedOrder.filter(id=>allowed.has(id)))];
  const finalOrder=[...safeApplied,...uniqueOriginal.filter(id=>!safeApplied.includes(id))];
  const positions=new Map(finalOrder.map((id,index)=>[id,index+1]));
  setLeads(getLeads().map(lead=>positions.has(lead.id)?{...lead,routeOrder:positions.get(lead.id)}:lead));
  const existing=getEmployeeSmartRouteState(crew,date);
  const state:EmployeeSmartRouteState={crew,date,originalOrder:existing?.active?existing.originalOrder:uniqueOriginal,appliedOrder:finalOrder,originLabel,appliedAt:new Date().toISOString(),active:true};
  if(typeof window!=="undefined")window.localStorage.setItem(employeeSmartRouteKey(crew,date),JSON.stringify(state));
  addActivityLog("Employee","Applied Smart Route",crew,`${safeApplied.length} pending stop(s) reordered for ${date}.`);
  broadcastOperationsChange(`Employee Smart Route applied for ${crew}.`);
  return state;
}
export function restoreEmployeeSmartRoute(crew:string,date:string){
  const state=getEmployeeSmartRouteState(crew,date);
  if(!state?.active)return false;
  const positions=new Map(state.originalOrder.map((id,index)=>[id,index+1]));
  setLeads(getLeads().map(lead=>positions.has(lead.id)?{...lead,routeOrder:positions.get(lead.id)}:lead));
  if(typeof window!=="undefined")window.localStorage.removeItem(employeeSmartRouteKey(crew,date));
  addActivityLog("Employee","Restored original route",crew,`Original route restored for ${date}.`);
  broadcastOperationsChange(`Original route restored for ${crew}.`);
  return true;
}

export function saveSmartRouteDraft(crew: string, day: string, orderedIds: string[]) {
  const key = `damasio_os_ai_route_draft_${crew}_${day}`;
  const routeHomes = getLeads().filter(lead => lead.assignedCrew === crew && lead.serviceDay === day);
  const allowed = new Set(routeHomes.map(lead => lead.id));
  const safeIds = [...new Set(orderedIds.filter(id => allowed.has(id)))];
  const ordered = safeIds.map(id => routeHomes.find(lead => lead.id === id)).filter(Boolean) as Lead[];
  let previousOrder = routeHomes.sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)).map(lead => lead.id);
  if (typeof window !== "undefined") {
    try {
      const existing = JSON.parse(window.localStorage.getItem(key) || "null") as { previousOrder?: string[] } | null;
      if (Array.isArray(existing?.previousOrder)) previousOrder = existing.previousOrder;
    } catch { /* replace an invalid draft safely */ }
    window.localStorage.setItem(key, JSON.stringify({ crew, day, ids: safeIds, previousOrder, createdAt: new Date().toISOString(), published: false }));
  }
  addActivityLog("Route Optimizer", "Generated driving-time draft", crew, `${ordered.length} mapped home(s) optimized. Awaiting Admin approval.`);
  return ordered;
}
export function publishAiRoute(crew: string, day: string) {
  const key = `damasio_os_ai_route_draft_${crew}_${day}`;
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(key);
  if (!raw) return;
  let draft: { ids: string[]; previousOrder?: string[] };
  try { draft = JSON.parse(raw) as { ids: string[]; previousOrder?: string[] }; }
  catch { window.localStorage.removeItem(key); return; }
  if (!Array.isArray(draft.ids)) { window.localStorage.removeItem(key); return; }
  const routeHomes = getLeads().filter(l => l.assignedCrew === crew && l.serviceDay === day);
  const allowed = new Set(routeHomes.map(l => l.id));
  const optimized = [...new Set(draft.ids.filter(id => allowed.has(id)))];
  const remaining = routeHomes.filter(l => !optimized.includes(l.id)).sort((a, b) => (a.routeOrder ?? 9999) - (b.routeOrder ?? 9999)).map(l => l.id);
  const publishedIds = [...optimized, ...remaining];
  const positions = new Map(publishedIds.map((id, index) => [id, index + 1]));
  setLeads(
    getLeads().map((l) =>
      positions.has(l.id)
        ? {
            ...l,
            assignedCrew: crew,
            serviceDay: day,
            status: "booked" as LeadStatus,
            routeOrder: positions.get(l.id),
          }
        : l,
    ),
  );
  window.localStorage.setItem(
    key,
    JSON.stringify({
      ...draft,
      ids: publishedIds,
      published: true,
      publishedAt: new Date().toISOString(),
    }),
  );
  addActivityLog(
    "Admin",
    "Published AI route",
    crew,
    `${publishedIds.length} home(s) published to Employee Dashboard.`,
  );
  broadcastOperationsChange(`Published route for ${crew}.`);
}
export function undoAiRoute(crew: string, day: string) {
  const key = `damasio_os_ai_route_draft_${crew}_${day}`;
  if (typeof window !== "undefined") {
    try {
      const draft = JSON.parse(window.localStorage.getItem(key) || "null") as { published?: boolean; previousOrder?: string[] } | null;
      if (draft?.published && Array.isArray(draft.previousOrder)) {
        const positions = new Map(draft.previousOrder.map((id, index) => [id, index + 1]));
        setLeads(getLeads().map(lead => lead.assignedCrew === crew && lead.serviceDay === day && positions.has(lead.id) ? { ...lead, routeOrder: positions.get(lead.id) } : lead));
      }
    } catch { /* an invalid draft can still be discarded */ }
    window.localStorage.removeItem(key);
  }
  addActivityLog(
    "Admin",
    "Undo AI route",
    crew,
    "AI draft was discarded. Manual route control restored.",
  );
  broadcastOperationsChange(`AI route undone for ${crew}.`);
}
