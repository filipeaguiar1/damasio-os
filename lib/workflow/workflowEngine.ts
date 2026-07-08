export type WorkflowStage =
  | "lead"
  | "quote"
  | "approved"
  | "scheduled"
  | "assigned"
  | "in_progress"
  | "completed"
  | "feedback"
  | "task"
  | "archived";

export type WorkflowEntityType = "lead" | "quote" | "job" | "visit" | "task" | "property";

export type WorkflowEvent = {
  id: string;
  createdAt: string;
  entityType: WorkflowEntityType;
  entityId: string;
  fromStage?: WorkflowStage;
  toStage: WorkflowStage;
  actor: string;
  note: string;
};

export type WorkflowSnapshot = {
  stage: WorkflowStage;
  label: string;
  nextAction: string;
  isActive: boolean;
};

export function workflowLabel(stage: WorkflowStage) {
  const labels: Record<WorkflowStage, string> = {
    lead: "Lead",
    quote: "Quote",
    approved: "Approved",
    scheduled: "Scheduled",
    assigned: "Assigned",
    in_progress: "In Progress",
    completed: "Completed",
    feedback: "Feedback",
    task: "Task",
    archived: "Archived",
  };
  return labels[stage];
}

export function workflowNextAction(stage: WorkflowStage) {
  const next: Record<WorkflowStage, string> = {
    lead: "Create quote",
    quote: "Send or approve quote",
    approved: "Create job",
    scheduled: "Assign route",
    assigned: "Start job",
    in_progress: "Finish job",
    completed: "Wait for feedback or archive",
    feedback: "Review feedback",
    task: "Resolve task",
    archived: "No action needed",
  };
  return next[stage];
}

export function createWorkflowEvent(input: Omit<WorkflowEvent, "id" | "createdAt">): WorkflowEvent {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return {
    id,
    createdAt: new Date().toISOString(),
    ...input,
  };
}

export function getWorkflowSnapshot(stage: WorkflowStage): WorkflowSnapshot {
  return {
    stage,
    label: workflowLabel(stage),
    nextAction: workflowNextAction(stage),
    isActive: !["completed", "archived"].includes(stage),
  };
}

export function stageFromOperationalState(input: {
  leadStatus?: string;
  quoteStatus?: string;
  visitStatus?: string;
  hasFeedback?: boolean;
  hasOpenTask?: boolean;
  assignedCrew?: string;
  scheduledDate?: string;
  nextVisitDate?: string;
}): WorkflowStage {
  if (input.hasOpenTask) return "task";
  if (input.hasFeedback) return "feedback";
  if (input.visitStatus === "completed" || input.leadStatus === "completed") return "completed";
  if (input.visitStatus === "in_progress") return "in_progress";
  if (input.assignedCrew) return "assigned";
  if (input.scheduledDate || input.nextVisitDate || input.visitStatus === "scheduled") return "scheduled";
  if (input.quoteStatus === "approved" || input.leadStatus === "booked") return "approved";
  if (input.quoteStatus || input.leadStatus === "quoted") return "quote";
  return "lead";
}

export function groupWorkflowEventsByEntity(events: WorkflowEvent[]) {
  return events.reduce<Record<string, WorkflowEvent[]>>((groups, event) => {
    const key = `${event.entityType}:${event.entityId}`;
    groups[key] = groups[key] || [];
    groups[key].push(event);
    return groups;
  }, {});
}
