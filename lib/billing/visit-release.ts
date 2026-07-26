export type VisitBillingState =
  | "awaiting_feedback"
  | "task_hold"
  | "release_pending"
  | "charge_processing"
  | "charged"
  | "charge_failed"
  | "transfer_pending"
  | "transferred"
  | "refund_pending"
  | "refunded"
  | "cancelled";

export type ReleaseDecisionInput = {
  now: Date;
  visitCompletedAt: Date;
  feedbackWindowHours: number;
  activeTaskId?: string | null;
  taskResolvedAt?: Date | null;
  reopenedFeedbackDeadlineAt?: Date | null;
  paymentAlreadyCreated?: boolean;
};

export type ReleaseDecision = {
  state: "awaiting_feedback" | "task_hold" | "release_pending" | "charge_processing";
  eligibleToChargeAt: Date | null;
  reason:
    | "active_task"
    | "feedback_window_open"
    | "resolution_window_open"
    | "ready_to_charge"
    | "payment_already_created";
};

const HOUR_MS = 60 * 60 * 1000;

export function feedbackDeadline(completedAt: Date, hours: number): Date {
  return new Date(completedAt.getTime() + hours * HOUR_MS);
}

/**
 * Pure state decision used by API, scheduler, and webhook reconciliation.
 * It never talks to Stripe and therefore cannot create duplicate charges.
 */
export function decideVisitBillingRelease(input: ReleaseDecisionInput): ReleaseDecision {
  if (input.paymentAlreadyCreated) {
    return {
      state: "charge_processing",
      eligibleToChargeAt: null,
      reason: "payment_already_created",
    };
  }

  if (input.activeTaskId && !input.taskResolvedAt) {
    return {
      state: "task_hold",
      eligibleToChargeAt: null,
      reason: "active_task",
    };
  }

  const initialDeadline = feedbackDeadline(
    input.visitCompletedAt,
    input.feedbackWindowHours,
  );

  const applicableDeadline = input.reopenedFeedbackDeadlineAt ?? initialDeadline;

  if (input.now.getTime() < applicableDeadline.getTime()) {
    return {
      state: "awaiting_feedback",
      eligibleToChargeAt: applicableDeadline,
      reason: input.reopenedFeedbackDeadlineAt
        ? "resolution_window_open"
        : "feedback_window_open",
    };
  }

  return {
    state: "release_pending",
    eligibleToChargeAt: applicableDeadline,
    reason: "ready_to_charge",
  };
}

export function visitChargeIdempotencyKey(visitId: string): string {
  return `visit:${visitId}:customer-charge:v1`;
}

export function visitTransferIdempotencyKey(visitId: string): string {
  return `visit:${visitId}:provider-transfer:v1`;
}
