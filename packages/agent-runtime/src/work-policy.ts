// Shared Agent Profile work-capacity policy.
//
// Design: developing/architecture/local-agent-concurrency-design.md
// ("One Scheduler, Three Reservations" / "Limits and how to change them").
// Core, Service validation, and projections must read these bounds from here;
// clients must not keep separately editable defaults.
//
// The reservation ceiling is per Profile. Context, resource, and Controller
// constraints may admit fewer concurrent executions.

export const AGENT_PROFILE_WORK_CONCURRENCY_LIMIT = 3 as const;
// The previous candidate admitted five. Readers retain that accepted work while
// new reservations obey the current policy; a downgrade must not discard it.
export const AGENT_PROFILE_WORK_READABLE_RESERVATION_LIMIT = 5 as const;
export const AGENT_PROFILE_WORK_MAX_WAITING = 50 as const;

export type AgentProfileWorkCapacityPolicy = {
  readonly concurrencyLimit: number;
  readonly maxWaiting: number;
};

export const DEFAULT_AGENT_PROFILE_WORK_CAPACITY_POLICY: AgentProfileWorkCapacityPolicy =
  Object.freeze({
    concurrencyLimit: AGENT_PROFILE_WORK_CONCURRENCY_LIMIT,
    maxWaiting: AGENT_PROFILE_WORK_MAX_WAITING,
  });

export const isAgentProfileWorkCapacityPolicy = (
  value: unknown
): value is AgentProfileWorkCapacityPolicy => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Number.isInteger(candidate.concurrencyLimit) &&
    (candidate.concurrencyLimit as number) >= 1 &&
    Number.isInteger(candidate.maxWaiting) &&
    (candidate.maxWaiting as number) >= 0
  );
};
