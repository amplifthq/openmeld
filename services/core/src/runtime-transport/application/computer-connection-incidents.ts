import type { DaemonServiceLane } from "@openmeld/schemas/types";
import {
  type ComputerConnectionIncident,
  projectComputerConnectionInbox,
  readInboxComputerIdentity,
} from "../../computers/computer-connection-inbox";
import {
  compareRuntimeTransportSessionsByFreshness,
  LEASE_TTL_MS,
} from "./runtime-transport-session-service";
import type { RuntimeTransportSessionState } from "./runtime-transport-state";

const RECORD_PREFIX = "computer-connection-inbox.v1.";
const PENDING_PREFIX = "computer-connection-inbox-pending.v1.";
const RETRY_MS = 15_000;
type RecordState = {
  v: 1;
  ownerUserId: string;
  deviceId: string;
  computerId: string;
  lane: DaemonServiceLane;
  registrationKey: string;
  expectedUntilMs: number | null;
  incident: ComputerConnectionIncident | null;
};
type Observation = Pick<
  RuntimeTransportSessionState,
  | "ownerUserId"
  | "deviceId"
  | "lane"
  | "lastHeartbeatMs"
  | "acceptingDispatches"
  | "stopCause"
> & { available: boolean; registrationKey: string };
type Pending = {
  incident: ComputerConnectionIncident;
  nextAttemptAtMs: number;
};

/** A notification source inside the transport owner, not another liveness or Wake authority. */
export function createComputerConnectionIncidents(input: {
  storage: DurableObjectStorage;
  db: D1Database;
  nowMs?: () => number;
}) {
  const now = input.nowMs ?? Date.now;
  let tail: Promise<unknown> = Promise.resolve();

  async function reconcile(
    observations: Map<string, Observation>,
    observedAtMs: number
  ) {
    const stored = await input.storage.list<RecordState>({
      prefix: RECORD_PREFIX,
    });
    for (const [key, observation] of observations) {
      const previous = stored.get(key);
      if (
        !observation.available ||
        previous?.registrationKey === observation.registrationKey
      ) {
        continue;
      }
      const computer = await readInboxComputerIdentity(
        input.db,
        observation.ownerUserId,
        observation.deviceId
      );
      if (computer) {
        stored.set(
          key,
          previous?.computerId === computer.computerId
            ? { ...previous, registrationKey: observation.registrationKey }
            : {
                v: 1,
                ownerUserId: observation.ownerUserId,
                deviceId: observation.deviceId,
                registrationKey: observation.registrationKey,
                computerId: computer.computerId,
                lane: observation.lane,
                expectedUntilMs: null,
                incident: null,
              }
        );
      }
    }
    await input.storage.transaction(async (transaction) => {
      for (const [key, previous] of stored) {
        if (previous.v !== 1) {
          throw new Error("Unsupported Computer incident record");
        }
        const next = advanceComputerIncident(
          previous,
          observations.get(key),
          observedAtMs
        );
        await transaction.put(key, next);
        if (next.incident && next.incident !== previous.incident) {
          await transaction.put(
            `${PENDING_PREFIX}${next.incident.target.incidentId}`,
            {
              incident: next.incident,
              nextAttemptAtMs: observedAtMs,
            } satisfies Pending
          );
        }
      }
    });
    await flushPending();
  }

  async function flushPending() {
    // Finite retry slice. Pending terminal facts survive another outage and restart.
    const pending = await input.storage.list<Pending>({
      prefix: PENDING_PREFIX,
    });
    const due = [...pending]
      .filter(([, value]) => value.nextAttemptAtMs <= now())
      .sort(
        ([, left], [, right]) => left.nextAttemptAtMs - right.nextAttemptAtMs
      )
      .slice(0, 32);
    for (const [key, value] of due) {
      try {
        await projectComputerConnectionInbox(input.db, value.incident);
        await input.storage.delete(key);
      } catch (error) {
        await input.storage.put(key, {
          ...value,
          nextAttemptAtMs: now() + RETRY_MS,
        });
        console.warn("[core.computer_connection.inbox_projection_failed]", {
          incidentId: value.incident.target.incidentId,
          error,
        });
      }
    }
  }

  return {
    observe(sessions: Iterable<RuntimeTransportSessionState>): Promise<void> {
      const observedAtMs = now();
      const observations = new Map<string, Observation>();
      for (const session of [...sessions].sort(
        compareRuntimeTransportSessionsByFreshness
      )) {
        const key = `${RECORD_PREFIX}${JSON.stringify([session.deviceId, session.lane])}`;
        if (observations.has(key)) {
          continue;
        }
        observations.set(key, {
          registrationKey: `${session.daemonSessionId}:${session.connectionGeneration}`,
          ownerUserId: session.ownerUserId,
          deviceId: session.deviceId,
          lane: session.lane,
          lastHeartbeatMs: session.lastHeartbeatMs,
          acceptingDispatches: session.acceptingDispatches,
          stopCause: session.stopCause,
          available:
            Boolean(session.socket) &&
            session.acceptingDispatches === true &&
            session.executionCompatibility.status === "compatible" &&
            observedAtMs - session.lastHeartbeatMs <= LEASE_TTL_MS,
        });
      }
      const work = tail
        .catch(() => undefined)
        .then(() => reconcile(observations, observedAtMs));
      tail = work;
      return work;
    },
    async nextAlarmAtMs(): Promise<number | null> {
      await tail.catch(() => undefined);
      const records = await input.storage.list<RecordState>({
        prefix: RECORD_PREFIX,
      });
      const pending = await input.storage.list<Pending>({
        prefix: PENDING_PREFIX,
      });
      const deadlines = [...records.values()].flatMap((record) =>
        record.expectedUntilMs === null ||
        record.incident?.target.state === "disconnected"
          ? []
          : [record.expectedUntilMs]
      );
      deadlines.push(
        ...[...pending.values()].map((value) => value.nextAttemptAtMs)
      );
      return deadlines.length ? Math.min(...deadlines) : null;
    },
  };
}

function advanceComputerIncident(
  previous: RecordState,
  observation: Observation | undefined,
  nowMs: number
): RecordState {
  if (observation && observation.ownerUserId !== previous.ownerUserId) {
    throw new Error("Computer incident account mismatch");
  }
  if (observation?.available) {
    return {
      ...previous,
      expectedUntilMs: observation.lastHeartbeatMs + LEASE_TTL_MS + 1,
      incident: endIncident(previous.incident, "restored", nowMs),
    };
  }
  if (
    observation?.stopCause === "user_stop" ||
    observation?.stopCause === "controlled_service_update"
  ) {
    return {
      ...previous,
      expectedUntilMs: null,
      incident: endIncident(previous.incident, "deactivated", nowMs),
    };
  }
  if (observation?.stopCause === "unknown") {
    return { ...previous, expectedUntilMs: null };
  }
  // Initial registration is not availability. A replacement may use the same
  // liveness grace, but cannot create an expected connection on its own.
  const until = previous.expectedUntilMs;
  if (until === null || previous.incident?.target.state === "disconnected") {
    return previous;
  }
  const deadline = Math.max(
    until,
    observation ? observation.lastHeartbeatMs + LEASE_TTL_MS + 1 : until
  );
  if (nowMs < deadline) {
    return { ...previous, expectedUntilMs: deadline };
  }
  return {
    ...previous,
    expectedUntilMs: deadline,
    incident: {
      ownerUserId: previous.ownerUserId,
      openedAtMs: deadline,
      changedAtMs: nowMs,
      target: {
        kind: "computer_connection",
        deviceId: previous.deviceId,
        computerId: previous.computerId,
        lane: previous.lane,
        incidentId: crypto.randomUUID(),
        state: "disconnected",
      },
    },
  };
}

function endIncident(
  incident: ComputerConnectionIncident | null,
  state: "restored" | "deactivated",
  nowMs: number
) {
  return incident?.target.state === "disconnected"
    ? { ...incident, target: { ...incident.target, state }, changedAtMs: nowMs }
    : incident;
}
