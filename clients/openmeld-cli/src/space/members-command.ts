import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { emitCliJsonEnvelope } from "../runtime/cli-json-output";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  emitSpaceMembersAgentOutput,
  emitSpaceMembersHumanOutput,
} from "./members-output";
import { runSpaceReadWithPasswordRetry } from "./password-flow";

export async function runSpaceMembers(input: {
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
      "reading the Space member directory"
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
  const directoryRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await spaceApi.getMemberDirectory({
        spaceId: input.space,
        requestContext,
        ...(password === undefined ? {} : { spacePassword: password }),
      }),
  });
  if (directoryRead.status === "cancelled") {
    return;
  }

  if (input.json) {
    emitCliJsonEnvelope({
      schemaVersion: 1,
      type: "space.members",
      ...directoryRead.result,
    });
    return;
  }

  if (runtime.resolvedView === "agent") {
    emitSpaceMembersAgentOutput({
      directory: directoryRead.result,
      presenter,
    });
    return;
  }

  emitSpaceMembersHumanOutput({
    directory: directoryRead.result,
    presenter,
  });
}
