import type { AgentSteeringSource } from "@flue/runtime";
import { remoteAgentWorkerExecutionInputRequestSchema } from "@openmeld/schemas";
import type {
  RemoteAgentWorkerExecutionInputQuery,
  RemoteAgentWorkerExecutionInputRequest,
  RemoteAgentWorkerExecutionInputResponse,
} from "@openmeld/schemas/types";
import {
  type RemoteAgentCallbackContext,
  type RemoteAgentStorage,
  waitForRemoteAgentCallbackContext,
} from "../agent-core/callback-context";
import { readRemoteAgentExecutionState } from "../agent-core/execution-state";
import { buildRemoteAgentName } from "../agent-core/submission";

const PREFIX = "openmeld:remote-agent:execution-input:";
const SEQUENCE_KEY = "openmeld:remote-agent:execution-input-sequence";
type Record = {
  request: RemoteAgentWorkerExecutionInputRequest;
  receivedAtMs: number;
  sequence: number;
  appliedAtMs: number | null;
};

function sameTarget(
  left: RemoteAgentWorkerExecutionInputQuery["target"],
  right: RemoteAgentWorkerExecutionInputQuery["target"]
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.spaceId === right.spaceId &&
    left.submissionId === right.submissionId &&
    left.idempotencyKey === right.idempotencyKey &&
    buildRemoteAgentName(left) === buildRemoteAgentName(right)
  );
}

async function targetAcceptsInput(
  storage: RemoteAgentStorage,
  target: RemoteAgentWorkerExecutionInputQuery["target"]
): Promise<boolean> {
  const state = await readRemoteAgentExecutionState({
    storage,
    identity: target,
  });
  return (
    state.status === "found" &&
    (state.execution.status === "pending" ||
      state.execution.status === "running")
  );
}

async function nextSequence(storage: RemoteAgentStorage): Promise<number> {
  for (;;) {
    const previous = await storage.get<number>(SEQUENCE_KEY);
    if (previous === undefined) {
      if (await storage.putIfAbsent(SEQUENCE_KEY, 1)) {
        return 1;
      }
    } else if (
      await storage.compareAndSet(SEQUENCE_KEY, previous, previous + 1)
    ) {
      return previous + 1;
    }
  }
}

export async function receiveRemoteAgentExecutionInput(input: {
  request: RemoteAgentWorkerExecutionInputRequest;
  storage: RemoteAgentStorage;
  nowMs: number;
}): Promise<RemoteAgentWorkerExecutionInputResponse> {
  const request = remoteAgentWorkerExecutionInputRequestSchema.parse(
    input.request
  );
  const context = await waitForRemoteAgentCallbackContext({
    storage: input.storage,
    submissionId: request.target.submissionId,
    waitMs: 0,
  });
  const sender = context?.turnEnvelope?.sender;
  if (!(context && sameTarget({ ...context, v: 1 }, request.target))) {
    return { status: "rejected", reason: "target_unavailable" };
  }
  if (
    sender?.kind !== "member" ||
    !sender.verified ||
    sender.profileId !== request.authorProfileId ||
    context.turnEnvelope?.space.kind !== "dm" ||
    !context.turnEnvelope.space.isCenterAgentDm
  ) {
    return { status: "rejected", reason: "authority_mismatch" };
  }
  const key = `${PREFIX}${request.inputId}`;
  const existing = await input.storage.get<Record>(key);
  if (existing) {
    return replayInput(input.storage, request, existing);
  }
  if (!(await targetAcceptsInput(input.storage, request.target))) {
    return { status: "rejected", reason: "target_unavailable" };
  }
  const record: Record = {
    request,
    receivedAtMs: input.nowMs,
    appliedAtMs: null,
    sequence: await nextSequence(input.storage),
  };
  if (!(await input.storage.putIfAbsent(key, record))) {
    const raced = await input.storage.get<Record>(key);
    if (!raced) {
      throw new Error("Execution input disappeared during admission.");
    }
    return replayInput(input.storage, request, raced);
  }
  return readRemoteAgentExecutionInput({
    storage: input.storage,
    query: request,
  });
}

function replayInput(
  storage: RemoteAgentStorage,
  request: RemoteAgentWorkerExecutionInputRequest,
  record: Record
): Promise<RemoteAgentWorkerExecutionInputResponse> {
  if (
    !sameTarget(record.request.target, request.target) ||
    record.request.authorProfileId !== request.authorProfileId ||
    record.request.sourceSignalId !== request.sourceSignalId ||
    record.request.text !== request.text
  ) {
    return Promise.resolve({ status: "rejected", reason: "input_conflict" });
  }
  return readRemoteAgentExecutionInput({ storage, query: request });
}

export async function readRemoteAgentExecutionInput(input: {
  storage: RemoteAgentStorage;
  query: RemoteAgentWorkerExecutionInputQuery;
}): Promise<RemoteAgentWorkerExecutionInputResponse> {
  const record = await input.storage.get<Record>(
    `${PREFIX}${input.query.inputId}`
  );
  if (!record) {
    return { status: "not_found" };
  }
  if (!sameTarget(record.request.target, input.query.target)) {
    return { status: "rejected", reason: "input_conflict" };
  }
  let status: "received" | "applied" | "unconfirmed" = "applied";
  if (record.appliedAtMs === null) {
    status = (await targetAcceptsInput(input.storage, input.query.target))
      ? "received"
      : "unconfirmed";
  }
  return {
    status,
    receipt: {
      inputId: record.request.inputId,
      target: record.request.target,
      receivedAtMs: record.receivedAtMs,
      appliedAtMs: record.appliedAtMs,
    },
  };
}

export function createRemoteAgentSteeringSource(input: {
  context: RemoteAgentCallbackContext;
  storage: RemoteAgentStorage;
}): AgentSteeringSource {
  const list = async () =>
    [...(await input.storage.list<Record>({ prefix: PREFIX })).values()]
      .filter(
        (record) =>
          record.request.target.submissionId === input.context.submissionId
      )
      .sort((left, right) => left.sequence - right.sequence);
  const convert = (record: Record) => ({
    targetSubmissionId: input.context.submissionId,
    status:
      record.appliedAtMs === null ? ("joining" as const) : ("joined" as const),
    input: {
      kind: "dispatch" as const,
      submissionId: `openmeld-input:${record.request.inputId}`,
      agent: "center-agent-v2",
      id: buildRemoteAgentName(input.context),
      acceptedAt: new Date(record.receivedAtMs).toISOString(),
      message: { kind: "user" as const, body: record.request.text },
    },
  });
  return {
    claim: async () =>
      (await list())
        .filter((record) => record.appliedAtMs === null)
        .map(convert),
    listUnresolved: async () => (await list()).map(convert),
    finalize: async (id) => {
      if (!id.startsWith("openmeld-input:")) {
        throw new Error("Unknown execution input identity.");
      }
      const key = `${PREFIX}${id.slice("openmeld-input:".length)}`;
      const record = await input.storage.get<Record>(key);
      if (
        !record ||
        record.request.target.submissionId !== input.context.submissionId
      ) {
        throw new Error(
          "Execution input does not belong to its canonical writer."
        );
      }
      if (record.appliedAtMs !== null) {
        return;
      }
      if (
        !(await input.storage.compareAndSet(key, record, {
          ...record,
          appliedAtMs: Date.now(),
        }))
      ) {
        throw new Error(
          "Execution input acknowledgement changed concurrently."
        );
      }
    },
    // A missing canonical entry remains accepted for the next model boundary.
    revert: () => Promise.resolve(),
  };
}
