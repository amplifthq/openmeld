// biome-ignore-all lint/performance/noBarrelFile: Runtime adapter public entrypoint.
import { createHash } from "node:crypto";
import {
  type AdapterDispatchRequest,
  createSharedDispatchShell,
  type InstalledLaunchCandidatesOptions,
  type RuntimeAdapter,
  type RuntimeAgentControllerLaunchContract,
  resolveBuiltinAdapterConversationBridgeSpec,
  resolveInstalledNodeScriptLaunchCandidates,
  resolveLaunchCandidatesAfterVerification,
  verifyCliLaunchContract,
} from "@openmeld/adapter-core";
import {
  GrokBotClient,
  GrokBotError,
  readGrokBotCredential,
} from "./client.js";

export {
  GrokBotClient,
  GrokBotError,
  readGrokBotCredential,
} from "./client.js";

export async function verifyGrokBotLaunchContract(input: {
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs?: number | null;
}) {
  return await verifyCliLaunchContract({
    ...input,
    cwd: process.cwd(),
    displayName: "Grok Bot BDK",
    probeArgs: ["--version"],
    timeoutMs: input.timeoutMs ?? 8000,
  });
}

export async function resolveInstalledGrokBotLaunchCandidates(
  input?: InstalledLaunchCandidatesOptions
) {
  const result = await resolveInstalledNodeScriptLaunchCandidates({
    commandName: "bdk",
    configuredCommand: process.env.OPENMELD_DAEMON_RUNTIME_GROK_BOT_BIN ?? null,
    displayName: "Grok Bot BDK",
    preferredLaunchContract: input?.preferredLaunchContract,
  });
  if (!result.ok) {
    return result;
  }
  const candidates = await resolveLaunchCandidatesAfterVerification({
    candidates: result.candidates,
    verify: (candidate) =>
      verifyGrokBotLaunchContract({ launchContract: candidate.launchContract }),
  });
  return candidates.length
    ? { ok: true as const, candidates }
    : {
        ok: false as const,
        reason: "not_launchable" as const,
        errorMessage:
          "Install the official @cursor/bdk package and sign in with bdk login.",
      };
}

type ActiveConversation = {
  client: GrokBotClient | null;
  sessionId: string;
  stopRequested: boolean;
  sent: boolean;
};

async function readIdleCursor(client: GrokBotClient, sessionId: string) {
  let cursor = "-1";
  while (true) {
    const page = await client.entries(sessionId, cursor);
    if (!page.turn.idle || page.turn.inFlight || page.turn.queued) {
      throw new GrokBotError(
        "grok-bot.busy",
        "Grok Bot is handling other work. Nothing was sent; try again when it is idle."
      );
    }
    if (!page.entries.length || cursor === page.latestUpdatedSeq) {
      return page.latestUpdatedSeq;
    }
    cursor = page.latestUpdatedSeq;
  }
}

async function collectReplies(
  client: GrokBotClient,
  sessionId: string,
  initialCursor: string,
  wait: () => Promise<void>
) {
  let cursor = initialCursor;
  const replies = new Map<string, string>();
  let idlePolls = 0;
  let sawBusy = false;
  while (true) {
    const page = await client.entries(sessionId, cursor);
    cursor = page.latestUpdatedSeq;
    for (const entry of page.entries) {
      if (entry.kind === "send-message" && entry.text) {
        replies.set(entry.seq, entry.text);
      }
    }
    const busy = page.turn.inFlight || page.turn.queued > 0 || !page.turn.idle;
    sawBusy ||= busy;
    idlePolls = busy || page.entries.length ? 0 : idlePolls + 1;
    if (idlePolls >= (sawBusy ? 1 : 4)) {
      return [...replies.values()].join("\n\n");
    }
    await wait();
  }
}

async function publishReply(request: AdapterDispatchRequest, output: string) {
  if (!output.trim()) {
    throw new GrokBotError(
      "grok-bot.reply_missing",
      "Grok Bot finished without delivering a reply."
    );
  }
  if (!request.spaceActionTools) {
    return;
  }
  const receipt = await request.spaceActionTools.call("reply", {
    message: output,
  });
  if (receipt.isError) {
    throw new GrokBotError(
      "grok-bot.reply_rejected",
      "OpenMeld could not record the Bot reply. Check the task diagnostics before retrying."
    );
  }
}

export function createGrokBotAdapter(
  options: {
    createClient?: (request: AdapterDispatchRequest) => Promise<GrokBotClient>;
    wait?: () => Promise<void>;
  } = {}
): RuntimeAdapter {
  const active = new Map<string, ActiveConversation>();
  const conversations = new Set<string>();
  const wait =
    options.wait ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 1000)));

  const stop = async (taskId: string) => {
    const turn = active.get(taskId);
    if (!turn) {
      return {
        accepted: false,
        reasonCode: "task.not_running" as const,
        signalDelivery: "not_sent" as const,
        taskId,
      };
    }
    turn.stopRequested = true;
    try {
      if (turn.sent && turn.client) {
        // Shared-conversation control: the connection dialog grants this scope.
        // This is a request receipt, not terminal execution evidence.
        await turn.client.interrupt(turn.sessionId);
      }
      return {
        accepted: true,
        reasonCode: "accepted" as const,
        signalDelivery: "sent" as const,
        taskId,
        localAttemptOutcome: turn.sent
          ? ("stop_requested_after_start" as const)
          : ("withdrawn_before_start" as const),
      };
    } catch (error) {
      return {
        accepted: false,
        reasonCode: "signal.send_failed" as const,
        signalDelivery: "not_sent" as const,
        taskId,
        reasonDetail:
          error instanceof Error
            ? error.message
            : "Grok Bot stop is unconfirmed.",
      };
    }
  };

  const invoke = async (request: AdapterDispatchRequest) => {
    if (request.executionMode === "repair") {
      throw new GrokBotError(
        "grok-bot.repair_unsupported",
        "Check the shared Bot conversation before sending another task. Automatic resubmission is not supported."
      );
    }
    if (request.executionContext || request.computerFileAccessBoundary) {
      throw new GrokBotError(
        "execution_context.controller_access_unsupported",
        "This Agent shares an existing provider conversation. Independent contexts and local file access are not supported."
      );
    }
    const sessionId = request.agentControllerConversationId?.trim();
    if (!sessionId) {
      throw new GrokBotError(
        "grok-bot.connection_required",
        "Connect an existing Grok Bot conversation first. OpenMeld does not create Bots."
      );
    }
    if (conversations.has(sessionId)) {
      throw new GrokBotError(
        "grok-bot.busy",
        "This shared Bot is already working. Wait for its current work to finish."
      );
    }
    conversations.add(sessionId);
    const turn: ActiveConversation = {
      client: null,
      sessionId,
      sent: false,
      stopRequested: false,
    };
    active.set(request.taskId, turn);
    try {
      const client = options.createClient
        ? await options.createClient(request)
        : new GrokBotClient(
            await readGrokBotCredential({ ...process.env, ...request.env })
          );
      turn.client = client;
      // Drain history without publishing it. A connection/read never creates a Bot.
      const cursor = await readIdleCursor(client, sessionId);
      if (turn.stopRequested) {
        throw new GrokBotError(
          "runtime.turn.cancelled",
          "Stopped before the message was sent."
        );
      }
      const digest = createHash("sha256")
        .update(request.dispatchId ?? request.taskId)
        .digest("hex");
      const messageId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      turn.sent = true;
      await client.send(
        sessionId,
        messageId,
        [
          request.prompt,
          "OpenMeld shared-conversation delivery: send your public answer normally in this Bot conversation. OpenMeld collects delivered replies and submits them through its authorized reply writer. Do not run an OpenMeld CLI command or inspect local OpenMeld credentials. Your existing tools and permissions remain provider-managed.",
        ].join("\n\n")
      );
      if (turn.stopRequested) {
        await client.interrupt(sessionId);
      }
      const output = await collectReplies(client, sessionId, cursor, wait);
      if (turn.stopRequested) {
        throw new GrokBotError(
          "runtime.turn.cancelled",
          "Grok Bot's shared conversation stopped."
        );
      }
      await publishReply(request, output);
      return {
        output,
        contextDelta: { agentControllerConversationId: sessionId },
      };
    } finally {
      active.delete(request.taskId);
      conversations.delete(sessionId);
    }
  };

  return {
    adapterId: "grok-bot",
    dispatch: createSharedDispatchShell({
      adapterId: "grok-bot",
      bridgeSpec: resolveBuiltinAdapterConversationBridgeSpec("grok-bot"),
      resolveDefaultInvoke: () => invoke,
      runtimeOptions: options,
    }),
    cancel: ({ taskId }) => stop(taskId),
    interrupt: async (input) => ({
      ...(await stop(input.taskId)),
      plan: {
        initial: {
          mode: input.mode ?? "graceful",
          reason: input.reason ?? "Stop shared Bot",
          taskId: input.taskId,
        },
      },
    }),
    verifyComputerFileAccessBoundary: async () => ({
      supported: false,
      reasonCode: "computer.file_access.controller_unsupported",
    }),
  };
}
