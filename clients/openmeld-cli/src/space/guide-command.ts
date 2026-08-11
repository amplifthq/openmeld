import type { SpaceMeta } from "@openmeld/protocol";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { outJsonLine } from "../ui/io";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  buildSpaceGuideStructuredPayload,
  emitSpaceGuideHumanOutput,
} from "./guide-output";
import { upsertSpaceConfig } from "./local-state";
import { fetchSpaceMeta, updateSpaceMeta } from "./meta-api";
import {
  runSpaceReadWithPasswordRetry,
  runSpaceWriteWithPasswordRetry,
} from "./password-flow";
import { toSpaceMetaUpsertInput } from "./space-meta-upsert-input";

export async function runSpaceGuideRead(input: {
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
      "reading a space guide"
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

  const guideRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await fetchSpaceMeta({
        requestContext,
        baseUrl,
        space: input.space,
        password,
      }),
  });
  if (guideRead.status === "cancelled") {
    return;
  }

  const meta = guideRead.result;
  await syncSpaceGuideCache({
    openMeldProfile,
    baseUrl,
    meta,
  });

  if (input.json) {
    outJsonLine(
      buildSpaceGuideStructuredPayload({
        spaceId: meta.spaceId,
        spaceName: meta.name,
        guideText: meta.guide,
      })
    );
    return;
  }

  emitSpaceGuideHumanOutput({
    presenter,
    meta,
  });
}

export async function runSpaceGuideSet(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  guide: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const guide = input.guide.trim();
  if (guide.length === 0) {
    throw new Error("space guide text cannot be empty");
  }
  await runSpaceGuideWrite({
    ...input,
    guide,
    successTitle: "Space guide updated:",
    authAction: "updating a space guide",
  });
}

export async function runSpaceGuideClear(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  await runSpaceGuideWrite({
    ...input,
    guide: "",
    successTitle: "Space guide cleared:",
    authAction: "clearing a space guide",
  });
}

async function runSpaceGuideWrite(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  password?: string;
  guide: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
  successTitle: string;
  authAction: string;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(input.authAction),
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

  const guideWrite = await runSpaceWriteWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await updateSpaceMeta({
        requestContext,
        baseUrl,
        space: input.space,
        password,
        guide: input.guide,
      }),
  });
  if (guideWrite.status === "cancelled") {
    return;
  }

  const meta = guideWrite.result;
  await syncSpaceGuideCache({
    openMeldProfile,
    baseUrl,
    meta,
    knownGuide: input.guide,
  });

  if (input.json) {
    outJsonLine(
      buildSpaceGuideStructuredPayload({
        spaceId: meta.spaceId,
        spaceName: meta.name,
        guideText: meta.guide,
      })
    );
    return;
  }

  emitSpaceGuideHumanOutput({
    presenter,
    meta,
    title: input.successTitle,
  });
}

async function syncSpaceGuideCache(input: {
  openMeldProfile: OpenMeldProfile;
  baseUrl: string;
  meta: SpaceMeta;
  knownGuide?: string;
}): Promise<void> {
  const guidePatch =
    Object.hasOwn(input.meta, "guide") || input.knownGuide === undefined
      ? {}
      : { guide: input.knownGuide.length > 0 ? input.knownGuide : null };

  await upsertSpaceConfig({
    openMeldProfileId: input.openMeldProfile.openMeldProfileId,
    baseUrl: input.baseUrl,
    space: input.meta.spaceId,
    profileHandle: input.openMeldProfile.profileHandle,
    profileName: input.openMeldProfile.profileName,
    ...toSpaceMetaUpsertInput(input.meta),
    ...guidePatch,
  });
}
