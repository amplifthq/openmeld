import { patchSpaceContractBodySchema } from "@openmeld/schemas";
import type {
  PatchSpaceContractBody,
  SpaceContract,
} from "@openmeld/schemas/types";
import {
  areAllowedActionsEquivalent,
  canonicalizeAllowedActions,
} from "@openmeld/space-mesh";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { createSpaceContractSetGuideError } from "../runtime/dual-view-guide-catalog";
import { outJsonLine } from "../ui/io";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import { fetchSpaceContract } from "./contract-api";
import { emitSpaceContractHumanOutput } from "./contract-output";
import { patchSpaceContract } from "./contract-set-api";
import { runSpaceContractSetFlow } from "./contract-set-flow";
import {
  normalizeAllowedActionsCsv,
  normalizePublicationModeCliValue,
  trimOptionalCliValue,
} from "./contract-set-options";
import {
  runSpaceReadWithPasswordRetry,
  runSpaceWriteWithPasswordRetry,
} from "./password-flow";

const UPDATED_TITLE_SUFFIX_RE = /updated:$/u;

export async function runSpaceContractSet(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  dispatchPolicy?: string;
  publicationMode?: string;
  allowedActions?: string;
  resultArchiveMode?: string;
  entryBrief?: string;
  dispatchBrief?: string;
  outputTitle?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "updating a space contract"
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

  const explicitPatch = buildExplicitSpaceContractPatch(input);
  let contractPatch = explicitPatch;
  let resolvedPassword = input.password;

  if (!contractPatch) {
    const canRunInteractiveFlow =
      runtime.resolvedView === "human" && interactive && !input.json;
    if (!canRunInteractiveFlow) {
      throw createSpaceContractSetGuideError();
    }

    const contractRead = await runSpaceReadWithPasswordRetry({
      initialPassword: input.password,
      interactive: true,
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
    resolvedPassword = contractRead.password;

    const flow = await runSpaceContractSetFlow({
      currentContract: contractRead.result,
    });
    if (flow.status === "cancelled") {
      return;
    }

    contractPatch = pruneUnchangedSpaceContractPatch({
      currentContract: contractRead.result,
      contractPatch: flow.contractPatch,
    });
    if (!contractPatch) {
      emitSpaceContractHumanOutput({
        presenter,
        contract: contractRead.result,
        title: input.outputTitle
          ? input.outputTitle.replace(UPDATED_TITLE_SUFFIX_RE, "unchanged:")
          : "Space contract unchanged:",
      });
      return;
    }
  }

  const contractWrite = await runSpaceWriteWithPasswordRetry({
    initialPassword: resolvedPassword,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    requiredText:
      "This space is protected. Enter password to update the contract.",
    execute: async (password) =>
      await patchSpaceContract({
        requestContext,
        baseUrl,
        space: input.space,
        contractPatch,
        password,
      }),
  });
  if (contractWrite.status === "cancelled") {
    return;
  }

  if (input.json) {
    outJsonLine(contractWrite.result);
    return;
  }

  emitSpaceContractHumanOutput({
    presenter,
    contract: contractWrite.result,
    title: input.outputTitle ?? "Space contract updated:",
  });
}

function buildExplicitSpaceContractPatch(input: {
  dispatchPolicy?: string;
  publicationMode?: string;
  allowedActions?: string;
  resultArchiveMode?: string;
  entryBrief?: string;
  dispatchBrief?: string;
}): PatchSpaceContractBody | null {
  const dispatchPolicy = trimOptionalCliValue(input.dispatchPolicy);
  const publicationMode = normalizePublicationModeCliValue(
    input.publicationMode
  );
  const allowedActions = normalizeAllowedActionsCsv(input.allowedActions);
  const resultArchiveMode = trimOptionalCliValue(input.resultArchiveMode);
  const entryBrief = trimOptionalCliValue(input.entryBrief);
  const dispatchBrief = trimOptionalCliValue(input.dispatchBrief);

  const candidatePatch = {
    ...(dispatchPolicy ? { dispatchPolicy: { mode: dispatchPolicy } } : {}),
    ...(publicationMode ? { publicationMode } : {}),
    ...(allowedActions ? { allowedActions } : {}),
    ...(resultArchiveMode
      ? { resultArchivePolicy: { mode: resultArchiveMode } }
      : {}),
    ...(entryBrief ? { entryBrief } : {}),
    ...(dispatchBrief ? { dispatchBrief } : {}),
  };
  if (Object.keys(candidatePatch).length === 0) {
    return null;
  }

  const parsed = patchSpaceContractBodySchema.safeParse(candidatePatch);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? "space contract patch is invalid"
    );
  }
  return {
    ...parsed.data,
    ...(parsed.data.allowedActions
      ? {
          allowedActions: canonicalizeAllowedActions(
            parsed.data.allowedActions
          ),
        }
      : {}),
  };
}

function pruneUnchangedSpaceContractPatch(input: {
  currentContract: SpaceContract;
  contractPatch: PatchSpaceContractBody;
}): PatchSpaceContractBody | null {
  const nextPatch: PatchSpaceContractBody = {};

  if (
    input.contractPatch.dispatchPolicy &&
    input.contractPatch.dispatchPolicy.mode !==
      input.currentContract.dispatchPolicy.mode
  ) {
    nextPatch.dispatchPolicy = input.contractPatch.dispatchPolicy;
  }
  if (
    input.contractPatch.publicationMode &&
    input.contractPatch.publicationMode !==
      input.currentContract.publicationMode
  ) {
    nextPatch.publicationMode = input.contractPatch.publicationMode;
  }
  if (
    input.contractPatch.allowedActions &&
    !areAllowedActionsEquivalent(
      input.contractPatch.allowedActions,
      input.currentContract.allowedActions
    )
  ) {
    nextPatch.allowedActions = input.contractPatch.allowedActions;
  }
  if (
    input.contractPatch.resultArchivePolicy &&
    input.contractPatch.resultArchivePolicy.mode !==
      input.currentContract.resultArchivePolicy.mode
  ) {
    nextPatch.resultArchivePolicy = input.contractPatch.resultArchivePolicy;
  }
  if (
    input.contractPatch.entryBrief &&
    input.contractPatch.entryBrief !== input.currentContract.entryBrief
  ) {
    nextPatch.entryBrief = input.contractPatch.entryBrief;
  }
  if (
    input.contractPatch.dispatchBrief &&
    input.contractPatch.dispatchBrief !== input.currentContract.dispatchBrief
  ) {
    nextPatch.dispatchBrief = input.contractPatch.dispatchBrief;
  }

  return Object.keys(nextPatch).length > 0 ? nextPatch : null;
}
