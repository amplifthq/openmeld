import { randomUUID } from "node:crypto";
import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentExecutionSteerResponse,
  RuntimeAdapter,
} from "@openmeld/adapter-core";

type Receipt = (value: AgentExecutionSteerResponse) => void;
const CLAUDE_VERSION = /^(\d+)\.(\d+)\.(\d+)/;
// After a priority message yields the old turn, Claude starts the continuation
// at once. Its replay can follow much later (after thinking), so only a missing
// continuation start closes input.
const CONTINUATION_START_TIMEOUT_MS = 10_000;

// One input stream belongs to one invocation. Keeping it open allows native
// priority messages without starting or resuming a second query.
export function createClaudeLiveInput(taskId: string, prompt: string) {
  const messages: SDKUserMessage[] = [userMessage(prompt)];
  const pending = new Map<string, Receipt>();
  const awaitingResults = new Set<string>();
  let wake: (() => void) | undefined;
  let closed = false;
  let sessionId: string | undefined;
  let supported = false;
  let continuationGuard: ReturnType<typeof setTimeout> | undefined;

  function unconfirmed(): AgentExecutionSteerResponse {
    return {
      status: "unconfirmed",
      taskId,
      reasonCode: "execution_input.application_unconfirmed",
      diagnosticCode: "claude.input_receipt_unconfirmed",
    };
  }

  function close() {
    closed = true;
    clearTimeout(continuationGuard);
    messages.length = 0;
    wake?.();
    for (const resolve of pending.values()) {
      resolve(unconfirmed());
    }
    pending.clear();
    awaitingResults.clear();
  }

  const steer: NonNullable<RuntimeAdapter["steer"]> = async (input) => {
    if (closed || input.taskId !== taskId || !sessionId) {
      return {
        status: "not_applied",
        taskId: input.taskId,
        reasonCode: "execution_input.target_unavailable",
      };
    }
    if (!supported) {
      return {
        status: "not_applied",
        taskId,
        reasonCode: "execution_input.unsupported",
      };
    }
    // Space input IDs are not necessarily UUIDs. Claude requires native UUIDs;
    // the Service receipt owns inputId deduplication across transport retries.
    const uuid = randomUUID();
    // The receipt waits for native consumption or the end of this input
    // stream. A fixed timeout would report consumed input as unconfirmed.
    return await new Promise<AgentExecutionSteerResponse>((resolve) => {
      pending.set(uuid, resolve);
      awaitingResults.add(uuid);
      messages.push({ ...userMessage(input.text, uuid), priority: "now" });
      wake?.();
    });
  };

  function observeResult(message: Extract<SDKMessage, { type: "result" }>) {
    for (const uuid of message.user_message_uuids ?? []) {
      awaitingResults.delete(uuid);
    }
    if (message.user_message_uuid) {
      awaitingResults.delete(message.user_message_uuid);
    }
    // Native priority input may yield the old turn before consuming the
    // message in its continuation. Wait for that continuation's result.
    if (!message.is_error && awaitingResults.size > 0) {
      clearTimeout(continuationGuard);
      continuationGuard = setTimeout(close, CONTINUATION_START_TIMEOUT_MS);
      continuationGuard.unref?.();
    } else {
      close();
    }
  }

  return {
    close,
    steer,
    async *prompt(): AsyncGenerator<SDKUserMessage> {
      while (!closed) {
        const message = messages.shift();
        if (message) {
          yield message;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          wake = undefined;
        }
      }
    },
    observe(message: SDKMessage) {
      if (message.type === "system" && message.subtype === "init") {
        clearTimeout(continuationGuard);
        sessionId = message.session_id;
        // 2.1.290 fixes replay acknowledgements before actual consumption.
        supported = supportsConsumedInputReceipt(message.claude_code_version);
      }
      if (
        message.type === "user" &&
        "isReplay" in message &&
        message.isReplay &&
        message.parent_tool_use_id === null &&
        message.session_id === sessionId
      ) {
        const resolve = pending.get(message.uuid);
        if (resolve) {
          pending.delete(message.uuid);
          resolve({
            status: "applied",
            taskId,
            threadId: message.session_id,
            // Claude identifies consumed user input by message UUID, not a
            // Codex-style turn ID. This receipt proves native consumption.
            turnId: message.uuid,
          });
        }
      }
      if (message.type === "result") {
        observeResult(message);
      }
    },
  };
}

function supportsConsumedInputReceipt(version: string | undefined): boolean {
  const parts = version?.match(CLAUDE_VERSION);
  if (!parts) {
    return false;
  }
  const major = Number(parts[1]);
  const minor = Number(parts[2]);
  const patch = Number(parts[3]);
  return (
    major > 2 || (major === 2 && (minor > 1 || (minor === 1 && patch >= 290)))
  );
}

function userMessage(
  text: string,
  uuid?: `${string}-${string}-${string}-${string}-${string}`
): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    ...(uuid ? { uuid } : {}),
  };
}
