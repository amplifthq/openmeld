import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { outJsonLine } from "../ui/io";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import { runSpaceReadWithPasswordRetry } from "./password-flow";
import {
  emitSpaceStatusAgentOutput,
  emitSpaceStatusHumanOutput,
} from "./status-output";

export async function runSpaceStatus(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading space status"
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
  const spaceApi = createCliSpaceApi(baseUrl);
  const statusRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await spaceApi.getStatus({
        spaceId: input.space,
        requestContext,
        ...(password === undefined ? {} : { spacePassword: password }),
      }),
  });
  if (statusRead.status === "cancelled") {
    return;
  }

  if (input.json) {
    outJsonLine(statusRead.result);
    return;
  }

  if (runtime.resolvedView === "agent") {
    emitSpaceStatusAgentOutput({
      presenter,
      status: statusRead.result,
    });
    return;
  }

  emitSpaceStatusHumanOutput({
    presenter,
    status: statusRead.result,
  });
}
