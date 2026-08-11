import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { outJsonLine } from "../ui/io";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import { fetchSpaceContract } from "./contract-api";
import { emitSpaceContractHumanOutput } from "./contract-output";
import { runSpaceReadWithPasswordRetry } from "./password-flow";

export async function runSpaceContract(input: {
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
      "reading a space contract"
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
  const contractRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await fetchSpaceContract({
        requestContext,
        baseUrl,
        space: input.space,
        password,
      }),
  });
  if (contractRead.status === "cancelled") {
    return;
  }
  const contract = contractRead.result;

  if (input.json) {
    outJsonLine(contract);
    return;
  }
  emitSpaceContractHumanOutput({
    presenter,
    contract,
  });
}
