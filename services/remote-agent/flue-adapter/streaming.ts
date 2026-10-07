import {
  AGENT_STREAM_SNAPSHOT_MAX_CHARS,
  REMOTE_AGENT_STREAM_DELTA_MAX_CHARS,
  remoteAgentStreamDeltaCallbackBodySchema,
  remoteAgentStreamDeltaCallbackResponseSchema,
  remoteAgentStreamPartCallbackBodySchema,
} from "@openmeld/schemas";
import type {
  AgentStreamPart,
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
// CardKit is an external publication path, unlike the Web live projection.
// Coalesce full snapshots below its per-card limit and avoid per-token D1 writes.
const MESSAGE_CHANNEL_STREAM_FLUSH_INTERVAL_MS = 350;
const STREAM_CALLBACK_MAX_ATTEMPTS = 2;
const STREAM_CALLBACK_RETRY_DELAY_MS = 40;

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
  content: Record<
    "progress" | "thinking",
    { pending: string; snapshot: string }
  >;
  progressUnsupported: boolean;
  replaceTextSnapshotOnNextText: boolean;
};

export type RemoteAgentStreamDeltaKind = "text" | "progress" | "thinking";

type RemoteAgentStreamPublishInput = {
  context: RemoteAgentCallbackContext;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  observedAtMs: number;
  storage: RemoteAgentStorage;
};

type RemoteAgentStreamPushInput = RemoteAgentStreamPublishInput & {
  delta: string;
  kind: RemoteAgentStreamDeltaKind;
  replaceTextPrefix?: string;
};

type RemoteAgentStreamPartPushInput = RemoteAgentStreamPublishInput & {
  part: AgentStreamPart;
};

type RemoteAgentStreamPublishResult =
  | { status: "buffered" | "disabled"; sequence: number; streamId: string }
  | {
      status: "published" | "dropped";
      sequence: number;
      streamId: string;
      contentKind: RemoteAgentStreamDeltaKind | AgentStreamPart["type"];
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
    source: {
      progress: "hosted.public_progress",
      thinking: "flue.thinking_delta",
      text: "flue.text_delta",
    }[input.kind],
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
  part: AgentStreamPart;
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
    source:
      input.part.type === "recovery" ? "flue.model_recovery" : "flue.tool",
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
  const environment = context.turnEnvelope?.interactionEnvironment;
  // Continuations also target external conversations. Only admit the explicit
  // Space audience here; Core still validates the persisted delivery identity.
  const isSpaceContinuation =
    (source === "task_continuation" || source === "task_watch_continuation") &&
    (environment === "organization_shared" ||
      environment === "requester_private");
  return (
    context.callbackStatus === "pending" &&
    !context.replyRecovery &&
    (source === "space_wake" ||
      source === "web_dm" ||
      source === "message_channel" ||
      isSpaceContinuation)
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
      content: {
        progress: { pending: "", snapshot: "" },
        thinking: { pending: "", snapshot: "" },
      },
      progressUnsupported: false,
      replaceTextSnapshotOnNextText:
        state.textSnapshot.length > 0 || state.pendingText.length > 0,
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
    const pendingDelta = readPendingRemoteAgentStreamDelta({
      kind,
      state,
      transientState,
    });
    const earlyResult = resolveRemoteAgentStreamEarlyResult({
      kind,
      pendingDelta,
      state,
      transientState,
    });
    if (earlyResult) {
      return earlyResult;
    }

    const currentSnapshot = readRemoteAgentStreamSnapshot({
      kind,
      state,
      transientState,
    });
    const snapshot =
      kind !== "text"
        ? (currentSnapshot + pendingDelta).slice(
            -AGENT_STREAM_SNAPSHOT_MAX_CHARS
          )
        : currentSnapshot + pendingDelta;
    if (
      pendingDelta.length > REMOTE_AGENT_STREAM_DELTA_MAX_CHARS ||
      snapshot.length > AGENT_STREAM_SNAPSHOT_MAX_CHARS
    ) {
      return handleRemoteAgentStreamLimitExceeded({
        kind,
        state,
        storage: input.storage,
        transientState,
      });
    }

    if (kind !== "text") {
      transientState.content[kind].pending = "";
      transientState.content[kind].snapshot = snapshot;
    } else {
      state.pendingText = "";
      state.textSnapshot = snapshot;
    }
    transientState.pendingKindOrder = transientState.pendingKindOrder.filter(
      (pendingKind) => pendingKind !== kind
    );
    const previousSequence = state.sequence;
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

    if (
      kind === "progress" &&
      response.status === "rejected" &&
      response.reasonCode === "agent_stream.invalid"
    ) {
      // An older Core rejects this new callback kind before touching its
      // stream cursor. Keep the last accepted sequence and the text preview.
      state.sequence = previousSequence;
      transientState.content.progress = { pending: "", snapshot: "" };
      transientState.progressUnsupported = true;
      await persistRemoteAgentStreamState(input.storage, state);
      return {
        contentKind: kind,
        deltaLength: pendingDelta.length,
        status: "dropped",
        sequence: state.sequence,
        streamId: state.streamId,
        response,
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
      if (result.status === "buffered") {
        break;
      }
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
        if (input.kind === "progress" && transientState.progressUnsupported) {
          return {
            contentKind: "progress",
            status: "dropped",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }
        if (state.disabled || input.delta.length === 0) {
          return {
            status: state.disabled ? "disabled" : "buffered",
            sequence: state.sequence,
            streamId: state.streamId,
          };
        }

        const replacingFailedText = prepareRemoteAgentStreamPush({
          input,
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
        if (
          !(
            replacingFailedText ||
            shouldFlushRemoteAgentStream(
              state,
              input.observedAtMs,
              input.context
            )
          )
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
            contentKind: input.part.type,
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
          contentKind: input.part.type,
          status: "published",
          sequence: state.sequence,
          streamId: state.streamId,
          response,
        };
      }),
  };
}

function prepareRemoteAgentStreamPush(input: {
  input: RemoteAgentStreamPushInput;
  state: RemoteAgentStreamState;
  transientState: RemoteAgentTransientStreamState;
}): boolean {
  const replacementPrefix =
    input.input.kind === "text" ? input.input.replaceTextPrefix : undefined;
  if (replacementPrefix === undefined) {
    replaceRecoveredRemoteAgentTextSnapshotIfNeeded({
      kind: input.input.kind,
      state: input.state,
      transientState: input.transientState,
    });
    return false;
  }
  // Flue supplies the official visible-text projection, not a guessed string
  // prefix. Drop buffered failed text and retain legitimate earlier narration.
  input.state.pendingText = "";
  input.state.textSnapshot = replacementPrefix;
  input.transientState.replaceTextSnapshotOnNextText = false;
  input.transientState.pendingKindOrder =
    input.transientState.pendingKindOrder.filter((kind) => kind !== "text");
  return true;
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
  if (input.kind !== "text") {
    const content = input.transientState.content[input.kind];
    if (content.pending.length === 0) {
      input.transientState.pendingKindOrder.push(input.kind);
    }
    content.pending = (content.pending + input.delta).slice(
      -REMOTE_AGENT_STREAM_DELTA_MAX_CHARS
    );
    return;
  }
  if (input.state.pendingText.length === 0) {
    input.transientState.pendingKindOrder.push(input.kind);
  }
  input.state.pendingText += input.delta;
}

async function handleRemoteAgentStreamLimitExceeded(input: {
  kind: RemoteAgentStreamDeltaKind;
  state: RemoteAgentStreamState;
  storage: RemoteAgentStorage;
  transientState: RemoteAgentTransientStreamState;
}): Promise<RemoteAgentStreamPublishResult> {
  input.state.disabled = true;
  input.state.pendingText = "";
  input.transientState.pendingKindOrder = [];
  input.transientState.content.progress.pending = "";
  input.transientState.content.thinking.pending = "";
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
  return input.kind !== "text"
    ? input.transientState.content[input.kind].pending
    : input.state.pendingText;
}

function readRemoteAgentStreamSnapshot(input: {
  kind: RemoteAgentStreamDeltaKind;
  state: RemoteAgentStreamState;
  transientState: RemoteAgentTransientStreamState;
}): string {
  return input.kind !== "text"
    ? input.transientState.content[input.kind].snapshot
    : input.state.textSnapshot;
}

function resolveRemoteAgentStreamEarlyResult(input: {
  kind: RemoteAgentStreamDeltaKind;
  pendingDelta: string;
  state: RemoteAgentStreamState;
  transientState: RemoteAgentTransientStreamState;
}): RemoteAgentStreamPublishResult | null {
  if (input.state.disabled) {
    return {
      status: "disabled",
      sequence: input.state.sequence,
      streamId: input.state.streamId,
    };
  }
  if (input.pendingDelta.length === 0) {
    return {
      status: "buffered",
      sequence: input.state.sequence,
      streamId: input.state.streamId,
    };
  }
  return null;
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
  context: RemoteAgentCallbackContext
): boolean {
  // A short answer may arrive in one delta. Send the first words immediately;
  // coalesce later snapshots and flush the tail at the model-message boundary.
  if (state.lastFlushedAtMs === null) {
    return true;
  }
  const intervalMs =
    context.turnEnvelope?.trigger.source === "message_channel"
      ? MESSAGE_CHANNEL_STREAM_FLUSH_INTERVAL_MS
      : STREAM_FLUSH_INTERVAL_MS;
  return observedAtMs - state.lastFlushedAtMs >= intervalMs;
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
