import {
  AGENT_STREAM_SNAPSHOT_MAX_CHARS,
  REMOTE_AGENT_STREAM_DELTA_MAX_CHARS,
  remoteAgentStreamDeltaCallbackBodySchema,
  remoteAgentStreamDeltaCallbackResponseSchema,
  remoteAgentStreamPartCallbackBodySchema,
} from "@openmeld/schemas";
import type {
  AgentStreamToolPart,
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamDeltaCallbackResponse,
  RemoteAgentStreamPartCallbackBody,
} from "@openmeld/schemas/types";
import {
  listRemoteAgentCallbackContexts,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
} from "../agent-core/callback-context";

const STREAM_STATE_PREFIX = "openmeld:remote-agent:stream:";
const STREAM_FLUSH_INTERVAL_MS = 100;
const STREAM_SENTENCE_BOUNDARY_MIN_MS = 60;
const STREAM_CHUNK_TARGET_CHARS = 200;
const STREAM_CALLBACK_MAX_ATTEMPTS = 2;
const STREAM_CALLBACK_RETRY_DELAY_MS = 40;
const SENTENCE_BOUNDARY_PATTERN = /(?:[.!?]\s|\n)$/u;

type RemoteAgentStreamState = {
  disabled: boolean;
  lastFlushedAtMs: number | null;
  pendingText: string;
  sequence: number;
  startedAtMs: number;
  streamId: string;
  submissionId: string;
  textSnapshot: string;
  v: 1;
};

type RemoteAgentTransientStreamState = {
  pendingKindOrder: RemoteAgentStreamDeltaKind[];
  pendingThinking: string;
  replaceTextSnapshotOnNextText: boolean;
  thinkingProjectionDisabled: boolean;
  thinkingSnapshot: string;
};

export type RemoteAgentStreamDeltaKind = "text" | "thinking";

type RemoteAgentStreamPublishInput = {
  context: RemoteAgentCallbackContext;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  observedAtMs: number;
  storage: RemoteAgentStorage;
};

type RemoteAgentStreamPushInput = RemoteAgentStreamPublishInput & {
  delta: string;
  kind: RemoteAgentStreamDeltaKind;
};

type RemoteAgentStreamPartPushInput = RemoteAgentStreamPublishInput & {
  part: AgentStreamToolPart;
};

type RemoteAgentStreamPublishResult =
  | { status: "buffered" | "disabled"; sequence: number; streamId: string }
  | {
      status: "published" | "dropped";
      sequence: number;
      streamId: string;
      contentKind: RemoteAgentStreamDeltaKind | "tool";
      deltaLength?: number;
      response?: RemoteAgentStreamDeltaCallbackResponse;
    };

type RemoteAgentStreamPublisherOptions = {
  sleep?: (delayMs: number) => Promise<void>;
};

export type RemoteAgentStreamPublisher = {
  close(input: {
    storage: RemoteAgentStorage;
    submissionId: string;
  }): Promise<void>;
  flush(
    input: RemoteAgentStreamPublishInput
  ): Promise<RemoteAgentStreamPublishResult>;
  push(
    input: RemoteAgentStreamPushInput
  ): Promise<RemoteAgentStreamPublishResult>;
  pushPart(
    input: RemoteAgentStreamPartPushInput
  ): Promise<RemoteAgentStreamPublishResult>;
};

export function buildRemoteAgentStreamDeltaCallbackBody(input: {
  context: RemoteAgentCallbackContext;
  delta: string;
  kind: RemoteAgentStreamDeltaKind;
  observedAtMs: number;
  sequence: number;
  snapshot: string;
}): RemoteAgentStreamDeltaCallbackBody {
  return remoteAgentStreamDeltaCallbackBodySchema.parse({
    agentProfileId: input.context.agentProfileId,
    bindingId: input.context.bindingId,
    dispatchId: input.context.dispatchId,
    idempotencyKey: input.context.idempotencyKey,
    delta: input.delta,
    organizationId: input.context.organizationId,
    kind: input.kind,
    observedAtMs: input.observedAtMs,
    sequence: input.sequence,
    snapshot: input.snapshot,
    source:
      input.kind === "thinking" ? "flue.thinking_delta" : "flue.text_delta",
    spaceId: input.context.spaceId,
    streamId: buildRemoteAgentStreamId(input.context.submissionId),
    submissionId: input.context.submissionId,
    triggerMessageId: input.context.triggerMessageId,
    v: 2,
  });
}

export function buildRemoteAgentStreamPartCallbackBody(input: {
  context: RemoteAgentCallbackContext;
  observedAtMs: number;
  part: AgentStreamToolPart;
  sequence: number;
}): RemoteAgentStreamPartCallbackBody {
  return remoteAgentStreamPartCallbackBodySchema.parse({
    agentProfileId: input.context.agentProfileId,
    bindingId: input.context.bindingId,
    dispatchId: input.context.dispatchId,
    idempotencyKey: input.context.idempotencyKey,
    observedAtMs: input.observedAtMs,
    organizationId: input.context.organizationId,
    part: input.part,
    sequence: input.sequence,
    source: "flue.tool",
    spaceId: input.context.spaceId,
    streamId: buildRemoteAgentStreamId(input.context.submissionId),
    submissionId: input.context.submissionId,
    triggerMessageId: input.context.triggerMessageId,
    v: 1,
  });
}

export function isRemoteAgentStreamEligible(
  context: RemoteAgentCallbackContext
): boolean {
  const source = context.turnEnvelope?.trigger.source;
  return (
    context.callbackStatus === "pending" &&
    (source === "space_wake" || source === "web_dm")
  );
}

export async function resolveRemoteAgentStreamContext(input: {
  storage: RemoteAgentStorage;
  submissionId: string;
}): Promise<RemoteAgentCallbackContext | null> {
  const contexts = await listRemoteAgentCallbackContexts(input.storage, [
    "pending",
  ]);
  return (
    contexts.find((context) => context.submissionId === input.submissionId) ??
    null
  );
}

export function createRemoteAgentStreamPublisher(
  options: RemoteAgentStreamPublisherOptions = {}
): RemoteAgentStreamPublisher {
  const states = new Map<string, RemoteAgentStreamState>();
  const transientStates = new Map<string, RemoteAgentTransientStreamState>();
  const workBySubmissionId = new Map<string, Promise<unknown>>();
  const sleep = options.sleep ?? sleepFor;

  const enqueue = <T>(
    submissionId: string,
    work: () => Promise<T>
  ): Promise<T> => {
    const previous = workBySubmissionId.get(submissionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    workBySubmissionId.set(submissionId, current);
    const cleanUp = (): void => {
      if (workBySubmissionId.get(submissionId) === current) {
        workBySubmissionId.delete(submissionId);
      }
    };
    return current.then(
      (value) => {
        cleanUp();
        return value;
      },
      (error: unknown) => {
        cleanUp();
        throw error;
      }
    );
  };

  const loadState = async (
    storage: RemoteAgentStorage,
    context: RemoteAgentCallbackContext,
    observedAtMs: number
  ): Promise<RemoteAgentStreamState> => {
    const cached = states.get(context.submissionId);
    if (cached) {
      return cached;
    }
    const persisted = await readRemoteAgentStreamState(
      storage,
      context.submissionId
    );
    const state =
      persisted ??
      createRemoteAgentStreamState(context.submissionId, observedAtMs);
    states.set(context.submissionId, state);
    return state;
  };

  const loadTransientState = (
    submissionId: string,
    state: RemoteAgentStreamState
  ): RemoteAgentTransientStreamState => {
    const cached = transientStates.get(submissionId);
    if (cached) {
      return cached;
    }
    const transientState: RemoteAgentTransientStreamState = {
      pendingKindOrder: state.pendingText.length > 0 ? ["text"] : [],
      pendingThinking: "",
      replaceTextSnapshotOnNextText:
        state.textSnapshot.length > 0 || state.pendingText.length > 0,
      thinkingProjectionDisabled: false,
      thinkingSnapshot: "",
    };
    transientStates.set(submissionId, transientState);
    return transientState;
  };

  const publish = async (
    input: RemoteAgentStreamPublishInput,
    state: RemoteAgentStreamState,
    transientState: RemoteAgentTransientStreamState,
    kind: RemoteAgentStreamDeltaKind
  ): Promise<RemoteAgentStreamPublishResult> => {
    const pendingDelta =
      kind === "thinking" ? transientState.pendingThinking : state.pendingText;
    if (state.disabled) {
      return {
        status: "disabled",
        sequence: state.sequence,
        streamId: state.streamId,
      };
    }
    if (kind === "thinking" && transientState.thinkingProjectionDisabled) {
      return {
        contentKind: "thinking",
        deltaLength: pendingDelta.length,
        status: "dropped",
        sequence: state.sequence,
        streamId: state.streamId,
      };
    }
    if (pendingDelta.length === 0) {
      return {
        status: "buffered",
        sequence: state.sequence,
        streamId: state.streamId,
      };
    }

    const currentSnapshot =
      kind === "thinking"
        ? transientState.thinkingSnapshot
        : state.textSnapshot;
    const snapshot = currentSnapshot + pendingDelta;
    if (
      pendingDelta.length > REMOTE_AGENT_STREAM_DELTA_MAX_CHARS ||
      snapshot.length > AGENT_STREAM_SNAPSHOT_MAX_CHARS
    ) {
      return handleRemoteAgentStreamLimitExceeded({
        kind,
        pendingDelta,
        state,
        storage: input.storage,
        transientState,
      });
    }

    if (kind === "thinking") {
      transientState.pendingThinking = "";
      transientState.thinkingSnapshot = snapshot;
    } else {
      state.pendingText = "";
      state.textSnapshot = snapshot;
    }
    transientState.pendingKindOrder = transientState.pendingKindOrder.filter(
      (pendingKind) => pendingKind !== kind
    );
    state.sequence += 1;
    state.lastFlushedAtMs = input.observedAtMs;
    await persistRemoteAgentStreamState(input.storage, state);

    const body = buildRemoteAgentStreamDeltaCallbackBody({
      context: input.context,
      delta: pendingDelta,
      kind,
      observedAtMs: input.observedAtMs,
      sequence: state.sequence,
      snapshot,
    });
    const response = await deliverRemoteAgentStreamDelta({
      body,
      coreWorker: input.coreWorker,
      sleep,
    });
    if (!response) {
      return {
        contentKind: kind,
        deltaLength: pendingDelta.length,
        status: "dropped",
        sequence: state.sequence,
        streamId: state.streamId,
      };
    }

    state.sequence = Math.max(state.sequence, response.lastSequence);
    if (response.status === "rejected") {
      state.disabled = true;
    }
    await persistRemoteAgentStreamState(input.storage, state);
    return {
      contentKind: kind,
      deltaLength: pendingDelta.length,
      status: "published",
      sequence: state.sequence,
      streamId: state.streamId,
      response,
    };
  };

  const publishPending = async (
    input: RemoteAgentStreamPublishInput,
    state: RemoteAgentStreamState,
    transientState: RemoteAgentTransientStreamState
  ): Promise<RemoteAgentStreamPublishResult> => {
    let result: RemoteAgentStreamPublishResult = {
      status: state.disabled ? "disabled" : "buffered",
      sequence: state.sequence,
      streamId: state.streamId,
    };
    while (transientState.pendingKindOrder.length > 0 && !state.disabled) {
      const kind = transientState.pendingKindOrder[0];
      if (!kind) {
        break;
      }
      result = await publish(input, state, transientState, kind);
    }
    return result;
  };

  return {
    close: ({ storage, submissionId }) =>
      enqueue(submissionId, async () => {
        states.delete(submissionId);
        transientStates.delete(submissionId);
        await storage.delete(buildRemoteAgentStreamStateKey(submissionId));
      }),
    flush: (input) =>
      enqueue(input.context.submissionId, async () => {
        const state = await loadState(
          input.storage,
          input.context,
          input.observedAtMs
        );
        return publishPending(
          input,
          state,
          loadTransientState(input.context.submissionId, state)
        );
      }),
    push: (input) =>
      enqueue(input.context.submissionId, async () => {
        const state = await loadState(
          input.storage,
          input.context,
          input.observedAtMs
        );
        const transientState = loadTransientState(
          input.context.submissionId,
          state
        );
        if (state.disabled || input.delta.length === 0) {
          return {
            status: state.disabled ? "disabled" : "buffered",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }
        if (
          input.kind === "thinking" &&
          transientState.thinkingProjectionDisabled
        ) {
          return {
            contentKind: "thinking",
            deltaLength: input.delta.length,
            status: "dropped",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }

        replaceRecoveredRemoteAgentTextSnapshotIfNeeded({
          kind: input.kind,
          state,
          transientState,
        });
        appendPendingRemoteAgentStreamDelta({
          delta: input.delta,
          kind: input.kind,
          state,
          transientState,
        });
        const nextKind = transientState.pendingKindOrder[0];
        if (!nextKind) {
          return {
            status: "buffered",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }
        const pendingDelta = readPendingRemoteAgentStreamDelta({
          kind: nextKind,
          state,
          transientState,
        });
        if (
          !shouldFlushRemoteAgentStream(state, input.observedAtMs, pendingDelta)
        ) {
          return {
            status: "buffered",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }
        return publish(input, state, transientState, nextKind);
      }),
    pushPart: (input) =>
      enqueue(input.context.submissionId, async () => {
        const state = await loadState(
          input.storage,
          input.context,
          input.observedAtMs
        );
        const pendingResult = await publishPending(
          input,
          state,
          loadTransientState(input.context.submissionId, state)
        );
        if (state.disabled) {
          return pendingResult;
        }

        state.sequence += 1;
        state.lastFlushedAtMs = input.observedAtMs;
        await persistRemoteAgentStreamState(input.storage, state);
        const body = buildRemoteAgentStreamPartCallbackBody({
          context: input.context,
          observedAtMs: input.observedAtMs,
          part: input.part,
          sequence: state.sequence,
        });
        const response = await deliverRemoteAgentStreamPart({
          body,
          coreWorker: input.coreWorker,
          sleep,
        });
        if (!response) {
          return {
            contentKind: "tool",
            status: "dropped",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }

        state.sequence = Math.max(state.sequence, response.lastSequence);
        if (response.status === "rejected") {
          state.disabled = true;
        }
        await persistRemoteAgentStreamState(input.storage, state);
        return {
          contentKind: "tool",
          status: "published",
          sequence: state.sequence,
          streamId: state.streamId,
          response,
        };
      }),
  };
}

function replaceRecoveredRemoteAgentTextSnapshotIfNeeded(input: {
  kind: RemoteAgentStreamDeltaKind;
  state: RemoteAgentStreamState;
  transientState: RemoteAgentTransientStreamState;
}): void {
  if (
    input.kind !== "text" ||
    !input.transientState.replaceTextSnapshotOnNextText
  ) {
    return;
  }
  input.state.pendingText = "";
  input.state.textSnapshot = "";
  input.transientState.pendingKindOrder =
    input.transientState.pendingKindOrder.filter(
      (pendingKind) => pendingKind !== "text"
    );
  input.transientState.replaceTextSnapshotOnNextText = false;
}

function appendPendingRemoteAgentStreamDelta(input: {
  delta: string;
  kind: RemoteAgentStreamDeltaKind;
  state: RemoteAgentStreamState;
  transientState: RemoteAgentTransientStreamState;
}): void {
  if (input.kind === "thinking") {
    if (input.transientState.thinkingProjectionDisabled) {
      return;
    }
    if (input.transientState.pendingThinking.length === 0) {
      input.transientState.pendingKindOrder.push(input.kind);
    }
    input.transientState.pendingThinking += input.delta;
    return;
  }
  if (input.state.pendingText.length === 0) {
    input.transientState.pendingKindOrder.push(input.kind);
  }
  input.state.pendingText += input.delta;
}

function disableRemoteAgentThinkingProjection(
  transientState: RemoteAgentTransientStreamState
): void {
  transientState.pendingKindOrder = transientState.pendingKindOrder.filter(
    (kind) => kind !== "thinking"
  );
  transientState.pendingThinking = "";
  transientState.thinkingProjectionDisabled = true;
  transientState.thinkingSnapshot = "";
}

async function handleRemoteAgentStreamLimitExceeded(input: {
  kind: RemoteAgentStreamDeltaKind;
  pendingDelta: string;
  state: RemoteAgentStreamState;
  storage: RemoteAgentStorage;
  transientState: RemoteAgentTransientStreamState;
}): Promise<RemoteAgentStreamPublishResult> {
  if (input.kind === "thinking") {
    disableRemoteAgentThinkingProjection(input.transientState);
    return {
      contentKind: "thinking",
      deltaLength: input.pendingDelta.length,
      status: "dropped",
      sequence: input.state.sequence,
      streamId: input.state.streamId,
    };
  }

  input.state.disabled = true;
  input.state.pendingText = "";
  input.transientState.pendingKindOrder = [];
  input.transientState.pendingThinking = "";
  await persistRemoteAgentStreamState(input.storage, input.state);
  return {
    status: "disabled",
    sequence: input.state.sequence,
    streamId: input.state.streamId,
  };
}

function readPendingRemoteAgentStreamDelta(input: {
  kind: RemoteAgentStreamDeltaKind;
  state: RemoteAgentStreamState;
  transientState: RemoteAgentTransientStreamState;
}): string {
  return input.kind === "thinking"
    ? input.transientState.pendingThinking
    : input.state.pendingText;
}

function buildRemoteAgentStreamId(submissionId: string): string {
  return `stream:${submissionId}`;
}

function buildRemoteAgentStreamStateKey(submissionId: string): string {
  return `${STREAM_STATE_PREFIX}${submissionId}`;
}

function createRemoteAgentStreamState(
  submissionId: string,
  observedAtMs: number
): RemoteAgentStreamState {
  return {
    disabled: false,
    lastFlushedAtMs: null,
    pendingText: "",
    sequence: 0,
    startedAtMs: observedAtMs,
    streamId: buildRemoteAgentStreamId(submissionId),
    submissionId,
    textSnapshot: "",
    v: 1,
  };
}

function shouldFlushRemoteAgentStream(
  state: RemoteAgentStreamState,
  observedAtMs: number,
  pendingDelta: string
): boolean {
  const elapsedMs = observedAtMs - (state.lastFlushedAtMs ?? state.startedAtMs);
  if (state.lastFlushedAtMs !== null && elapsedMs < STREAM_FLUSH_INTERVAL_MS) {
    return false;
  }
  return (
    elapsedMs >= STREAM_FLUSH_INTERVAL_MS ||
    pendingDelta.length >= STREAM_CHUNK_TARGET_CHARS ||
    (elapsedMs >= STREAM_SENTENCE_BOUNDARY_MIN_MS &&
      SENTENCE_BOUNDARY_PATTERN.test(pendingDelta))
  );
}

async function deliverRemoteAgentStreamDelta(input: {
  body: RemoteAgentStreamDeltaCallbackBody;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  sleep: (delayMs: number) => Promise<void>;
}): Promise<RemoteAgentStreamDeltaCallbackResponse | null> {
  const submit = input.coreWorker?.submitRemoteAgentStreamDelta;
  if (!submit) {
    return null;
  }

  for (let attempt = 1; attempt <= STREAM_CALLBACK_MAX_ATTEMPTS; attempt += 1) {
    let retryDelayMs = STREAM_CALLBACK_RETRY_DELAY_MS;
    try {
      const response = remoteAgentStreamDeltaCallbackResponseSchema.parse(
        await submit(input.body)
      );
      if (response.status !== "retryable") {
        return response;
      }
      if (attempt === STREAM_CALLBACK_MAX_ATTEMPTS) {
        return null;
      }
      retryDelayMs = Math.max(
        retryDelayMs,
        response.retryAfterMs ?? retryDelayMs
      );
    } catch {
      if (attempt === STREAM_CALLBACK_MAX_ATTEMPTS) {
        return null;
      }
    }
    await input.sleep(retryDelayMs);
  }
  return null;
}

async function deliverRemoteAgentStreamPart(input: {
  body: RemoteAgentStreamPartCallbackBody;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  sleep: (delayMs: number) => Promise<void>;
}): Promise<RemoteAgentStreamDeltaCallbackResponse | null> {
  const submit = input.coreWorker?.submitRemoteAgentStreamPart;
  if (!submit) {
    return null;
  }

  for (let attempt = 1; attempt <= STREAM_CALLBACK_MAX_ATTEMPTS; attempt += 1) {
    let retryDelayMs = STREAM_CALLBACK_RETRY_DELAY_MS;
    try {
      const response = await submitRemoteAgentStreamPartWithCompatibility({
        body: input.body,
        submit,
      });
      if (response.status !== "retryable") {
        return response;
      }
      if (attempt === STREAM_CALLBACK_MAX_ATTEMPTS) {
        return null;
      }
      retryDelayMs = Math.max(
        retryDelayMs,
        response.retryAfterMs ?? retryDelayMs
      );
    } catch {
      if (attempt === STREAM_CALLBACK_MAX_ATTEMPTS) {
        return null;
      }
    }
    await input.sleep(retryDelayMs);
  }
  return null;
}

async function submitRemoteAgentStreamPartWithCompatibility(input: {
  body: RemoteAgentStreamPartCallbackBody;
  submit: NonNullable<
    RemoteAgentCoreWorkerBinding["submitRemoteAgentStreamPart"]
  >;
}): Promise<RemoteAgentStreamDeltaCallbackResponse> {
  const response = remoteAgentStreamDeltaCallbackResponseSchema.parse(
    await input.submit(input.body)
  );
  if (
    response.status !== "rejected" ||
    response.reasonCode !== "agent_stream.invalid"
  ) {
    return response;
  }
  const compatibilityBody = buildOlderCoreCompatibleStreamPartBody(input.body);
  return compatibilityBody
    ? remoteAgentStreamDeltaCallbackResponseSchema.parse(
        await input.submit(compatibilityBody)
      )
    : response;
}

function buildOlderCoreCompatibleStreamPartBody(
  body: RemoteAgentStreamPartCallbackBody
): RemoteAgentStreamPartCallbackBody | null {
  const work = body.part.work;
  if (
    !work?.subject ||
    work.subject.kind !== "connected_app" ||
    !(
      work.key === "connected_app.action.execute" ||
      work.key === "connected_app.actions.read"
    )
  ) {
    return null;
  }
  return remoteAgentStreamPartCallbackBodySchema.parse({
    ...body,
    part: {
      type: body.part.type,
      toolCallId: body.part.toolCallId,
      toolName: body.part.toolName,
      state: body.part.state,
    },
  });
}

async function readRemoteAgentStreamState(
  storage: RemoteAgentStorage,
  submissionId: string
): Promise<RemoteAgentStreamState | null> {
  const records = await storage.list<RemoteAgentStreamState>({
    prefix: buildRemoteAgentStreamStateKey(submissionId),
  });
  const state = records.get(buildRemoteAgentStreamStateKey(submissionId));
  return isRemoteAgentStreamState(state) ? state : null;
}

async function persistRemoteAgentStreamState(
  storage: RemoteAgentStorage,
  state: RemoteAgentStreamState
): Promise<void> {
  await storage.put(buildRemoteAgentStreamStateKey(state.submissionId), state);
}

function isRemoteAgentStreamState(
  value: unknown
): value is RemoteAgentStreamState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const state = value as Partial<RemoteAgentStreamState>;
  return (
    state.v === 1 &&
    typeof state.submissionId === "string" &&
    typeof state.streamId === "string" &&
    typeof state.sequence === "number" &&
    typeof state.textSnapshot === "string" &&
    typeof state.pendingText === "string" &&
    typeof state.startedAtMs === "number" &&
    (state.lastFlushedAtMs === null ||
      typeof state.lastFlushedAtMs === "number") &&
    typeof state.disabled === "boolean"
  );
}

function sleepFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
