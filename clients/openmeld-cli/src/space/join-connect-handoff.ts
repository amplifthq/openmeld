import {
  isOpenMeldLockError,
  type OpenMeldLockError,
  resolveOpenMeldOrphanedLockIssue,
} from "../config/lock";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import {
  formatOpenMeldCliTextBlock,
  resolveUserFacingCliEntryCommand,
} from "../runtime/cli-entry-command";
import type { createPresenter } from "../runtime/presenter/index";
import { SpaceCommandOutputHandledError } from "./command-output-handled";
import { runConnect } from "./connect";
import { runSpacePasswordRetry } from "./password-flow";

type JoinConnectHandoffPresenter = Pick<
  ReturnType<typeof createPresenter>,
  "data" | "event" | "line"
>;

export type SpaceJoinConnectHandoffInput = {
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  initialPassword?: string;
  output?: string;
  localEcho: boolean;
  historyLimit?: number;
  role?: string;
  mentionAlias?: string;
  presenter: JoinConnectHandoffPresenter;
  resolvedView: "human" | "agent";
  canPromptJoinPassword: boolean;
  rawStream: boolean;
};

// Join connect handoff owns join-side stream-only fallback, connect retry,
// lock presentation, and join-only runtime side effects only.
export async function runSpaceJoinConnectHandoff(
  input: SpaceJoinConnectHandoffInput
): Promise<"connected" | "cancelled"> {
  const useStdio = shouldUseJoinStdio(input.resolvedView);
  const sendCommand = resolveStreamOnlyJoinSendCommand({
    useStdio,
    profileId: input.openMeldProfileId,
    spaceId: input.space,
    baseUrl: input.baseUrl,
  });
  if (!useStdio) {
    input.presenter.event("info", "space.join.stdin_fallback_watch", {
      connectionMode: "join",
      profileId: input.openMeldProfileId,
      spaceId: input.space,
      ...(sendCommand ? { sendCommand } : {}),
    });
  }

  try {
    return await connectSpaceJoinWithPasswordRetry({
      openMeldProfileId: input.openMeldProfileId,
      openMeldProfile: input.openMeldProfile,
      baseUrl: input.baseUrl,
      space: input.space,
      initialPassword: input.initialPassword,
      stdio: useStdio,
      output: input.output,
      localEcho: input.localEcho,
      historyLimit: input.historyLimit,
      role: input.role,
      mentionAlias: input.mentionAlias,
      sendCommand,
      presenter: input.presenter,
      canPromptJoinPassword: input.canPromptJoinPassword,
      rawStream: input.rawStream,
      resolvedView: input.resolvedView,
    });
  } catch (error) {
    if (input.resolvedView === "human" && isOpenMeldLockError(error)) {
      const lockMessage = buildHumanReadableSpaceJoinLockMessage(error);
      emitSpaceJoinLockBlocked({
        presenter: input.presenter,
        output: input.output,
        message: lockMessage,
      });
      throw new SpaceCommandOutputHandledError(lockMessage);
    }
    throw error;
  }
}

function shouldUseJoinStdio(resolvedView: "human" | "agent"): boolean {
  if (resolvedView !== "agent") {
    return true;
  }
  return process.stdin.isTTY === true;
}

function buildStreamOnlyJoinSendCommand(input: {
  profileId: string;
  spaceId: string;
  baseUrl: string;
}): string {
  const cliEntry = resolveUserFacingCliEntryCommand();
  return `${cliEntry} space --gateway-url ${input.baseUrl} send --profile ${input.profileId} ${input.spaceId} <text...>`;
}

function resolveStreamOnlyJoinSendCommand(input: {
  useStdio: boolean;
  profileId: string;
  spaceId: string;
  baseUrl: string;
}): string | undefined {
  if (input.useStdio) {
    return undefined;
  }
  return buildStreamOnlyJoinSendCommand({
    profileId: input.profileId,
    spaceId: input.spaceId,
    baseUrl: input.baseUrl,
  });
}

async function connectSpaceJoinWithPasswordRetry(input: {
  openMeldProfileId: string;
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  space: string;
  initialPassword?: string;
  stdio: boolean;
  output?: string;
  localEcho: boolean;
  historyLimit?: number;
  role?: string;
  mentionAlias?: string;
  sendCommand?: string;
  presenter: JoinConnectHandoffPresenter;
  canPromptJoinPassword: boolean;
  rawStream: boolean;
  resolvedView: "human" | "agent";
}): Promise<"connected" | "cancelled"> {
  const handoffResult = await runSpacePasswordRetry({
    initialPassword: input.initialPassword,
    interactive: input.canPromptJoinPassword,
    presenter: input.presenter,
    codePrefix: "space.join.password",
    execute: async (password) => {
      await runConnect({
        profile: input.openMeldProfileId,
        openMeldProfile: input.openMeldProfile,
        baseUrl: input.baseUrl,
        space: input.space,
        password,
        trackProfileSpaceHistory: true,
        stdio: input.stdio,
        output: input.output,
        localEcho: input.localEcho,
        historyLimit: input.historyLimit,
        role: input.role,
        mentionAlias: input.mentionAlias,
        connectionMode: "join",
        sendCommand: input.sendCommand,
        rawStream: input.rawStream,
        view: input.resolvedView,
      });
      return "connected" as const;
    },
  });
  if (handoffResult.status === "cancelled") {
    return "cancelled";
  }

  return handoffResult.result;
}

function buildHumanReadableSpaceJoinLockMessage(
  error: OpenMeldLockError
): string {
  const orphanedIssue = resolveOpenMeldOrphanedLockIssue(error);
  if (orphanedIssue) {
    return formatOpenMeldCliTextBlock(
      [
        "🔒 Join blocked",
        `Reason: ${orphanedIssue.summary}`,
        "",
        "✅ What to do now",
        `1) ${orphanedIssue.primaryAction}`,
        "",
        "🤖 Agent View",
        "Run with `--view agent` to get full lock path and metadata.",
      ].join("\n")
    );
  }

  const lines = [
    "🔒 Join blocked",
    "Reason: This profile has already joined this space.",
    "",
    "✅ What to do now",
    "1) Use the terminal where this profile is already joined.",
    "2) Or stop that session (Ctrl+C), then run `openmeld space join <space-id>` here.",
    "3) To join now as another participant, create a new profile or switch to a different profile, then join.",
    "",
    "🤖 Agent View",
    "Run with `--view agent` to get full lock path and metadata.",
  ];
  return formatOpenMeldCliTextBlock(lines.join("\n"));
}

function emitSpaceJoinLockBlocked(input: {
  presenter: JoinConnectHandoffPresenter;
  output?: string;
  message: string;
}): void {
  if (input.output === "ndjson") {
    input.presenter.data({
      code: "space.join.lock_blocked",
      payload: {
        text: input.message,
      },
    });
    return;
  }
  input.presenter.line({
    code: "space.join.lock_blocked",
    text: input.message,
  });
}
