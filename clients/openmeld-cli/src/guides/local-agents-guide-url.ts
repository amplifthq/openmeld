import type { Key } from "node:readline";
import { resolveGatewayWebOrigin } from "../space/web-url";
import type {
  InteractivePromptKeypressResult,
  InteractivePromptStatus,
  InteractivePromptStreams,
} from "../ui/interactive-prompt";
import {
  isReturnKeypress,
  runInteractivePrompt,
} from "../ui/interactive-prompt";

export const LOCAL_AGENTS_GUIDE_PATH = "/guides/local-agents";
export const LOCAL_AGENTS_GUIDE_AGENT_NAMES =
  "Codex, Claude Code, Cursor, or OpenCode";

export type LocalAgentsGuideConfirmationDecision = "continue" | "cancelled";

type LocalAgentsGuidePromptState = {
  guideUrl: string;
};

export function buildLocalAgentsGuideUrl(baseUrl: string): string {
  const url = new URL(resolveGatewayWebOrigin(baseUrl));
  url.pathname = LOCAL_AGENTS_GUIDE_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function buildNoLocalAgentsNoticeLines(input: {
  guideUrl: string;
}): string[] {
  return [
    `OpenMeld did not find ${LOCAL_AGENTS_GUIDE_AGENT_NAMES} on this computer.`,
    "Install and sign in to one of them if you want this computer to run local agents from OpenMeld.",
    `Guide: ${input.guideUrl}`,
  ];
}

export function appendLocalAgentsGuideUrl(input: {
  guideUrl: string;
  message: string;
}): string {
  return `${input.message} Install guide: ${input.guideUrl}`;
}

export async function confirmContinueWithoutLocalAgents(input: {
  guideUrl: string;
  streams?: InteractivePromptStreams;
}): Promise<LocalAgentsGuideConfirmationDecision> {
  return await runInteractivePrompt<
    LocalAgentsGuidePromptState,
    LocalAgentsGuideConfirmationDecision
  >(
    {
      initialState: { guideUrl: input.guideUrl },
      fallbackResult: "continue",
      renderLines: renderLocalAgentsGuidePromptLines,
      handleKeypress: handleLocalAgentsGuidePromptKeypress,
    },
    input.streams
  );
}

export function renderLocalAgentsGuidePromptLines(
  state: LocalAgentsGuidePromptState,
  status: InteractivePromptStatus
): string[] {
  if (status === "submitted") {
    return ["Continuing setup without local agents."];
  }
  if (status === "cancelled") {
    return ["Setup cancelled."];
  }
  return [
    ...buildNoLocalAgentsNoticeLines({ guideUrl: state.guideUrl }),
    "Continue setting up the OpenMeld service without any local agents? [Y/n]",
  ];
}

export function handleLocalAgentsGuidePromptKeypress(input: {
  key: Key;
  state: LocalAgentsGuidePromptState;
  str: string | undefined;
}): InteractivePromptKeypressResult<
  LocalAgentsGuidePromptState,
  LocalAgentsGuideConfirmationDecision
> {
  if (isReturnKeypress({ key: input.key, str: input.str })) {
    return {
      type: "result",
      status: "submitted",
      result: "continue",
      state: input.state,
    };
  }
  const value = String(input.str ?? "")
    .trim()
    .toLowerCase();
  if (value === "y") {
    return {
      type: "result",
      status: "submitted",
      result: "continue",
      state: input.state,
    };
  }
  if (value === "n" || input.key.name === "escape") {
    return {
      type: "result",
      status: "cancelled",
      result: "cancelled",
      state: input.state,
    };
  }
  if (input.key.ctrl && input.key.name === "c") {
    return {
      type: "result",
      status: "cancelled",
      result: "cancelled",
      state: input.state,
    };
  }
  return { type: "ignore" };
}
