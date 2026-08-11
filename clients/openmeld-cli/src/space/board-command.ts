import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { outLine } from "../ui/io";
import { fetchSpaceBoard } from "./board-api";
import { formatSpaceBoardOutput } from "./board-output";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import { runSpaceReadWithPasswordRetry } from "./password-flow";

export async function runSpaceBoard(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading a Space Board"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }

  const { runtime, presenter, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const boardRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await fetchSpaceBoard({
        requestContext,
        baseUrl,
        space: input.space,
        password,
      }),
  });
  if (boardRead.status === "cancelled") {
    return;
  }

  outLine(formatSpaceBoardOutput(boardRead.result, { json: input.json }));
}
