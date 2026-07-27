export type VisitExecutionStatus = "scheduled" | "in_progress" | "completed" | "missed" | "cancelled" | string;

export type NormalizedVisitExecutionState = {
  status: VisitExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  durationSeconds?: number;
  valid: boolean;
  issue?: string;
};

type Input = {
  status?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
};

function duration(value?: number | null) {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : undefined;
}

export function normalizeVisitExecutionState(input: Input): NormalizedVisitExecutionState {
  const status = input.status || "scheduled";
  const startedAt = input.startedAt || undefined;
  const finishedAt = input.finishedAt || undefined;
  const durationSeconds = duration(input.durationSeconds);

  if (status === "scheduled" || status === "cancelled") {
    const valid = !startedAt && !finishedAt && durationSeconds === undefined;
    return {
      status,
      valid,
      issue: valid ? undefined : `${status} Visit contained stale execution timestamps.`,
    };
  }

  if (status === "in_progress") {
    const valid = Boolean(startedAt) && !finishedAt && durationSeconds === undefined;
    return {
      status,
      startedAt,
      valid,
      issue: valid ? undefined : "Active Visit must have only a start timestamp.",
    };
  }

  if (status === "completed") {
    const valid = Boolean(startedAt && finishedAt) && durationSeconds !== undefined;
    return {
      status,
      startedAt,
      finishedAt,
      durationSeconds,
      valid,
      issue: valid ? undefined : "Completed Visit requires start, finish and duration.",
    };
  }

  if (status === "missed") {
    const valid = input.durationSeconds == null || durationSeconds !== undefined;
    return {
      status,
      startedAt,
      finishedAt,
      durationSeconds,
      valid,
      issue: valid ? undefined : "Missed Visit contained an invalid duration.",
    };
  }

  return {
    status,
    startedAt,
    finishedAt,
    durationSeconds,
    valid: true,
  };
}
