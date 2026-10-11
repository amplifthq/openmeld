import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { PermissionRuleset, SessionInfo, V2Event } from "@opencode/client";
import {
  type AdapterInstructionPrompt,
  type AdapterInteractionCallback,
  type AdapterPreviewCallback,
  type AdapterRuntimeEventCallback,
  type ConversationPolicy,
  isDispatchSpaceActionDeliveryOnly,
  readAdapterAiUsageObservation,
  resolveAdapterToolActivityName,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";
import { classifyOpenCodeFailureMessage } from "./opencode-failure.js";
import {
  answerOpenCode2Form,
  answerOpenCode2Permission,
} from "./opencode2-interactions.js";
import { type OpenCode2Client, openCode2Error } from "./opencode2-server.js";

export type OpenCode2TurnInput = {
  client: OpenCode2Client;
  directory: string;
  env?: Record<string, string | undefined>;
  sessionId: string | null;
  prompt: string;
  instructionPrompt?: AdapterInstructionPrompt;
  conversationPolicy?: ConversationPolicy;
  onInteractionRequest?: AdapterInteractionCallback;
  onPreview?: AdapterPreviewCallback;
  onRuntimeEvent?: AdapterRuntimeEventCallback;
  streamingMode?: "stream" | "final";
  signal: AbortSignal;
};

export async function runOpenCode2Turn(input: OpenCode2TurnInput) {
  const { client, signal } = input;
  // V1's --pure/tool inventory contract does not exist in V2. Never run a
  // correction with ordinary tools or change the original session's policy.
  if (isDispatchSpaceActionDeliveryOnly(input.env)) {
    throw openCode2Error(
      "delivery_scope.unsupported",
      "OpenCode 2 cannot yet attest an exclusive reply-repair tool scope."
    );
  }
  const session = await prepareSession(input);
  const eventsAbort = new AbortController();
  const eventSignal = AbortSignal.any([signal, eventsAbort.signal]);
  const ready = Promise.withResolvers<void>();
  const done = Promise.withResolvers<void>();
  ready.promise.catch(() => undefined);
  done.promise.catch(() => undefined);
  const state: TurnState = {
    sessionId: session.id,
    sessions: new Set([session.id]),
    tools: new Map(),
    delivered: new Set(),
    assistantMessages: new Set(),
    started: false,
    receiptId: null,
    admissionReported: false,
    output: "",
    previewEmitted: false,
  };
  const events = (async () => {
    for await (const event of client.event.subscribe({ signal: eventSignal })) {
      if (event.type === "server.connected") {
        ready.resolve();
        continue;
      }
      if (await observeEvent(input, state, event, eventSignal)) {
        done.resolve();
        return;
      }
    }
    throw openCode2Error(
      "protocol.stream_closed",
      "OpenCode closed the event stream."
    );
  })().catch((error) => {
    ready.reject(error);
    done.reject(error);
  });
  try {
    await Promise.race([
      ready.promise,
      new Promise<never>((_resolve, reject) => {
        const startup = AbortSignal.timeout(5000);
        startup.addEventListener(
          "abort",
          () =>
            reject(
              openCode2Error(
                "protocol.timeout",
                "OpenCode did not confirm its event subscription."
              )
            ),
          { once: true }
        );
      }),
    ]);
    const receipt = await client.session.prompt(
      {
        sessionID: session.id,
        text: input.instructionPrompt?.userPrompt ?? input.prompt,
      },
      { signal }
    );
    state.receiptId = receipt.id;
    await reportOpenCode2Admission(input, state);
    await done.promise;
    if (!state.delivered.has(receipt.id)) {
      throw openCode2Error(
        "protocol.receipt_missing",
        "OpenCode ended an execution without confirming delivery of this prompt."
      );
    }
    // Final text comes from this turn's completed native assistant messages.
    const messages = await client.message.list(
      { sessionID: session.id, type: "assistant", order: "desc", limit: 100 },
      { signal }
    );
    const latest = messages.data.find(
      (message) =>
        message.type === "assistant" && state.assistantMessages.has(message.id)
    );
    const aiUsage = messages.data.flatMap((message) => {
      if (
        message.type !== "assistant" ||
        !state.assistantMessages.has(message.id) ||
        !message.tokens ||
        !message.time.completed
      ) {
        return [];
      }
      const tokens = message.tokens;
      const inputTokens = tokens.input + tokens.cache.read + tokens.cache.write;
      const outputTokens = tokens.output + tokens.reasoning;
      const observation = readAdapterAiUsageObservation({
        eventId: `opencode:${session.id}:${message.id}`,
        provider: message.model.providerID,
        model: message.model.id,
        source: "opencode_message",
        occurredAtMs: message.time.completed,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          cacheRead: tokens.cache.read,
          cacheWrite: tokens.cache.write,
          reasoning: tokens.reasoning,
          total: inputTokens + outputTokens,
        },
        cost:
          typeof message.cost === "number"
            ? {
                nanoUsd: Math.round(message.cost * 1_000_000_000),
                kind: "provider_estimate",
              }
            : null,
      });
      return observation ? [observation] : [];
    });
    if (latest?.type === "assistant") {
      state.output = latest.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
    }
    if (input.onPreview && input.streamingMode !== "stream" && state.output) {
      await input.onPreview({ text: state.output });
      state.previewEmitted = true;
    }
    return {
      sessionId: session.id,
      output: state.output,
      previewEmitted: state.previewEmitted,
      aiUsage,
    };
  } finally {
    eventsAbort.abort();
    await events;
  }
}

export async function assertOpenCode2Directory(
  session: SessionInfo,
  directory: string
) {
  if (
    (await realpath(session.location.directory)) !== (await realpath(directory))
  ) {
    throw openCode2Error(
      "context.directory_mismatch",
      "The OpenCode session belongs to a different working folder."
    );
  }
}

export function readOpenCode2Permissions(
  value: string | undefined
): PermissionRuleset | undefined {
  if (!value) {
    return;
  }
  const raw: unknown = JSON.parse(value);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw openCode2Error(
      "permission.invalid",
      "OpenCode permission settings must be an object."
    );
  }
  const rules: PermissionRuleset = [];
  for (const [name, setting] of Object.entries(raw)) {
    const action =
      (
        {
          bash: "shell",
          task: "subagent",
          write: "edit",
          patch: "edit",
        } as Record<string, string>
      )[name] ?? name;
    const entries = permissionEntries(setting);
    if (!entries.length) {
      throw openCode2Error(
        "permission.invalid",
        "OpenCode permission settings are invalid."
      );
    }
    for (const [resource, effect] of entries) {
      if (effect !== "ask" && effect !== "allow" && effect !== "deny") {
        throw openCode2Error(
          "permission.invalid",
          "OpenCode permission effects are invalid."
        );
      }
      rules.push({ action, resource, effect });
    }
  }
  return rules;
}

async function prepareSession(input: OpenCode2TurnInput) {
  const { client, signal } = input;
  const location = { directory: await realpath(input.directory) };
  const spaceAction = resolveDispatchSpaceActionMcpServer(input.env);
  if (spaceAction) {
    // This native endpoint changes only this server's in-memory MCP registry;
    // it does not write project/global config (verified across server restart).
    await client.mcp.add(
      {
        location,
        server: spaceAction.id,
        config: {
          type: "local",
          command: [spaceAction.commandPath, ...spaceAction.args],
          environment: spaceAction.env,
          codemode: false,
        },
      },
      { signal }
    );
    await client.mcp.connect({ location, server: spaceAction.id }, { signal });
    await waitForSpaceActionMcp(client, location, spaceAction.id, signal);
    // OpenCode 2.0.24 publishes "connected" before its debounced tool-registry
    // reload (core/src/tool/mcp.ts). It has no public registry-ready receipt.
    // Allow that startup reload to settle before the first model request.
    await delay(500, undefined, { signal });
  }
  const modelId = input.conversationPolicy?.model;
  const split = modelId?.indexOf("/") ?? -1;
  if (modelId && split < 1) {
    throw openCode2Error(
      "model.unavailable",
      "OpenCode models require a provider/model identifier."
    );
  }
  const model = modelId
    ? {
        providerID: modelId.slice(0, split),
        id: modelId.slice(split + 1),
        ...(input.conversationPolicy?.reasoningLevel
          ? { variant: input.conversationPolicy.reasoningLevel }
          : {}),
      }
    : undefined;
  const permissions = readOpenCode2Permissions(input.env?.OPENCODE_PERMISSION);
  let session: SessionInfo;
  if (input.sessionId) {
    session = await client.session.get(
      { sessionID: input.sessionId },
      { signal }
    );
    await assertOpenCode2Directory(session, location.directory);
    const active = await client.session.active({ signal });
    if (active[session.id]) {
      throw openCode2Error(
        "conversation.busy",
        "The selected OpenCode session is already running."
      );
    }
    if (permissions) {
      await client.session.update(
        { sessionID: session.id, permissions },
        { signal }
      );
    }
    if (model) {
      await client.session.switchModel(
        { sessionID: session.id, model },
        { signal }
      );
    }
  } else {
    session = await client.session.create(
      {
        location,
        ...(model ? { model } : {}),
        ...(permissions ? { permissions } : {}),
      },
      { signal }
    );
  }
  await input.onRuntimeEvent?.({
    phase: "provider_conversation_observed",
    agentControllerConversationId: session.id,
    tsMs: Date.now(),
  });
  if (input.instructionPrompt) {
    await client.session.instructions.entry.put(
      {
        sessionID: session.id,
        key: "openmeld.dispatch",
        value: input.instructionPrompt.developerInstructions,
      },
      { signal }
    );
  }
  return session;
}

function permissionEntries(setting: unknown): [string, unknown][] {
  if (typeof setting === "string") {
    return [["*", setting]];
  }
  return setting && typeof setting === "object" && !Array.isArray(setting)
    ? Object.entries(setting)
    : [];
}

async function waitForSpaceActionMcp(
  client: OpenCode2Client,
  location: { directory: string },
  name: string,
  signal: AbortSignal
) {
  const startupSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  while (true) {
    const servers = await client.mcp.list(
      { location },
      { signal: startupSignal }
    );
    const status = servers.data.find((server) => server.name === name)?.status;
    if (status?.status === "connected") {
      return;
    }
    if (status && status.status !== "pending") {
      throw openCode2Error(
        "space.action.unavailable",
        `OpenCode could not start the Space action tools: ${JSON.stringify(status)}`
      );
    }
    await delay(100, undefined, { signal: startupSignal });
  }
}

type TurnState = {
  sessionId: string;
  sessions: Set<string>;
  tools: Map<string, string>;
  delivered: Set<string>;
  assistantMessages: Set<string>;
  started: boolean;
  receiptId: string | null;
  admissionReported: boolean;
  output: string;
  previewEmitted: boolean;
};

async function reportOpenCode2Admission(
  input: OpenCode2TurnInput,
  state: TurnState
) {
  if (
    !(
      state.started &&
      state.receiptId &&
      state.delivered.has(state.receiptId)
    ) ||
    state.admissionReported
  ) {
    return;
  }
  state.admissionReported = true;
  await input.onRuntimeEvent?.({
    phase: "provider_turn_accepted",
    agentControllerConversationId: state.sessionId,
    turnId: state.receiptId,
    tsMs: Date.now(),
  });
}

async function observeEvent(
  input: OpenCode2TurnInput,
  state: TurnState,
  event: V2Event,
  signal: AbortSignal
): Promise<boolean> {
  if (
    event.type === "session.created" &&
    event.data.parentID &&
    state.sessions.has(event.data.parentID)
  ) {
    state.sessions.add(event.data.sessionID);
  }
  if (event.type === "form.created") {
    if (state.sessions.has(event.data.form.sessionID)) {
      await answerOpenCode2Form(
        input.client,
        event.data.form,
        input.onInteractionRequest,
        signal
      );
    }
    return false;
  }
  if (
    !(
      "sessionID" in event.data &&
      state.sessions.has(event.data.sessionID as string)
    )
  ) {
    return false;
  }
  if (event.type === "permission.asked") {
    await answerOpenCode2Permission(
      input.client,
      event.data,
      input.onInteractionRequest,
      signal
    );
    return false;
  }
  await observeTool(input, state, event);
  if (event.data.sessionID !== state.sessionId) {
    return false;
  }
  if (
    "assistantMessageID" in event.data &&
    typeof event.data.assistantMessageID === "string"
  ) {
    state.assistantMessages.add(event.data.assistantMessageID);
  }
  return await observeRootEvent(input, state, event);
}

async function observeTool(
  input: OpenCode2TurnInput,
  state: TurnState,
  event: V2Event
) {
  if (event.type === "session.tool.input.started") {
    state.tools.set(event.data.id, event.data.name);
  }
  if (
    event.type !== "session.tool.called" &&
    event.type !== "session.tool.success" &&
    event.type !== "session.tool.failed"
  ) {
    return;
  }
  const activityState = {
    "session.tool.called": "input-available",
    "session.tool.success": "output-available",
    "session.tool.failed": "output-error",
  } as const;
  await input.onRuntimeEvent?.({
    phase: "tool_activity",
    toolCallId: event.data.id,
    toolName: resolveAdapterToolActivityName(state.tools.get(event.data.id)),
    state: activityState[event.type],
    tsMs: Date.now(),
  });
}

async function observeRootEvent(
  input: OpenCode2TurnInput,
  state: TurnState,
  event: V2Event
): Promise<boolean> {
  switch (event.type) {
    case "session.inbox.delivered":
      state.delivered.add(event.data.inboxID);
      await reportOpenCode2Admission(input, state);
      break;
    case "session.execution.started":
      state.started = true;
      await reportOpenCode2Admission(input, state);
      break;
    case "session.text.delta":
      state.output += event.data.delta;
      if (input.streamingMode === "stream" && input.onPreview) {
        await input.onPreview({ text: state.output });
        state.previewEmitted = true;
      }
      break;
    case "session.reasoning.delta":
      await input.onRuntimeEvent?.({
        phase: "reasoning",
        blockId: `${event.data.assistantMessageID}:${event.data.ordinal}`,
        mode: "append",
        text: event.data.delta,
        tsMs: Date.now(),
      });
      break;
    case "session.execution.succeeded":
      return state.started;
    case "session.execution.failed": {
      if (!state.started) {
        break;
      }
      const failure = classifyOpenCodeFailureMessage({
        message: event.data.error.message,
        isContextLost: () => false,
        includeOriginalError: true,
      });
      throw Object.assign(new Error(failure.message), failure);
    }
    case "session.execution.interrupted":
      if (state.started) {
        throw openCode2Error(
          "runtime.interrupted",
          `OpenCode interrupted the execution: ${event.data.reason}`
        );
      }
      break;
    default:
      break;
  }
  return false;
}
